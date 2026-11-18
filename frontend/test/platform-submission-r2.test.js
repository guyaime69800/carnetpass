import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { storeSubmissionInR2, submissionR2Enabled } from "../server/lib/platform-submission-r2.js";
import { fakeR2 } from "./helpers/fake-private-storage.js";

const env = { CARNETPASS_RUNTIME: "cloudflare", CARNETPASS_ENV: "production", CARNETPASS_SUBMISSIONS_R2_ENABLED: "true" };
const configuration = { bucket: "carnetpass-documents-production" };
const documentId = "33333333-3333-4333-8333-333333333333";
const bytes = Buffer.from("%PDF-1.7 notice proposée");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const key = `platform-documents/sha256/${sha256}.pdf`;

function copiesTable(initial = null) {
  const state = { row: initial, upserts: 0 };
  return { state, from(table) {
    assert.equal(table, "platform_document_r2_copies");
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: state.row, error: null }),
      upsert: async (row) => { state.upserts++; state.row ??= row; return { error: null }; } };
    return chain;
  } };
}

test("proposition R2 : désactivée par défaut et hors production", async () => {
  assert.equal(submissionR2Enabled({}), false);
  assert.equal(submissionR2Enabled({ ...env, CARNETPASS_ENV: "preview" }), false);
  assert.equal(submissionR2Enabled({ ...env, CARNETPASS_SUBMISSIONS_R2_ENABLED: "false" }), false);
  const r2 = fakeR2();
  await assert.rejects(storeSubmissionInR2(copiesTable(), { documentId, bytes, sha256 }, { env: {}, client: r2.client, configuration }), /SUBMISSION_R2_DISABLED/);
  assert.equal(r2.calls.length, 0);
});

test("proposition R2 : objet adressé par empreinte, sans écrasement, correspondance vérifiée", async () => {
  const r2 = fakeR2();
  const db = copiesTable();
  const result = await storeSubmissionInR2(db, { documentId, bytes, sha256 }, { env, client: r2.client, configuration });
  assert.deepEqual(result, { pathname: `r2://${key}#${documentId}`, reused: false });
  const put = r2.calls.find((call) => call.name === "PutObjectCommand");
  assert.equal(put.input.Key, key);
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal(put.input.Metadata.sha256, sha256);
  assert.equal(db.state.row.object_key, key);
  assert.ok(db.state.row.verified_at);
});

test("proposition R2 : contenu déjà présent et suivi => réutilisé sans nouvelle écriture", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes, contentType: "application/pdf", metadata: { sha256 } });
  const db = copiesTable({ sha256, size_bytes: bytes.length, object_key: key, verified_at: "2026-11-16T10:10:00Z" });
  const result = await storeSubmissionInR2(db, { documentId, bytes, sha256 }, { env, client: r2.client, configuration });
  assert.equal(result.reused, true);
  assert.equal(r2.calls.filter((call) => call.name === "PutObjectCommand").length, 0);
  assert.equal(db.state.upserts, 0);
});

test("proposition R2 : objet présent sans suivi => jamais écrasé, seulement vérifié puis suivi", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes, contentType: "application/pdf", metadata: { sha256 } });
  const db = copiesTable();
  const result = await storeSubmissionInR2(db, { documentId, bytes, sha256 }, { env, client: r2.client, configuration });
  assert.equal(result.reused, false);
  assert.equal(db.state.upserts, 1);
  assert.deepEqual(r2.objects.get(key).bytes, bytes);
});

test("proposition R2 : objet existant divergent ou suivi incohérent => refus, aucune correspondance", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes: Buffer.from("%PDF-1.7 autre contenu!!"), contentType: "application/pdf", metadata: { sha256 } });
  const db = copiesTable();
  await assert.rejects(storeSubmissionInR2(db, { documentId, bytes, sha256 }, { env, client: r2.client, configuration }));
  assert.equal(db.state.upserts, 0);
  const inconsistent = copiesTable({ sha256, size_bytes: 1, object_key: key, verified_at: "2026-11-16T10:10:00Z" });
  await assert.rejects(storeSubmissionInR2(inconsistent, { documentId, bytes, sha256 }, { env, client: fakeR2().client, configuration }), /R2_TRACKING_INCONSISTENT/);
});

test("proposition R2 : objet sans métadonnée d'empreinte => refus (la lecture catalogue l'exigerait)", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes, contentType: "application/pdf" });
  const db = copiesTable();
  await assert.rejects(storeSubmissionInR2(db, { documentId, bytes, sha256 }, { env, client: r2.client, configuration }), /R2_OBJECT_INCONSISTENT/);
  assert.equal(db.state.upserts, 0);
});
