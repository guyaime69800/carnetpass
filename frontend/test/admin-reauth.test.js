import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_AUTH_MAX_AGE_SECONDS, mfaAccessError, primaryAuthenticationTime } from "../server/lib/mfa-access.js";
import { verifiedIdentity } from "../server/lib/internal-access.js";
import accessSession from "../server/access-session.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const nowSeconds = Math.floor(NOW / 1000);
const user = { id: "11111111-1111-4111-8111-111111111111", email_confirmed_at: "2026-01-01", factors: [{ status: "verified", factor_type: "totp" }] };
const token = (amr, aal = "aal2", sub = user.id) =>
  `header.${Buffer.from(JSON.stringify({ sub, aal, amr })).toString("base64url")}.signature`;
const signedIn = (secondsAgo, extra = []) => [{ method: "password", timestamp: nowSeconds - secondsAgo }, ...extra];
// Handlers use the real clock.
const liveSignedIn = (secondsAgo) => [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - secondsAgo }];

test("internal access accepts a sign-in younger than 12 hours", () => {
  assert.equal(ADMIN_AUTH_MAX_AGE_SECONDS, 43200);
  assert.equal(mfaAccessError(user, token(signedIn(60)), { required: true, now: NOW }), null);
  assert.equal(mfaAccessError(user, token(signedIn(43200)), { required: true, now: NOW }), null);
});

test("internal access refuses a sign-in older than 12 hours, even with a recent code", () => {
  const stale = mfaAccessError(user, token(signedIn(43201)), { required: true, now: NOW });
  assert.equal(stale.code, "REAUTH_REQUIRED");
  assert.equal(stale.status, 401);
  // A second factor alone never renews the 12-hour window.
  const recentCode = signedIn(86400, [{ method: "totp", timestamp: nowSeconds - 10 }]);
  assert.equal(mfaAccessError(user, token(recentCode), { required: true, now: NOW }).code, "REAUTH_REQUIRED");
  assert.equal(mfaAccessError(user, token([{ method: "totp", timestamp: nowSeconds }]), { required: true, now: NOW }).code, "REAUTH_REQUIRED");
});

test("missing or malformed sign-in times are refused for internal access", () => {
  for (const amr of [undefined, [], "password", [{ method: "password" }], [{ method: "password", timestamp: "x" }]]) {
    assert.equal(mfaAccessError(user, token(amr), { required: true, now: NOW }).code, "REAUTH_REQUIRED");
  }
  assert.equal(primaryAuthenticationTime({ amr: [{ method: "password", timestamp: 5 }, { method: "otp", timestamp: 9 }] }), 9);
});

test("MFA checks keep priority and regular accounts keep long sessions", () => {
  assert.equal(mfaAccessError(user, token(signedIn(60), "aal1"), { required: true, now: NOW }).code, "MFA_REQUIRED");
  assert.equal(mfaAccessError(user, token(signedIn(60), "aal2", "other"), { required: true, now: NOW }).code, "MFA_REQUIRED");
  // Non-internal checks (clients with optional MFA) are not time-limited.
  assert.equal(mfaAccessError(user, token(signedIn(30 * 86400)), { now: NOW }), null);
});

async function withAuth(role, callback) {
  const keys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "VERCEL_ENV", "CARNETPASS_ENV"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "public-test", SUPABASE_SECRET_KEY: "secret-test", VERCEL_ENV: "preview", CARNETPASS_ENV: "preview" });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json(user);
    if (url.includes("/platform_admins")) return Response.json(role ? [{ role }] : []);
    throw new Error(`unexpected fetch ${url}`);
  };
  try { await callback(); } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("a stale founder session loses its role and is asked to sign in again", async () => {
  await withAuth("founder", async () => {
    const stale = await verifiedIdentity(token(liveSignedIn(13 * 3600)));
    assert.equal(stale.role, null);
    assert.equal(stale.reauthRequired, true);
    assert.equal(stale.mfaRequired, false);
    const fresh = await verifiedIdentity(token(liveSignedIn(3600)));
    assert.equal(fresh.role, "founder");
    assert.equal(fresh.reauthRequired, false);
  });
});

test("a stale session never receives the internal cookie", async () => {
  await withAuth("founder", async () => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const bearer = token(liveSignedIn(13 * 3600));
    await accessSession({ method: "POST", headers: { host: "carnetpass.fr", origin: "https://carnetpass.fr", authorization: `Bearer ${bearer}` } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.reauthRequired, true);
    assert.equal(res.body.role, null);
    assert.match(res.headers["set-cookie"], /Max-Age=0/);
    assert.doesNotMatch(res.headers["set-cookie"], new RegExp(bearer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("regular users are unaffected by the internal time limit", async () => {
  await withAuth(null, async () => {
    const identity = await verifiedIdentity(token(liveSignedIn(30 * 86400)));
    assert.equal(identity.role, null);
    assert.equal(identity.reauthRequired, false);
    assert.equal(identity.mfaRequired, false);
  });
});
