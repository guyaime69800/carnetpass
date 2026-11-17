import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beginAttachmentR2Upload, completeAttachmentR2Upload } from "../server/lib/equipment-attachment-r2-upload.js";
import { fakeAttachmentsTable, fakeConfiguration, fakeR2, fakeStore } from "./helpers/fake-private-storage.js";

const creator = { companyId: "11111111-1111-4111-8111-111111111111", userId: "55555555-5555-4555-8555-555555555555" };
const intruder = { companyId: "44444444-4444-4444-8444-444444444444", userId: "66666666-6666-4666-8666-666666666666" };
const equipmentId = "22222222-2222-4222-8222-222222222222";
const PDF = Buffer.from("%PDF-1.7 facture chaudière");
const input = (extra = {}) => ({ equipmentId, interventionId: null, documentKind: "invoice", title: "Facture",
  description: null, originalFilename: "facture.pdf", mimeType: "application/pdf", ...extra });

function setup({ dbFail = false } = {}) {
  const r2 = fakeR2();
  const store = fakeStore();
  const db = fakeAttachmentsTable({ fail: dbFail });
  const signed = [];
  const signer = async (_client, command, options) => { signed.push({ input: command.input, options }); return `https://r2.test/${command.input.Key}`; };
  const deps = { store, client: r2.client, configuration: fakeConfiguration(), signer, db, verifyScope: async () => {} };
  // Le navigateur envoie le fichier vers l'URL signée (clé d'attente).
  const browserPut = (started, bytes, contentType = "application/pdf") =>
    r2.client.send(new (class PutObjectCommand { constructor(i) { this.input = i; } })({ Key: new URL(started.url).pathname.slice(1), Body: bytes, ContentType: contentType }));
  return { r2, store, db, signed, deps, browserPut };
}

test("dépôt R2 : URL signée courte, type et taille exacts, ticket lié à l'entreprise et à l'utilisateur serveur", async () => {
  const { store, signed, deps } = setup();
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: PDF.length }, deps);
  assert.equal(started.provider, "r2");
  assert.equal(signed[0].options.expiresIn, 600);
  assert.equal(signed[0].input.ContentType, "application/pdf");
  assert.equal(signed[0].input.ContentLength, PDF.length);
  assert.equal(signed[0].input.Key, `pending-uploads/${started.uploadId}`);
  const ticket = [...store.values.values()][0];
  assert.equal(ticket.companyId, creator.companyId);
  assert.equal(ticket.userId, creator.userId);
});

test("dépôt R2 complet : contrôle du contenu, copie vers une clé finale secrète, enregistrement r2-private://", async () => {
  const { r2, db, deps, browserPut } = setup();
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: PDF.length }, deps);
  await browserPut(started, PDF);
  const result = await completeAttachmentR2Upload({ creator, uploadId: started.uploadId }, deps);
  assert.equal(result.ok, true);
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.match(row.blob_pathname, new RegExp(`^r2-private://equipment-attachments/${equipmentId}/[0-9a-f-]{36}\\.pdf$`));
  assert.ok(!row.blob_pathname.includes(started.uploadId), "la clé finale n'est pas dérivée de l'identifiant connu du navigateur");
  assert.equal(row.company_id, creator.companyId);
  assert.equal(row.sha256, createHash("sha256").update(PDF).digest("hex"));
  assert.equal(r2.objects.has(`pending-uploads/${started.uploadId}`), false);
  // Rejouer la finalisation ne crée pas de doublon.
  assert.deepEqual(await completeAttachmentR2Upload({ creator, uploadId: started.uploadId }, deps), result);
  assert.equal(db.rows.length, 1);
  // Un nouvel envoi vers l'URL signée ne modifie pas le fichier vérifié.
  await browserPut(started, Buffer.from("%PDF-1.7 remplacé après contrôle"));
  const finalKey = row.blob_pathname.slice("r2-private://".length);
  assert.deepEqual(r2.objects.get(finalKey).bytes, PDF);
});

test("dépôt R2 : une autre entreprise ne peut pas finaliser l'envoi", async () => {
  const { db, deps, browserPut } = setup();
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: PDF.length }, deps);
  await browserPut(started, PDF);
  await assert.rejects(completeAttachmentR2Upload({ creator: intruder, uploadId: started.uploadId }, deps), (error) => error.status === 403);
  await assert.rejects(completeAttachmentR2Upload({ creator: { ...creator, userId: intruder.userId }, uploadId: started.uploadId }, deps), (error) => error.status === 403);
  assert.equal(db.rows.length, 0);
});

test("dépôt R2 : contenu réel différent du format annoncé => refus et suppression de l'objet en attente", async () => {
  const { r2, db, deps, browserPut } = setup();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: png.length }, deps);
  await browserPut(started, png);
  await assert.rejects(completeAttachmentR2Upload({ creator, uploadId: started.uploadId }, deps), (error) => error.status === 400 && error.code === "FILE_CONTENT_INVALID");
  assert.equal(db.rows.length, 0);
  assert.equal(r2.objects.size, 0);
});

test("dépôt R2 : taille hors limite, fichier non reçu, identifiant invalide", async () => {
  const { deps } = setup();
  await assert.rejects(beginAttachmentR2Upload({ creator, input: input(), size: 10 * 1024 * 1024 + 1 }, deps), (error) => error.status === 400);
  await assert.rejects(beginAttachmentR2Upload({ creator, input: input(), size: 0 }, deps), (error) => error.status === 400);
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: PDF.length }, deps);
  await assert.rejects(completeAttachmentR2Upload({ creator, uploadId: started.uploadId }, deps), (error) => error.status === 409);
  await assert.rejects(completeAttachmentR2Upload({ creator, uploadId: "../x" }, deps), (error) => error.status === 400);
});

test("dépôt R2 : équipement retiré de l'entreprise entre-temps => aucun enregistrement", async () => {
  const { r2, db, deps, browserPut } = setup();
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: PDF.length }, deps);
  await browserPut(started, PDF);
  const scopeError = Object.assign(new Error("EQUIPMENT_NOT_FOUND"), { status: 404 });
  await assert.rejects(completeAttachmentR2Upload({ creator, uploadId: started.uploadId }, { ...deps, verifyScope: async () => { throw scopeError; } }), (error) => error.status === 404);
  assert.equal(db.rows.length, 0);
  assert.equal(r2.objects.size, 0);
});

test("dépôt R2 : échec d'écriture en base => fichier final supprimé, pas d'objet orphelin vérifié", async () => {
  const { r2, deps, browserPut } = setup({ dbFail: true });
  const started = await beginAttachmentR2Upload({ creator, input: input(), size: PDF.length }, deps);
  await browserPut(started, PDF);
  await assert.rejects(completeAttachmentR2Upload({ creator, uploadId: started.uploadId }, deps), (error) => error.status === 503);
  assert.deepEqual([...r2.objects.keys()], [`pending-uploads/${started.uploadId}`]);
});
