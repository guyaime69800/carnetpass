import assert from "node:assert/strict";
import test from "node:test";
import { runInternalMonitoring } from "../server/system-health.js";

// Upstash REST and Resend are reached through fetch; Polygon is made unavailable
// by leaving POLYGON_RPC_URL unset, so no network is contacted.
async function withMonitoring(callback) {
  const keys = ["UPSTASH_REDIS_REST_KV_REST_API_URL", "UPSTASH_REDIS_REST_KV_REST_API_TOKEN", "RESEND_API_KEY", "OPENAI_API_KEY", "POLYGON_RPC_URL", "VERCEL_ENV", "CARNETPASS_ENVIRONMENT"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    UPSTASH_REDIS_REST_KV_REST_API_URL: "https://redis.invalid",
    UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "test",
    RESEND_API_KEY: "test",
    OPENAI_API_KEY: "test",
  });
  delete process.env.POLYGON_RPC_URL;
  const store = new Map();
  const mails = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://api.resend.com")) {
      mails.push(JSON.parse(init.body).subject);
      return Response.json({ id: "test" });
    }
    if (!url.startsWith("https://redis.invalid")) throw new Error(`Unexpected request ${url}`);
    const body = JSON.parse(init.body);
    const run = ([command, key, ...args]) => {
      command = String(command).toLowerCase();
      if (command === "set") {
        const nx = args.map(String).map((a) => a.toLowerCase()).includes("nx");
        if (nx && store.has(key)) return null;
        store.set(key, String(args[0]));
        return "OK";
      }
      if (command === "incr") { const value = Number(store.get(key) || 0) + 1; store.set(key, String(value)); return value; }
      if (command === "del") return store.delete(key) ? 1 : 0;
      if (command === "expire") return 1;
      if (command === "ping") return "PONG";
      return null;
    };
    const result = Array.isArray(body[0]) ? body.map((command) => ({ result: run(command) })) : { result: run(body) };
    return Response.json(result);
  };
  const nextCheck = () => { for (const key of [...store.keys()]) if (key.startsWith("carnetpass:internal-monitor:")) store.delete(key); };
  try { await callback({ store, mails, nextCheck }); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("une seule vérification Polygon en échec n'envoie pas de mail", () => withMonitoring(async ({ mails }) => {
  await runInternalMonitoring();
  assert.deepEqual(mails.filter((subject) => subject.includes("polygon")), []);
}));

test("deux vérifications Polygon en échec de suite envoient une alerte", () => withMonitoring(async ({ mails, nextCheck }) => {
  await runInternalMonitoring();
  nextCheck();
  await runInternalMonitoring();
  assert.equal(mails.filter((subject) => subject.includes("polygon_unavailable")).length, 1);
}));
