import { createHash } from "node:crypto";
import { deletePrivateObject, getPrivateObject, putPrivateObject } from "./private-object-store.js";

// Archive PDF privée des fiches clim/PAC. Le chemin contient l'entreprise et
// l'équipement ; le fournisseur (Blob ou R2) est choisi par private-object-store.

export function thermodynamicArchiveBase(companyId, equipmentId, documentId) {
  return `regulatory/${companyId}/${equipmentId}/${documentId}.pdf`;
}

export async function archiveThermodynamicPdf({ companyId, equipmentId, documentId }, pdf, options = {}) {
  const stored = await putPrivateObject(thermodynamicArchiveBase(companyId, equipmentId, documentId), pdf,
    { ...options, contentType: "application/pdf" });
  return {
    pathname: stored.pathname,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    sizeBytes: pdf.length,
  };
}

// Relit l'archive et vérifie chemin, type, taille et empreinte enregistrés.
// Retourne { ok:false, reason } au lieu de diffuser un fichier non conforme.
export async function readThermodynamicArchive(row, options = {}) {
  let stored;
  try { stored = await getPrivateObject(row.pdf_pathname, options); }
  catch { return { ok: false, reason: "unavailable" }; }
  if (!stored?.stream || stored.blob?.pathname !== row.pdf_pathname
    || stored.blob?.contentType !== "application/pdf"
    || stored.blob?.size !== row.pdf_size_bytes) return { ok: false, reason: "unavailable" };
  const pdf = Buffer.from(await new Response(stored.stream).arrayBuffer());
  if (createHash("sha256").update(pdf).digest("hex") !== row.pdf_sha256) return { ok: false, reason: "integrity" };
  return { ok: true, pdf };
}

export async function discardThermodynamicArchive(pathname, options = {}) {
  if (pathname) await deletePrivateObject(pathname, options).catch(() => {});
}
