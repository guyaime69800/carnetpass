import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { equipmentMetadataRegistry } from '../server/lib/equipment-metadata.generated.js';
const source = fs.readFileSync('server/lib/equipment-registry.generated.js', 'utf8');
const imports = new Map([...source.matchAll(/import (rag\d+_\d+) from "\.\.\/\.\.\/src\/data\/rag\/([^"]+)"/g)].map(m => [m[1], m[2]]));
const blocks = source.slice(source.indexOf('export const generatedEquipmentRegistry')).split(/equipmentData: equipment\d+,/).slice(1);
if (blocks.length !== equipmentMetadataRegistry.length) throw Error('Registry mismatch');
const manifest = [];
fs.mkdirSync('dist/__carnetpass_private/rag', { recursive: true });
for (const [index, block] of blocks.entries()) {
  const documents = [];
  for (const symbol of new Set([...block.matchAll(/ragEmbeddingData: (rag\d+_\d+)/g)].map(m => m[1]))) {
    const file = imports.get(symbol); if (!file) throw Error('Missing RAG source');
    const bytes = fs.readFileSync('src/data/rag/' + file), sha256 = createHash('sha256').update(bytes).digest('hex');
    const pathname = `/__carnetpass_private/rag/${sha256}.json`;
    fs.writeFileSync('dist' + pathname, bytes);
    documents.push({ source: file, pathname, sha256, bytes: bytes.length });
  }
  if (!documents.length) throw Error('RAG documents missing');
  manifest.push({ equipmentId: equipmentMetadataRegistry[index].equipmentData.equipmentId, documents });
}
fs.writeFileSync('server/cloudflare/rag-manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Index privés préparés : ${manifest.length} équipements ; aucun téléchargement, aucune réindexation.`);
