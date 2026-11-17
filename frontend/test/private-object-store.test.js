import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_R2_SCHEME, deletePrivateObject, getPrivateObject, parsePrivatePathname,
  privateR2Configuration, privateWriteProvider, putPrivateObject,
} from "../server/lib/private-object-store.js";
import { fakeBlob, fakeConfiguration, fakeR2, r2Env, readAll } from "./helpers/fake-private-storage.js";

const PDF = Buffer.from("%PDF-1.7 rapport");
const base = "regulatory/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf";

test("écriture Blob par défaut : aucune activation implicite de R2", async () => {
  assert.equal(privateWriteProvider({}), "blob");
  assert.equal(privateWriteProvider(r2Env()), "blob");
  const blob = fakeBlob();
  const stored = await putPrivateObject(base, PDF, { contentType: "application/pdf", env: {}, deps: { blob } });
  assert.equal(stored.provider, "blob");
  assert.ok(!stored.pathname.startsWith(PRIVATE_R2_SCHEME));
  assert.equal(blob.calls[0].options.access, "private");
});

test("activation R2 avec configuration invalide : refus explicite, pas de repli silencieux", () => {
  assert.throws(() => privateWriteProvider({ CARNETPASS_PRIVATE_R2_WRITE_ENABLED: "true" }), /PRIVATE_R2_ENVIRONMENT_INVALID/);
  assert.throws(() => privateWriteProvider(r2Env("production", { CARNETPASS_PRIVATE_R2_WRITE_ENABLED: "true", R2_PRIVATE_BUCKET_NAME: "carnetpass-documents-production" })), /PRIVATE_R2_BUCKET_INVALID/);
  assert.equal(privateWriteProvider(r2Env("production", { CARNETPASS_PRIVATE_R2_WRITE_ENABLED: "true" })), "r2");
});

test("une Preview ne peut pas viser le compartiment privé de production", () => {
  assert.throws(() => privateR2Configuration(r2Env("preview", { R2_PRIVATE_BUCKET_NAME: "carnetpass-private-files-production" })), /PRIVATE_R2_BUCKET_INVALID/);
  assert.equal(privateR2Configuration(r2Env("preview")).bucket, "carnetpass-private-files-test");
});

test("chemins refusés : traversée, préfixe hors périmètre, double barre", () => {
  for (const bad of ["../x.pdf", "regulatory/../a.pdf", "platform-documents/a.pdf", "/regulatory/a.pdf", "regulatory//a.pdf", `${PRIVATE_R2_SCHEME}platform-documents/a.pdf`]) {
    assert.throws(() => parsePrivatePathname(bad), /PRIVATE_KEY_INVALID/, bad);
  }
});

test("R2 : écriture sans écrasement, suffixe aléatoire, relecture identique", async () => {
  const r2 = fakeR2();
  const deps = { client: r2.client, configuration: fakeConfiguration(), provider: "r2" };
  const first = await putPrivateObject(base, PDF, { contentType: "application/pdf", deps });
  const second = await putPrivateObject(base, PDF, { contentType: "application/pdf", deps });
  assert.ok(first.pathname.startsWith(PRIVATE_R2_SCHEME));
  assert.notEqual(first.pathname, second.pathname);
  assert.match(first.pathname, /-[0-9a-f-]{36}\.pdf$/);
  const put = r2.calls.find((call) => call.name === "PutObjectCommand");
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal(put.input.CacheControl, "private, no-store");
  const read = await getPrivateObject(first.pathname, { deps });
  assert.equal(read.blob.pathname, first.pathname);
  assert.equal(read.blob.contentType, "application/pdf");
  assert.equal(read.blob.size, PDF.length);
  assert.deepEqual(await readAll(read.stream), PDF);
});

test("R2 : objet absent => null (l'appelant renvoie son erreur habituelle)", async () => {
  const r2 = fakeR2();
  assert.equal(await getPrivateObject(`${PRIVATE_R2_SCHEME}${base}`, { deps: { client: r2.client, configuration: fakeConfiguration() } }), null);
});

test("ancien chemin Blob : lecture Blob sans appel R2 tant que le repli n'est pas activé", async () => {
  const blob = fakeBlob();
  const r2 = fakeR2();
  blob.objects.set(base, { bytes: PDF, contentType: "application/pdf" });
  const read = await getPrivateObject(base, { env: r2Env(), deps: { blob, client: r2.client, configuration: fakeConfiguration() } });
  assert.equal(read.provider, "blob");
  assert.equal(r2.calls.length, 0);
});

test("transition : R2 d'abord, repli Blob si la copie R2 manque ou échoue", async () => {
  const env = r2Env("production", { CARNETPASS_PRIVATE_R2_READ_LEGACY: "true" });
  const blob = fakeBlob();
  const r2 = fakeR2();
  blob.objects.set(base, { bytes: PDF, contentType: "application/pdf" });
  const deps = { blob, client: r2.client, configuration: fakeConfiguration() };
  assert.equal((await getPrivateObject(base, { env, deps })).provider, "blob");
  r2.objects.set(base, { bytes: PDF, contentType: "application/pdf" });
  const copied = await getPrivateObject(base, { env, deps });
  assert.equal(copied.provider, "r2-legacy-copy");
  assert.equal(copied.blob.pathname, base);
  const broken = { send: async () => { throw new Error("réseau"); } };
  assert.equal((await getPrivateObject(base, { env, deps: { ...deps, client: broken } })).provider, "blob");
});

test("suppression : routée par préfixe, et copie de transition effacée avec l'ancien Blob", async () => {
  const blob = fakeBlob();
  const r2 = fakeR2();
  const deps = { blob, client: r2.client, configuration: fakeConfiguration() };
  r2.objects.set(base, { bytes: PDF, contentType: "application/pdf" });
  blob.objects.set(base, { bytes: PDF, contentType: "application/pdf" });
  await deletePrivateObject(base, { env: {}, deps });
  assert.equal(blob.objects.has(base), false);
  assert.equal(r2.objects.has(base), false);
  r2.objects.set("regulatory/x.pdf", { bytes: PDF, contentType: "application/pdf" });
  await deletePrivateObject(`${PRIVATE_R2_SCHEME}regulatory/x.pdf`, { deps });
  assert.equal(r2.objects.size, 0);
  assert.equal(blob.calls.filter((call) => call.op === "del").length, 1);
});
