import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { deliverAttachmentFile } from "../server/lib/equipment-attachment-delivery.js";
import { getPrivateObject } from "../server/lib/private-object-store.js";
import { fakeBlob, fakeConfiguration, fakeR2 } from "./helpers/fake-private-storage.js";

const equipment = "22222222-2222-4222-8222-222222222222";
const key = `equipment-attachments/${equipment}/33333333-3333-4333-8333-333333333333.pdf`;
const bytes = Buffer.from("%PDF-1.7 devis");

function capture() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.body = () => Buffer.concat(chunks);
  return res;
}

const row = (pathname, extra = {}) => ({ blob_pathname: pathname, mime_type: "application/pdf", size_bytes: bytes.length, original_filename: "devis été.pdf", ...extra });

test("pièce jointe R2 : diffusée en privé, sans cache, après contrôle de chemin/type/taille", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes, contentType: "application/pdf" });
  const getter = (pathname) => getPrivateObject(pathname, { deps: { client: r2.client, configuration: fakeConfiguration() } });
  const res = capture();
  await deliverAttachmentFile(res, row(`r2-private://${key}`), "download", getter);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body(), bytes);
  assert.equal(res.headers["cache-control"], "private, no-store, max-age=0");
  assert.match(res.headers["content-disposition"], /^attachment;/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("pièce jointe Blob historique : toujours lisible (retour arrière)", async () => {
  const blob = fakeBlob();
  blob.objects.set(key, { bytes, contentType: "application/pdf" });
  const res = capture();
  await deliverAttachmentFile(res, row(key), "view", (pathname) => getPrivateObject(pathname, { env: {}, deps: { blob } }));
  assert.deepEqual(res.body(), bytes);
  assert.match(res.headers["content-disposition"], /^inline;/);
});

test("API : sans activation R2, le dépôt R2 est refusé et le navigateur revient au dépôt Blob", async () => {
  const { default: handler } = await import("../api/equipment-attachments.js");
  const previous = process.env.CARNETPASS_PRIVATE_R2_WRITE_ENABLED;
  delete process.env.CARNETPASS_PRIVATE_R2_WRITE_ENABLED;
  try {
    let status;
    let payload;
    const res = { headersSent: false, setHeader() {}, status(code) { status = code; return this; }, json(value) { payload = value; return this; } };
    await handler({ method: "POST", headers: {}, body: { type: "attachment.r2.begin" } }, res);
    assert.equal(status, 409);
    assert.equal(payload.code, "UPLOAD_PROVIDER_BLOB");
  } finally {
    if (previous !== undefined) process.env.CARNETPASS_PRIVATE_R2_WRITE_ENABLED = previous;
  }
});

test("pièce jointe : taille ou type divergents => 409, fichier absent => 410, chemin invalide => 409", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes, contentType: "application/pdf" });
  const getter = (pathname) => getPrivateObject(pathname, { deps: { client: r2.client, configuration: fakeConfiguration() } });
  await assert.rejects(deliverAttachmentFile(capture(), row(`r2-private://${key}`, { size_bytes: 1 }), "view", getter), (error) => error.status === 409);
  await assert.rejects(deliverAttachmentFile(capture(), row(`r2-private://${key}`, { mime_type: "image/png" }), "view", getter), (error) => error.status === 409);
  await assert.rejects(deliverAttachmentFile(capture(), row(`r2-private://${key}.absent`), "view", getter), (error) => error.status === 410);
  await assert.rejects(deliverAttachmentFile(capture(), row("r2-private://platform-documents/x.pdf"), "view", getter), (error) => error.status === 409);
});
