import { createHash } from 'node:crypto';
export async function loadPrivateRag(assets, record) {
  if (!record?.documents.length) throw Error('Index documentaire indisponible.');
  const result = { model: null, items: [] };
  for (const document of record.documents) {
    if (!/^\/__carnetpass_private\/rag\/[a-f0-9]{64}\.json$/.test(document.pathname)) throw Error('Chemin d’index invalide.');
    const response = await assets.fetch(new Request('https://private-assets.invalid' + document.pathname));
    if (!response.ok) throw Error('Index privé inaccessible.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== document.bytes || createHash('sha256').update(bytes).digest('hex') !== document.sha256) throw Error('Index privé modifié.');
    const data = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(data.items)) throw Error('Index invalide.');
    result.model ||= data.model || 'text-embedding-3-small';
    result.items.push(...data.items);
  }
  return result;
}
