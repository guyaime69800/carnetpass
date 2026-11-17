import { collectorCatalogAllowed } from './collector-document-policy.js';
import { createHash } from 'node:crypto';
import { createClient } from "@supabase/supabase-js";
import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireVerifiedCompany } from "./require-verified-company.js";
import { platformDocumentCatalogAllowed, platformDocumentEnvironment } from "./platform-document-environment.js";
import { discoveryDocumentsQuotaAvailable } from "./shiba-quota.js";
import { tryR2Delivery } from "./r2-document-delivery.js";
import { loadPlatformPdf } from "./verify-platform-pdf.js";
import { randomUUID } from "node:crypto";
import { reserveDocumentConsultation } from "./document-consultation-quota.js";
import { verifiedIdentity } from './internal-access.js';
import { readCatalogueList, readCatalogueDocument } from './catalogue-list.js';
function catalogEntry(entry) {
  const {collector_metadata, collector_ingestion_key: _key, ...publicEntry}=entry;
  void _key;
  delete publicEntry.reviewed_by;
  delete publicEntry.status;
  return {...publicEntry,...(collector_metadata?{document_provenance:{source:collector_metadata.source,version:collector_metadata.version,type:collector_metadata.type,rightsStatus:collector_metadata.rights?.status||null,catalogueOnly:collector_metadata.catalogPublication?.scope==='catalogue_only'}}:{})};
}
export function catalogPayload(entries,managedModels){
 const contactPacks={};const documents=entries.filter(entry=>collectorCatalogAllowed(entry)).map(entry=>{const doc=catalogEntry(entry);delete doc.brand_hotlines;if(entry.brand_hotlines){const key=createHash('sha256').update(JSON.stringify(entry.brand_hotlines)).digest('hex');contactPacks[key]||=entry.brand_hotlines;doc.brand_contact_key=key;}return doc;});return {ok:true,documents,contactPacks,managedModels};
}

export async function catalogAccess(req, res, identity = verifiedIdentity, companyAccess = requireVerifiedCompany) {
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1];
  if (token && token.length <= 16384) {
    const account = await identity(token);
    if (account.user?.id && account.role === 'founder' && !account.mfaRequired) {
      return { userId: account.user.id, accessKind: 'admin_catalog' };
    }
  }
  return companyAccess(req, res);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée." });
  const environment = platformDocumentEnvironment(process.env);
  if (environment.status) return res.status(environment.status).json({ error: "Catalogue indisponible." });
  let professional;
  try { professional = await catalogAccess(req, res); }
  catch (error) { console.error('Catalogue : accès', String(error?.name || "Error"), String(error?.code || ""), String(error?.message || "").slice(0, 160)); return res.status(503).json({ error: 'Vérification de l’accès au catalogue momentanément indisponible.' }); }
  if (!professional) return;
  const adminCatalog = professional.accessKind === 'admin_catalog';
  if (!adminCatalog && !platformDocumentCatalogAllowed(environment.name, professional.accessKind)) {
    return res.status(403).json({ error: "Catalogue indisponible pour ce compte." });
  }
  try {
    if (!adminCatalog && !await discoveryDocumentsQuotaAvailable(professional)) {
      return res.status(403).json({ code: "DISCOVERY_QUOTA_REACHED", error: "Les 20 questions de votre essai Découverte ont été utilisées. L’accès aux documents est terminé." });
    }
  } catch (error) {
    console.error('Catalogue : quota', String(error?.name || "Error"), String(error?.code || ""), String(error?.message || "").slice(0, 160));
    return res.status(503).json({ error: "Vérification de l’accès au catalogue momentanément indisponible." });
  }
  if (!process.env.SUPABASE_SECRET_KEY) return res.status(503).json({ error: "Catalogue indisponible." });
  const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, options);
  const id = req.query?.id;
  if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
    return res.status(400).json({ error: "Document invalide." });
  }
  if (req.query?.metadata !== undefined && (req.query.metadata !== '1' || !id)) return res.status(400).json({ error: 'Document invalide.' });
  try {
    if (id && req.query?.metadata === '1') {
      const entry = await readCatalogueDocument(db, id);
      if (!entry || !collectorCatalogAllowed(entry)) return res.status(404).json({ error: 'Document introuvable.' });
      return res.status(200).json(catalogPayload([entry], []));
    }
    if (id) {
      const { data: entry, error } = await db.from("platform_document_intake")
        .select("blob_pathname, size_bytes, sha256, model_name, model_reference, manufacturer, status, reviewed_by, collector_ingestion_key, collector_metadata").eq("id", id).eq("status", "approved")
        .or('distribution_confirmed_at.not.is.null,collector_metadata->catalogPublication->>authorized.eq.true').maybeSingle();
      if (error || !entry || !collectorCatalogAllowed(entry)) return res.status(404).json({ error: "Document introuvable." });
      const receipt = req.query?.consultation || randomUUID();
      if (typeof receipt !== "string" || !/^[0-9a-f-]{36}$/i.test(receipt)) {
        return res.status(400).json({ error: "Consultation invalide." });
      }
      const quota = adminCatalog ? { allowed: true, enforced: false }
        : await reserveDocumentConsultation(professional, id, receipt);
      if (quota.enforced) {
        res.setHeader("X-Document-Limit", String(quota.limit));
        res.setHeader("X-Document-Remaining", String(quota.remaining));
      }
      if (!quota.allowed) return res.status(429).json({ code: "DOCUMENT_DAILY_QUOTA_REACHED",
        error: `Votre limite de ${quota.limit} consultations de notices par jour est atteinte. Revenez demain (heure de Paris).`,
        limit: quota.limit, remaining: 0 });
      if (req.query?.delivery === "url") {
        const delivery = await tryR2Delivery(db, entry);
        if (delivery) return res.status(200).json({ ok: true, ...delivery });
      }
      const stored = await loadPlatformPdf(entry, environment.name,
        pathname => get(pathname, { access: "private", useCache: false }), db);
      if (!stored.ok) {
        return res.status(409).json({ error: "PDF indisponible." });
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline; filename=notice-carnetpass.pdf");
      res.setHeader("Content-Length", String(entry.size_bytes));
      res.setHeader("X-Content-Type-Options", "nosniff");
      await pipeline(Readable.from([stored.bytes]), res);
      return;
    }
    const list = await readCatalogueList(db);
    return res.status(200).json(catalogPayload(list.documents, list.managedModels));
  } catch (error) {
    console.error('Catalogue : lecture', String(error?.name || "Error"), String(error?.code || ""), String(error?.message || "").slice(0, 160));
    if (!res.headersSent) return res.status(503).json({ error: "Catalogue indisponible." });
  }
}
