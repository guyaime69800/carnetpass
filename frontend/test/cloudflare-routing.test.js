import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { aliases, apiModules } from '../cloudflare/routes.js';
import { resolveRoute, dispatchNode } from '../cloudflare/router.js';
import { deploymentEnvironment, deploymentBranch, previewOrigin } from '../shared/runtime-environment.js';
import { reservePlateBudget } from '../server/plate-scan.js';
import { workerConfiguration, apiConfiguration } from '../cloudflare/environment.js';
import { platformAdminEnvironment } from '../server/lib/platform-admin-environment.js';

test('twenty aliases retain exact target and server-owned flags; all ten direct APIs remain', () => {
  assert.equal(aliases.length, 20); assert.equal(Object.keys(apiModules).length, 10);
  // /api/document only served Vercel Blob, suspended since 16/11/2026: the route is removed.
  assert.equal(resolveRoute(new URL('https://test.invalid/api/document?pathname=x.pdf')), null);
  for (const entry of aliases) {
    const target = new URL(entry.destination, 'https://test.invalid');
    const route = resolveRoute(new URL(entry.source + '?document=exact-id', 'https://test.invalid'));
    assert.equal(route.path, target.pathname); assert.equal(route.load, apiModules[target.pathname]);
    for (const [key, value] of target.searchParams) assert.equal(route.query[key], value);
    assert.equal(route.query.document, 'exact-id');
    assert.throws(() => resolveRoute(new URL(entry.source + '?platform_admin_route=1', 'https://test.invalid')), /Invalid dispatcher/);
  }
  assert.equal(resolveRoute(new URL('https://test.invalid/api/unknown')), null);
  assert.deepEqual(resolveRoute(new URL('https://test.invalid/api/search?q=one&q=two')).query.q, ['one', 'two']);
});
test('hosting identity is explicit and does not invent Vercel variables', () => {
  const env = { CARNETPASS_RUNTIME: 'cloudflare', CARNETPASS_ENV: 'preview', CARNETPASS_RELEASE_BRANCH: 'migration/cloudflare-20261115' };
  assert.equal(deploymentEnvironment(env), 'preview'); assert.equal(deploymentBranch(env), 'migration/cloudflare-20261115');
  assert.equal(env.VERCEL_ENV, undefined);
  assert.equal(deploymentEnvironment({ CARNETPASS_RUNTIME: 'unknown', VERCEL_ENV: 'production' }), 'unconfigured');
  assert.equal(workerConfiguration({ ...env, VITE_SUPABASE_URL: 'https://tsyukqcyfxcrjrhopvpv.supabase.co' }), 'PREVIEW_PRODUCTION_DATABASE_REFUSED');
  assert.equal(apiConfiguration(env), 'BACKEND_CONFIGURATION_REQUIRED');
  const isolated = { ...env, VITE_SUPABASE_URL: 'https://bqqzzbwqmiyxcotvqtoc.supabase.co' };
  assert.equal(platformAdminEnvironment(isolated).name, 'preview');
  assert.ok(platformAdminEnvironment({ ...isolated, CARNETPASS_RELEASE_BRANCH: 'unknown' }).status);
});
test('Node HTTP adapter preserves signed raw bytes and multiple Set-Cookie headers', async () => {
  const raw = Buffer.from('{ "event": "transport-only" }\r\n');
  const expected = createHmac('sha256', 'local-test-only').update(raw).digest('hex');
  const route = { query: { webhook: '1' }, load: async () => ({ config: { api: { bodyParser: false } }, default: async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(createHmac('sha256', 'local-test-only').update(Buffer.concat(chunks)).digest('hex'), expected);
    assert.equal(req.body, undefined); assert.equal(req.query.webhook, '1');
    res.setHeader('Set-Cookie', ['first=one; HttpOnly', 'second=two; HttpOnly']); res.status(200).json({ ok: true });
  } }) };
  const server = createServer((req, res) => dispatchNode(req, res, route));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
    assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('JSON requests are parsed once and malformed JSON is refused', async () => {
  let calls = 0;
  const route = { query: {}, load: async () => ({ default: (req, res) => { calls++; assert.equal(req.body.exact, 'reference'); res.status(200).json({ ok: true }); } }) };
  const server = createServer((req, res) => dispatchNode(req, res, route));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"exact":"reference"}' })).status, 200);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status, 400);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Cloudflare Preview return origin is exact and rejects arbitrary or production hosts', () => {
  const env = { CARNETPASS_RUNTIME: 'cloudflare', CARNETPASS_ENV: 'preview', CARNETPASS_PUBLIC_ORIGIN: 'https://carnetpass-migration-test.example.workers.dev' };
  assert.equal(previewOrigin(env), env.CARNETPASS_PUBLIC_ORIGIN);
  for (const origin of ['https://www.carnetpass.fr', 'https://example.org', 'http://test.carnetpass.fr', 'https://test.carnetpass.fr/redirect', 'https://test.carnetpass.fr?next=x']) {
    assert.throws(() => previewOrigin({ ...env, CARNETPASS_PUBLIC_ORIGIN: origin }), /REFUSED/);
  }
});

test('administrator scan budget stays separate without impersonating Vercel', async () => {
  const settings = { CARNETPASS_RUNTIME: 'cloudflare', CARNETPASS_ENV: 'production', SHIBA_SCAN_BUDGET_SCOPE: 'admin-test' };
  await reservePlateBudget({ eval: async (_script, keys) => { assert.ok(keys.every(k => k.startsWith('carnetpass:plate:admin-test:'))); return 1; } }, 'local-test-only', settings);
  assert.equal(settings.VERCEL_ENV, undefined);
});
