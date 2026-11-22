import { deploymentEnvironment } from '../shared/runtime-environment.js';
import { Redis } from "@upstash/redis";
import { checkEquipmentRegistryV2 } from "./lib/equipment-registry-v2.js";
import { reportAnomaly } from "./lib/anomaly-alert.js";

export const POLYGON_UNAVAILABLE_ALERT_AFTER = 2;

// Internal monitoring runs at most once every 15 minutes per environment.
// It returns no diagnostic data to visitors or professional accounts.
export async function runInternalMonitoring() {
  const url = process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
  if (!url || !token) {
    await reportAnomaly("service_unavailable", "redis_configuration_missing");
    return;
  }

  let redis;
  try {
    redis = new Redis({ url, token });
    const first = await redis.set(`carnetpass:internal-monitor:${deploymentEnvironment(process.env) || "local"}`, "1", { nx: true, ex: 900 });
    if (first !== "OK") return;
    await redis.ping();
  } catch {
    await reportAnomaly("service_unavailable", "redis_unavailable");
    return;
  }

  const missing = [];
  if (!process.env.OPENAI_API_KEY) missing.push("shiba_configuration");
  if (!process.env.RESEND_API_KEY) missing.push("email_configuration");
  if (deploymentEnvironment(process.env) === "preview" &&
    !(process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY)?.startsWith("sk_test_")) {
    missing.push("stripe_test_configuration");
  }
  if (missing.length) await reportAnomaly("service_unavailable", missing.join(","));

  const streakKey = `carnetpass:polygon-unavailable-streak:${deploymentEnvironment(process.env) || "local"}`;
  try {
    const status = await checkEquipmentRegistryV2();
    await redis.del(streakKey).catch(() => {});
    if (status.chainId !== 137 || status.paused || !status.serverAuthorized || status.balanceStatus === "critical") {
      await reportAnomaly("polygon_critical", "network_contract_authorization_or_balance");
    } else if (status.balanceStatus === "warning") {
      await reportAnomaly("polygon_warning", "low_balance");
    }
  } catch (error) {
    // A single dropped RPC call is not an outage: alert only when two
    // consecutive checks (about 15 minutes apart) fail.
    let failures = POLYGON_UNAVAILABLE_ALERT_AFTER;
    try {
      failures = await redis.incr(streakKey);
      await redis.expire(streakKey, 3600);
    } catch {
      // Without the counter, keep alerting rather than hiding an outage.
    }
    if (failures >= POLYGON_UNAVAILABLE_ALERT_AFTER) {
      await reportAnomaly("polygon_unavailable", error?.code || "check_failed");
    }
  }
}
