import test from "node:test";
import assert from "node:assert/strict";
import { archiveThermodynamicPdf, discardThermodynamicArchive, readThermodynamicArchive } from "../server/lib/thermodynamic-document-archive.js";
import { fakeBlob, fakeConfiguration, fakeR2 } from "./helpers/fake-private-storage.js";

const ids = {
  companyId: "11111111-1111-4111-8111-111111111111",
  equipmentId: "22222222-2222-4222-8222-222222222222",
  documentId: "33333333-3333-4333-8333-333333333333",
};
const PDF = Buffer.from("%PDF-1.7 fiche fluides");
const row = (stored) => ({ pdf_pathname: stored.pathname, pdf_sha256: stored.sha256, pdf_size_bytes: stored.sizeBytes });

for (const provider of ["blob", "r2"]) {
  test(`fiche clim/PAC (${provider}) : archivage sous l'entreprise et l'équipement, relecture vérifiée`, async () => {
    const r2 = fakeR2();
    const blob = fakeBlob();
    const deps = { provider, blob, client: r2.client, configuration: fakeConfiguration() };
    const stored = await archiveThermodynamicPdf(ids, PDF, { deps });
    assert.ok(stored.pathname.includes(`regulatory/${ids.companyId}/${ids.equipmentId}/${ids.documentId}`));
    assert.equal(stored.pathname.startsWith("r2-private://"), provider === "r2");
    const read = await readThermodynamicArchive(row(stored), { deps });
    assert.equal(read.ok, true);
    assert.deepEqual(read.pdf, PDF);
  });
}

test("fiche clim/PAC : empreinte différente => refus d'intégrité, rien n'est diffusé", async () => {
  const r2 = fakeR2();
  const deps = { provider: "r2", client: r2.client, configuration: fakeConfiguration() };
  const stored = await archiveThermodynamicPdf(ids, PDF, { deps });
  const read = await readThermodynamicArchive({ ...row(stored), pdf_sha256: "0".repeat(64) }, { deps });
  assert.deepEqual(read, { ok: false, reason: "integrity" });
});

test("fiche clim/PAC : taille différente ou objet absent => archive indisponible", async () => {
  const r2 = fakeR2();
  const deps = { provider: "r2", client: r2.client, configuration: fakeConfiguration() };
  const stored = await archiveThermodynamicPdf(ids, PDF, { deps });
  assert.equal((await readThermodynamicArchive({ ...row(stored), pdf_size_bytes: 1 }, { deps })).reason, "unavailable");
  await discardThermodynamicArchive(stored.pathname, { deps });
  assert.equal((await readThermodynamicArchive(row(stored), { deps })).reason, "unavailable");
});

test("fiche clim/PAC : un chemin hors du périmètre réglementaire est refusé sans appel au stockage", async () => {
  const r2 = fakeR2();
  const read = await readThermodynamicArchive({ pdf_pathname: "r2-private://platform-documents/x.pdf", pdf_sha256: "0".repeat(64), pdf_size_bytes: 3 },
    { deps: { client: r2.client, configuration: fakeConfiguration() } });
  assert.equal(read.ok, false);
  assert.equal(r2.calls.length, 0);
});
