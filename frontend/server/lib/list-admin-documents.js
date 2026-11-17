import { METADATA_KEYS } from "./catalogue-list.js";

export async function listAdminDocuments(client, columns) {
  const documents = [];
  const batchSize = 250;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await client.from("platform_document_intake").select(columns)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) return { data: null, error };
    documents.push(...data);
    if (data.length < batchSize) return { data: documents, error: null };
  }
}

// Liste d'administration allégée : comme pour le catalogue pro (incident du
// 9 novembre), `collector_metadata` n'est jamais lu en entier. Les contacts
// répétés (`collector_metadata.hotlines`, ≈ 59 Mo pour 500 fiches) restent en
// base ; seules les clés de politique documentaire sont projetées.
const ADMIN_BASE_COLUMNS = "id, blob_pathname, manufacturer, model_name, model_reference, title, original_filename, size_bytes, sha256, status, catalog_category, distribution_confirmed_at, hotline_phone, model_aliases, rag_status, rag_error, rag_started_at, rag_indexed_at, created_at, collector_ingestion_key";
export const ADMIN_LIST_COLUMNS = ADMIN_BASE_COLUMNS + ", "
  + METADATA_KEYS.map((key) => `_cm_${key}:collector_metadata->${key}`).join(", ");

// Reconstitue un `collector_metadata` partiel. Sans aucune clé projetée, la
// valeur est null : les écrans d'administration ne lisent que
// catalogPublication et rights, toujours avec un accès facultatif. Cette liste
// ne sert à aucune décision serveur de diffusion ou d'indexation.
export function hydrateAdminMetadata(rows) {
  return rows.map((row) => {
    const entry = { ...row };
    const metadata = {};
    for (const key of METADATA_KEYS) {
      const value = entry[`_cm_${key}`];
      if (value !== null && value !== undefined) metadata[key] = value;
      delete entry[`_cm_${key}`];
    }
    entry.collector_metadata = Object.keys(metadata).length ? metadata : null;
    return entry;
  });
}
