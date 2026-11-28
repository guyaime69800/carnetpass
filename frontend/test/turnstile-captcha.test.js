import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTION_TURNSTILE_SITE_KEY, captchaReady, turnstileSiteKey } from "../src/lib/turnstile.js";
import handler from "../server/account.js";

test("la clé Turnstile de production ne sert que sur carnetpass.fr", () => {
  assert.equal(turnstileSiteKey("www.carnetpass.fr", {}), PRODUCTION_TURNSTILE_SITE_KEY);
  assert.equal(turnstileSiteKey("carnetpass.fr", {}), PRODUCTION_TURNSTILE_SITE_KEY);
  assert.equal(turnstileSiteKey("carnetpass.fr.example.com", {}), "");
  assert.equal(turnstileSiteKey("localhost", {}), "");
  assert.equal(turnstileSiteKey("test.workers.dev", { VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }), "1x00000000000000000000AA");
});

test("sans clé de site, aucun captcha n'est exigé ; avec clé, il faut un jeton", () => {
  assert.equal(captchaReady("", ""), true);
  assert.equal(captchaReady("", "cle"), false);
  assert.equal(captchaReady("jeton", "cle"), true);
});

test("la vérification serveur du mot de passe transmet le jeton anti-robots", async () => {
  const user = { id: "user", email: "fixture@example.invalid", email_confirmed_at: "2026-10-12" };
  const proofs = [];
  const clientFactory = (_url, key) => key === "public"
    ? { auth: { getUser: async () => ({ data: { user } }), signInWithPassword: async (args) => { proofs.push(args); return { error: {} }; } } }
    : { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null }), then(resolve) { resolve({ data: [] }); } }; } };
  const previous = { ...process.env };
  Object.assign(process.env, { VITE_SUPABASE_URL: "https://example.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SECRET_KEY: "secret" });
  try {
    for (const body of [{ password: "mot-de-passe", captchaToken: "jeton-turnstile" }, { password: "mot-de-passe" }, { password: "mot-de-passe", captchaToken: "x".repeat(3000) }]) {
      const res = { status(code) { this.code = code; return this; }, json() { return this; }, setHeader() {} };
      await handler({ method: "DELETE", headers: { authorization: "Bearer jeton" }, body }, res, { clientFactory, exportRateLimit: async () => {} });
      assert.equal(res.code, 403);
    }
  } finally {
    process.env = previous;
  }
  assert.deepEqual(proofs[0].options, { captchaToken: "jeton-turnstile" });
  assert.equal(proofs[1].options, undefined);
  assert.equal(proofs[2].options, undefined);
});
