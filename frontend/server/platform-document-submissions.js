import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { del, put } from "@vercel/blob";
import { getPrivateObject } from "./lib/private-object-store.js";
import { r2NativePathname } from "./lib/r2-native-documents.js";
import { storeSubmissionInR2, submissionR2Enabled } from "./lib/platform-submission-r2.js";
import { requireVerifiedCompany } from "./lib/require-verified-company.js";
import { platformDocumentEnvironment, platformDocumentPathname } from "./lib/platform-document-environment.js";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const db = () => createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return fail(res, 405, "Méthode non autorisée.");
  const environment = platformDocumentEnvironment(process.env);
  if (environment.status) return fail(res, environment.status, "Proposition de document indisponible.");
  const professional = await requireVerifiedCompany(req, res);
  if (!professional) return;
  // Production avec CARNETPASS_SUBMISSIONS_R2_ENABLED=true : copie dans R2.
  // Sinon : copie Vercel Blob, comportement historique.
  const r2Submission = submissionR2Enabled(process.env);
  if (!process.env.SUPABASE_SECRET_KEY || (!r2Submission && !process.env.BLOB_STORE_ID)) {
    return fail(res, 503, "Proposition de document momentanément indisponible.");
  }
  const { attachmentId, rightsConfirmed } = req.body || {};
  if (typeof attachmentId !== "string" || !UUID.test(attachmentId) || rightsConfirmed !== true) {
    return fail(res, 400, "Sélectionne un PDF et confirme que tu as le droit de proposer ce document.");
  }

  const database = db();
  const pathname = `platform-documents/${attachmentId}.pdf`;
  if (!platformDocumentPathname(pathname, environment.name)) {
    return fail(res, 400, "Document invalide.");
  }

  try {
    const { data: attachment, error: attachmentError } = await database
      .from("equipment_private_attachments")
      .select("id, equipment_id, document_kind, title, original_filename, mime_type, size_bytes, sha256, blob_pathname")
      .eq("id", attachmentId).eq("company_id", professional.companyId)
      .is("deleted_at", null).maybeSingle();
    if (attachmentError) return fail(res, 503, "Vérification du document indisponible.");
    if (!attachment) return fail(res, 404, "Ce document privé est introuvable dans ton entreprise.");
    if (!["other", "photo"].includes(attachment.document_kind)
      || attachment.mime_type !== "application/pdf" || attachment.size_bytes < 1
      || attachment.size_bytes > MAX_BYTES) {
      return fail(res, 400, "Seul un document technique PDF de 10 Mo maximum peut être proposé au catalogue.");
    }

    const { data: equipment, error: equipmentError } = await database.from("equipments")
      .select("brand, model, product_reference")
      .eq("id", attachment.equipment_id).eq("company_id", professional.companyId).maybeSingle();
    if (equipmentError || !equipment) return fail(res, 503, "Vérification de l’équipement indisponible.");
    const manufacturer = String(equipment.brand || "").trim();
    const modelReference = String(equipment.product_reference || "").trim();
    if (manufacturer.length < 2 || manufacturer.length > 120
      || modelReference.length < 2 || modelReference.length > 160) {
      return fail(res, 400, "Renseigne la marque et la référence constructeur exacte de l’équipement avant de proposer ce PDF.");
    }

    // Une proposition antérieure, Blob ou R2, de la même pièce jointe suffit.
    const nativePathname = r2Submission ? r2NativePathname(attachment.sha256, attachmentId) : null;
    const { data: existingRows, error: existingError } = await database.from("platform_document_intake")
      .select("id, status").in("blob_pathname", nativePathname ? [pathname, nativePathname] : [pathname]).limit(1);
    if (existingError) return fail(res, 503, "Vérification des propositions indisponible.");
    const existing = existingRows?.[0];
    if (existing) return res.status(200).json({ ok: true, status: existing.status, alreadySubmitted: true });

    const { count, error: countError } = await database.from("platform_document_intake")
      .select("id", { count: "exact", head: true })
      .eq("uploaded_by", professional.userId).eq("status", "pending_review");
    if (countError) return fail(res, 503, "Vérification des propositions indisponible.");
    if (count >= 10) return fail(res, 429, "Tu as déjà 10 documents en attente de validation.");

    // Source : pièce jointe privée de l'entreprise, Blob historique ou R2.
    const stored = await getPrivateObject(attachment.blob_pathname);
    if (!stored?.stream || stored.blob?.pathname !== attachment.blob_pathname
      || stored.blob?.contentType !== "application/pdf"
      || stored.blob?.size !== attachment.size_bytes) {
      return fail(res, 409, "Le PDF privé n’est plus disponible ou a changé.");
    }
    const chunks = [];
    const hash = createHash("sha256");
    let size = 0;
    let header = Buffer.alloc(0);
    for await (const chunk of stored.stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BYTES) return fail(res, 400, "Le PDF dépasse 10 Mo.");
      chunks.push(bytes);
      hash.update(bytes);
      if (header.length < 1024) header = Buffer.concat([header, bytes.subarray(0, 1024 - header.length)]);
    }
    const digest = hash.digest("hex");
    if (size !== attachment.size_bytes || digest !== attachment.sha256
      || !header.toString("latin1").includes("%PDF-")) {
      return fail(res, 409, "Le PDF privé ne correspond plus au document enregistré.");
    }

    let storedPathname = pathname;
    let r2Outcome = null;
    if (r2Submission) {
      const stored = await storeSubmissionInR2(database, { documentId: attachmentId, bytes: Buffer.concat(chunks, size), sha256: digest });
      storedPathname = stored.pathname;
      r2Outcome = stored.reused ? "reused" : "verified";
    } else {
      await put(pathname, Buffer.concat(chunks), {
        access: "private", contentType: "application/pdf",
        addRandomSuffix: false, allowOverwrite: false,
      });
    }
    const { error: insertError } = await database.from("platform_document_intake").insert({
      ...(r2Submission ? { id: attachmentId } : {}),
      uploaded_by: professional.userId,
      manufacturer,
      model_reference: modelReference,
      model_name: String(equipment.model || "").trim().slice(0, 160).length >= 2
        ? String(equipment.model).trim().slice(0, 160) : null,
      title: attachment.title,
      original_filename: attachment.original_filename,
      blob_pathname: storedPathname,
      size_bytes: size,
      sha256: digest,
      status: "pending_review",
    });
    if (insertError) {
      // L'objet R2 adressé par empreinte peut être partagé : il est conservé.
      if (r2Submission) return fail(res, 503, "Enregistrement de la proposition impossible. Réessaie.");
      await del(pathname).catch((error) => console.error("Nettoyage du PDF proposé impossible", error));
      return fail(res, 503, "Enregistrement de la proposition impossible. Réessaie.");
    }
    if (r2Outcome) {
      const { error: attemptError } = await database.from("platform_document_r2_attempts").insert({ id: randomUUID(),
        document_id: attachmentId, outcome: r2Outcome, finished_at: new Date().toISOString() });
      if (attemptError) console.error("Suivi R2 de la proposition non enregistré.");
    }
    return res.status(201).json({ ok: true, status: "pending_review" });
  } catch (error) {
    console.error("Proposition de document impossible", error);
    return fail(res, 503, "Proposition de document momentanément indisponible.");
  }
}
