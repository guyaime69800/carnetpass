import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadPrivateRag } from '../server/cloudflare/rag-loader.js';
import { equipmentMetadataRegistry } from '../server/lib/equipment-metadata.generated.js';
import manifest from '../server/cloudflare/rag-manifest.json' with { type: 'json' };

test('private index manifest retains the original exact equipment identities', () => {
  assert.deepEqual(manifest.map(r => r.equipmentId), equipmentMetadataRegistry.map(r => r.equipmentData.equipmentId));
  for (const record of manifest) for (const document of record.documents) {
    const bytes = fs.readFileSync('src/data/rag/' + document.source);
    assert.equal(bytes.length, document.bytes);
    assert.ok(bytes.equals(fs.readFileSync('dist' + document.pathname)));
    assert.ok(document.bytes < 25 * 1024 * 1024);
  }
});

test('one equipment reads only its declared files, verifies hashes and keeps source pages', async () => {
  const selected = manifest[0], calls = [];
  const result = await loadPrivateRag({ fetch: async request => {
    const pathname = new URL(request.url).pathname; calls.push(pathname);
    return new Response(fs.readFileSync('dist' + pathname));
  } }, selected);
  assert.deepEqual(calls, selected.documents.map(d => d.pathname));
  assert.ok(result.items.length > 0);
  const originals = selected.documents.flatMap(d => JSON.parse(fs.readFileSync('src/data/rag/' + d.source, 'utf8')).items);
  assert.deepEqual(result.items, originals);
  await assert.rejects(loadPrivateRag({ fetch: async () => new Response('{}') }, selected), /modifié/);
  await assert.rejects(loadPrivateRag({ fetch: async () => new Response(null, { status: 404 }) }, selected), /inaccessible/);
  await assert.rejects(loadPrivateRag({}, null), /indisponible/);
});
