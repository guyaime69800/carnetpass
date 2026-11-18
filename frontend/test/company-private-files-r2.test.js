import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { validCleanupPath } from "../server/lib/company-data-cleanup.js";
import { exportCompanyFile } from "../server/lib/company-export-files.js";
import { getPrivateObject } from "../server/lib/private-object-store.js";
import { fakeConfiguration, fakeR2 } from "./helpers/fake-private-storage.js";

const company = "11111111-1111-4111-8111-111111111111";
const other = "44444444-4444-4444-8444-444444444444";
const equipment = "22222222-2222-4222-8222-222222222222";
const attachment = "33333333-3333-4333-8333-333333333333";
const key = `equipment-attachments/${equipment}/${attachment}.pdf`;

test("effacement : les chemins R2 suivent le même périmètre entreprise/équipement que Blob", () => {
  const job = { company_id: company, equipment_id: equipment };
  assert.equal(validCleanupPath({ ...job, pathname: key }), true);
  assert.equal(validCleanupPath({ ...job, pathname: `r2-private://${key}` }), true);
  assert.equal(validCleanupPath({ ...job, pathname: `r2-private://regulatory/${company}/${equipment}/x.pdf` }), true);
  assert.equal(validCleanupPath({ ...job, pathname: `r2-private://regulatory/${other}/${equipment}/x.pdf` }), false);
  assert.equal(validCleanupPath({ ...job, pathname: `r2-private://equipment-attachments/${other}/x.pdf` }), false);
  assert.equal(validCleanupPath({ ...job, pathname: `r2-private://${key}/../x.pdf` }), false);
  assert.equal(validCleanupPath({ ...job, pathname: `r2://platform-documents/sha256/${"a".repeat(64)}.pdf` }), false);
});

function database(row) {
  const filters = {};
  const chain = {
    select() { return chain; },
    eq(column, value) { filters[column] = value; return chain; },
    async maybeSingle() {
      const visible = row && row.company_id === filters.company_id && row.id === filters.id;
      return { data: visible ? row : null, error: null };
    },
  };
  return { from: () => chain };
}

function capture() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.body = () => Buffer.concat(chunks);
  return res;
}

test("export : une pièce jointe stockée dans R2 est relue après contrôle d'entreprise", async () => {
  const r2 = fakeR2();
  const bytes = Buffer.from("%PDF-1.7 facture");
  r2.objects.set(key, { bytes, contentType: "application/pdf" });
  const row = { id: attachment, company_id: company, equipment_id: equipment, blob_pathname: `r2-private://${key}`, size_bytes: bytes.length, deleted_at: null };
  const getter = (pathname) => getPrivateObject(pathname, { deps: { client: r2.client, configuration: fakeConfiguration() } });
  const res = capture();
  await exportCompanyFile(database(row), [{ company_id: company, role: "owner" }], { table: "equipment_private_attachments", id: attachment }, res, getter);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body(), bytes);
});

test("export : une autre entreprise ne peut pas obtenir le fichier R2", async () => {
  const r2 = fakeR2();
  r2.objects.set(key, { bytes: Buffer.from("%PDF-1.7"), contentType: "application/pdf" });
  const row = { id: attachment, company_id: company, equipment_id: equipment, blob_pathname: `r2-private://${key}`, size_bytes: 8, deleted_at: null };
  const getter = (pathname) => getPrivateObject(pathname, { deps: { client: r2.client, configuration: fakeConfiguration() } });
  await assert.rejects(exportCompanyFile(database(row), [{ company_id: other, role: "owner" }], { table: "equipment_private_attachments", id: attachment }, capture(), getter),
    (error) => error.status === 404);
  assert.equal(r2.calls.length, 0);
});

test("export : un chemin R2 hors de l'équipement de la fiche est refusé avant lecture", async () => {
  const r2 = fakeR2();
  const row = { id: attachment, company_id: company, equipment_id: equipment, blob_pathname: `r2-private://equipment-attachments/${other}/${attachment}.pdf`, size_bytes: 8, deleted_at: null };
  const getter = (pathname) => getPrivateObject(pathname, { deps: { client: r2.client, configuration: fakeConfiguration() } });
  await assert.rejects(exportCompanyFile(database(row), [{ company_id: company, role: "admin" }], { table: "equipment_private_attachments", id: attachment }, capture(), getter),
    (error) => error.status === 503);
  assert.equal(r2.calls.length, 0);
});
