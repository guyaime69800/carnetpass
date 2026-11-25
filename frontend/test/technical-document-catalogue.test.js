import test from "node:test";
import assert from "node:assert/strict";
import { loadCataloguedPdf } from "../api/technical-document.js";

function fakeDb(entry, calls = []) {
  return {
    from(table) {
      calls.push(table);
      const query = {
        select() { return query; },
        eq(column, value) { calls.push([column, value]); return query; },
        maybeSingle: async () => ({ data: entry, error: null }),
      };
      return query;
    },
  };
}

const entry = { blob_pathname: "platform-documents/c43b1794-df85-4353-9fd5-2cecec381360.pdf", size_bytes: 4, sha256: "a".repeat(64) };

test("a static document that exists in the catalogue is served from its verified copy", async () => {
  const calls = [];
  const bytes = Buffer.from("%PDF");
  const result = await loadCataloguedPdf(entry.blob_pathname, "production", {
    db: fakeDb(entry, calls),
    loadPdf: async (found, environment) => {
      assert.deepEqual(found, entry);
      assert.equal(environment, "production");
      return { ok: true, bytes };
    },
  });
  assert.equal(result, bytes);
  assert.deepEqual(calls, ["platform_document_intake", ["blob_pathname", entry.blob_pathname], ["status", "approved"]]);
});

test("no catalogue entry, failed verification or unknown location falls back to the old path", async () => {
  const never = async () => { throw new Error("must not load"); };
  assert.equal(await loadCataloguedPdf(entry.blob_pathname, "production", { db: fakeDb(null), loadPdf: never }), null);
  assert.equal(await loadCataloguedPdf(entry.blob_pathname, "production", { db: fakeDb(entry), loadPdf: async () => ({ ok: false }) }), null);
  assert.equal(await loadCataloguedPdf(entry.blob_pathname, "production", { db: fakeDb(entry), loadPdf: async () => { throw new Error("R2 down"); } }), null);
  assert.equal(await loadCataloguedPdf("https://example.invalid/file.pdf", "production", { db: fakeDb(entry), loadPdf: never }), null);
});
