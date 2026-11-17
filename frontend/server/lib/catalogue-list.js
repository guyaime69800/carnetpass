// Read the complete lightweight catalogue. Large contact packs are read only for a selected document.
export const METADATA_KEYS = ['source', 'version', 'type', 'rights', 'phases', 'identity', 'validation', 'technicalVerification', 'processingAuthorization', 'testDocument', 'catalogPublication', 'documentaryReview'];
export const DOCUMENT_FIELDS = 'id,manufacturer,model_name,model_reference,title,catalog_category,hotline_phone,brand_hotlines,model_aliases,rag_status,sha256,size_bytes,status,reviewed_by,collector_ingestion_key,collector_metadata';
const BASE_FIELDS = 'created_at,' + DOCUMENT_FIELDS.split(',').filter(field => !['brand_hotlines', 'collector_metadata'].includes(field)).join(',');
const LIGHT_FIELDS = BASE_FIELDS + ',' + METADATA_KEYS.map(key => `_cm_${key}:collector_metadata->${key}`).join(',');
const PUBLICATION_FILTER = 'distribution_confirmed_at.not.is.null,collector_metadata->catalogPublication->>authorized.eq.true';

function published(db, fields) {
  return db.from('platform_document_intake').select(fields, { count: 'exact' }).eq('status', 'approved').or(PUBLICATION_FILTER);
}
export function hydrateCatalogueMetadata(rows, legacyIds) {
  return rows.map(row => {
    const entry = { ...row }, metadata = {};
    for (const key of METADATA_KEYS) {
      const value = entry['_cm_' + key];
      if (value !== null && value !== undefined) metadata[key] = value;
      delete entry['_cm_' + key];
    }
    for (const key of Object.keys(entry)) if (key.startsWith('_cm_')) delete entry[key];
    // Only an explicit server-side IS NULL query may establish legacy metadata absence.
    // Empty/unrecognized metadata must remain an object so policy checks fail closed.
    entry.collector_metadata = legacyIds.has(entry.id) ? null : metadata;
    return entry;
  });
}
export async function readCatalogueList(db) {
  const signal = AbortSignal.timeout(15000);
  const ordered = query => query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000).abortSignal(signal);
  const complete = result => {
    if (!result.error && (!Array.isArray(result.data) || result.count === null || result.data.length !== result.count)) {
      throw Object.assign(new Error('Le catalogue complet ne peut pas être chargé.'), { code: 'CATALOGUE_TRUNCATED' });
    }
    return result;
  };
  const subset = async legacy => {
    const scoped = fields => {
      const query = published(db, fields);
      return ordered(legacy ? query.is('collector_metadata', null) : query.not('collector_metadata', 'is', null));
    };
    const fields = legacy ? BASE_FIELDS : LIGHT_FIELDS;
    let result = await scoped(fields);
    if (result.error) result = await scoped(fields.replace(',rag_status', ''));
    return complete(result);
  };
  const managedSubset = async legacy => {
    const query = db.from('platform_document_intake').select('created_at,id,manufacturer,model_name,model_reference,catalog_category,model_aliases', { count: 'exact' });
    return complete(await ordered(legacy ? query.is('collector_metadata', null) : query.not('collector_metadata', 'is', null)));
  };
  const [managedLegacy, managedCollected, legacy, collected] = await Promise.all([
    managedSubset(true), managedSubset(false),
    subset(true), subset(false),
  ]);
  const error = managedLegacy.error || managedCollected.error || legacy.error || collected.error;
  if (error) throw Object.assign(new Error('Catalogue indisponible.'), { code: error.code });
  // Nullness and projected fields are read in the same SQL statement per subset.
  // This prevents a concurrent metadata update from being mistaken for a legacy record.
  const documents = [
    ...hydrateCatalogueMetadata(legacy.data, new Set(legacy.data.map(row => row.id))),
    ...hydrateCatalogueMetadata(collected.data, new Set()),
  ];
  const micros = value => Date.parse(value) * 1000 + Number((String(value).match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3, 6));
  const orderedRows = rows => [...new Map(rows.map(row => [row.id, row])).values()]
    .sort((a, b) => micros(b.created_at) - micros(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map(row => { const entry = { ...row }; delete entry.created_at; return entry; });
  return { documents: orderedRows(documents), managedModels: orderedRows([...managedLegacy.data, ...managedCollected.data]) };
}
export async function readCatalogueDocument(db, id) {
  let result = await published(db, DOCUMENT_FIELDS).eq('id', id).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
  if (result.error) result = await published(db, DOCUMENT_FIELDS.replace(',rag_status', '')).eq('id', id).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
  if (result.error) throw new Error('Document indisponible.');
  return result.data;
}
