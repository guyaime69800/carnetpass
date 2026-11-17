import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_LIST_COLUMNS, hydrateAdminMetadata, listAdminDocuments } from "./list-admin-documents.js";

// Fausse base qui applique la projection PostgREST utilisée ici :
// « colonne » ou « alias:colonne->clé ».
function projectingClient(rows) {
  return { from: () => ({ select: (columns) => {
    const fields = columns.split(",").map((field) => field.trim());
    const project = (row) => Object.fromEntries(fields.map((field) => {
      const match = /^(\w+):(\w+)->(\w+)$/.exec(field);
      return match ? [match[1], row[match[2]]?.[match[3]] ?? null] : [field, row[field]];
    }));
    const query = { order: () => query, range: async (start, end) => ({ data: rows.slice(start, end + 1).map(project), error: null }) };
    return query;
  } }) };
}

test("liste d'administration : collector_metadata jamais lu en entier, contacts exclus", () => {
  const fields = ADMIN_LIST_COLUMNS.split(",").map((field) => field.trim());
  assert.ok(!fields.includes("collector_metadata"));
  assert.ok(!ADMIN_LIST_COLUMNS.includes("hotlines"));
  assert.ok(fields.includes("_cm_catalogPublication:collector_metadata->catalogPublication"));
  assert.ok(fields.includes("_cm_rights:collector_metadata->rights"));
});

test("liste d'administration : 1 227 fiches gonflées de contacts restent légères, clés utiles conservées", async () => {
  const hotlines = Array.from({ length: 400 }, (_, index) => ({ brand: "Marque", phone: `+33 1 00 00 ${index}`, note: "x".repeat(200) }));
  const rows = Array.from({ length: 1227 }, (_, index) => ({
    id: `id-${index}`, title: "Notice", rag_error: null,
    collector_metadata: index % 3 === 0 ? null : { hotlines, rights: { status: "not_established" },
      catalogPublication: { authorized: true, scope: "catalogue_only" } },
  }));
  const full = Buffer.byteLength(JSON.stringify(rows));
  const { data, error } = await listAdminDocuments(projectingClient(rows), ADMIN_LIST_COLUMNS);
  assert.equal(error, null);
  const documents = hydrateAdminMetadata(data);
  const light = Buffer.byteLength(JSON.stringify(documents));
  assert.equal(documents.length, 1227);
  assert.ok(full > 50 * light, `réduction insuffisante : ${full} -> ${light} octets`);
  assert.equal(documents[0].collector_metadata, null);
  assert.deepEqual(documents[1].collector_metadata.catalogPublication, { authorized: true, scope: "catalogue_only" });
  assert.equal(documents[1].collector_metadata.rights.status, "not_established");
  assert.equal(documents[1].collector_metadata.hotlines, undefined);
  assert.ok(!Object.keys(documents[1]).some((key) => key.startsWith("_cm_")));
});
test("loads older documents beyond the first 50 and 1000 without omission", async () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const ranges = [];
  const client = { from: () => ({ select: () => {
    const query = { order: () => query, range: async (start, end) => {
      ranges.push([start, end]); return { data: rows.slice(start, end + 1), error: null };
    } }; return query;
  } }) };
  const result = await listAdminDocuments(client, "id");
  assert.deepEqual(result.data, rows);
  assert.equal(ranges.length, 5);
});
test("does not return an incomplete list when a later batch fails", async () => {
  const query = { order: () => query, range: async (start) => start === 0
    ? { data: Array.from({ length: 250 }, (_, id) => ({ id })) }
    : { error: { message: "unavailable" } } };
  const result = await listAdminDocuments({ from: () => ({ select: () => query }) }, "id");
  assert.equal(result.data, null);
  assert.ok(result.error);
});
