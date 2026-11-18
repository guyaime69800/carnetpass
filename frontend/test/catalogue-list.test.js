import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCatalogueMetadata, readCatalogueList } from '../server/lib/catalogue-list.js';
import { collectorCatalogAllowed } from '../server/lib/collector-document-policy.js';
import { getCatalogueDocumentMetadata } from '../src/services/platformDocumentLibrary.js';

test('legacy metadata absence requires an explicit server IS NULL result', () => {
  const row = { id: 'legacy', status: 'approved', collector_ingestion_key: null };
  const legacy = hydrateCatalogueMetadata([row], new Set(['legacy']))[0];
  assert.equal(legacy.collector_metadata, null);
  assert.equal(collectorCatalogAllowed(legacy), true);
  const unknown = hydrateCatalogueMetadata([row], new Set())[0];
  assert.deepEqual(unknown.collector_metadata, {});
  assert.equal(collectorCatalogAllowed(unknown), false);
});
test('projection preserves negative validation and does not turn collected entries into legacy', () => {
  const row = { id: 'collected', status: 'approved', collector_ingestion_key: 'unit-test', _cm_phases: { validated: false }, _cm_validation: { humanValidation: 'pending' }, _cm_rights: { status: 'not_established' }, _cm_hotlines: 'must not be trusted' };
  const projected = hydrateCatalogueMetadata([row], new Set())[0];
  assert.equal(projected.collector_metadata.phases.validated, false);
  assert.equal(projected.collector_metadata.validation.humanValidation, 'pending');
  assert.equal(projected.collector_metadata.rights.status, 'not_established');
  assert.equal(collectorCatalogAllowed(projected), false);
  assert.equal(projected._cm_phases, undefined);
  assert.equal(projected._cm_hotlines, undefined);
});
test('metadata absence never authorizes a record that still carries an ingestion key', () => {
  const entry = hydrateCatalogueMetadata([{ id: 'collected', collector_ingestion_key: 'unit-test' }], new Set(['collected']))[0];
  assert.equal(collectorCatalogAllowed(entry), false);
});
test('selected document contacts come from its authenticated metadata response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer unit-session');
    assert.match(url, /id=selected-document&metadata=1/);
    return Response.json({ documents: [{ id: 'selected-document', brand_contact_key: 'pack' }], contactPacks: { pack: { services: [] } } });
  };
  try { assert.deepEqual((await getCatalogueDocumentMetadata('selected-document', 'unit-session')).brand_hotlines, { services: [] }); }
  finally { globalThis.fetch = original; }
});
test('contact metadata refusal is not retried or replaced by invented contacts', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'Access refused' }, { status: 403 }); };
  try { await assert.rejects(getCatalogueDocumentMetadata('selected-document', 'unit-session'), /Access refused/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

function catalogueDatabase(rows) {
  return { from() {
    let fields = '', legacy, limit = 1000;
    return {
      select(value) { fields = value; return this; }, eq() { return this; }, or() { return this; },
      order() { return this; }, abortSignal() { return this; },
      limit(value) { limit = value; return this; },
      is() { legacy = true; return this; }, not() { legacy = false; return this; },
      then(resolve) {
        const matches = rows.filter(row => legacy === (row.collector_metadata === null));
        const data = matches.slice(0, limit).map(row => Object.fromEntries(fields.split(',').map(field => {
          const [alias, expression] = field.split(':');
          return [alias, expression ? row.collector_metadata?.[expression.split('->')[1]] ?? null : row[alias]];
        })));
        resolve({ data, count: matches.length, error: null });
      },
    };
  } };
}
const catalogueRow = (i, legacy) => ({ id: 'unit-' + String(i).padStart(5, '0'), created_at: '2026-11-01T00:00:00.000000+00:00', status: 'approved', collector_metadata: legacy ? null : { phases: { validated: false } } });

test('complete catalogue preserves every row beyond the old 500 limit and merges both metadata types', async () => {
  const rows = Array.from({ length: 1150 }, (_, i) => catalogueRow(i, i < 700));
  const result = await readCatalogueList(catalogueDatabase(rows));
  assert.equal(result.documents.length, 1150);
  assert.equal(result.managedModels.length, 1150);
  assert.equal(new Set(result.documents.map(row => row.id)).size, 1150);
  assert.equal(result.documents[0].id, 'unit-01149');
  assert.equal(result.documents.at(-1).id, 'unit-00000');
});
test('an upstream row cap cannot silently hide catalogue entries', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => catalogueRow(i, true));
  await assert.rejects(readCatalogueList(catalogueDatabase(rows)), { code: 'CATALOGUE_TRUNCATED' });
});
