import { createHash, randomUUID } from "node:crypto";
import { PRIVATE_R2_SCHEME, privateR2Configuration, validatePrivateKey } from "./private-object-store.js";

// Dépôt d'une pièce jointe privée dans R2, en deux temps :
//
// 1. begin : l'API (après contrôle session, entreprise, équipement, quotas)
//    délivre une URL d'envoi signée de 10 minutes vers une clé d'ATTENTE
//    `pending-uploads/<uploadId>`, avec type et taille exacts signés.
// 2. complete : l'API relit l'objet en attente (taille, type réel, SHA-256),
//    puis réécrit ELLE-MÊME les octets vérifiés (10 Mio max) vers une clé
//    FINALE tirée au hasard côté serveur, jamais communiquée au navigateur :
//    l'URL d'envoi ne peut donc pas remplacer le fichier après vérification.
//    L'objet en attente est supprimé. Pas de CopyObject : sa réponse XML n'est
//    pas lisible par le SDK AWS dans un Worker (DOMParser absent).
//
// Une règle de cycle de vie R2 sur `pending-uploads/` (à décider) effacera les
// envois abandonnés. Ce module ne contrôle pas les droits : l'appelant le fait.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const TICKET_TTL_SECONDS = 3600;
const URL_TTL_SECONDS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSIONS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const ticketKey = (uploadId) => `carnetpass:attachments:r2:${uploadId}`;
const pendingKey = (uploadId) => `pending-uploads/${uploadId}`;
const failure = (status, code, publicMessage) =>
  Object.assign(new Error(code), { status, code, publicMessage });
// Dans un Worker, le corps XML d'une erreur S3 n'est pas désérialisable :
// on s'appuie aussi sur le statut HTTP brut.
const httpStatus = (error) => error?.$metadata?.httpStatusCode ?? error?.$response?.statusCode;

export function detectMimeType(header) {
  if (header.length >= 5 && header.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  // Certains PDF contiennent quelques octets avant leur en-tête.
  if (header.toString("latin1").includes("%PDF-")) return "application/pdf";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF"
    && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function s3() { return import("@aws-sdk/client-s3"); }

async function clientFor(deps) {
  const configuration = deps.configuration || privateR2Configuration(deps.env || process.env);
  if (deps.client) return { client: deps.client, configuration, owned: false };
  const { r2Client } = await import("./r2-document-storage.js");
  return { client: r2Client(configuration), configuration, owned: true };
}

function finalKey(equipmentId, mimeType, randomId) {
  return validatePrivateKey(`equipment-attachments/${equipmentId}/${randomId()}.${EXTENSIONS[mimeType]}`);
}

// `input` vient de l'analyse existante (parseClientPayload) ; `creator` de
// requireVerifiedCompany. Rien ici ne fait confiance au navigateur pour
// l'entreprise ou l'utilisateur.
export async function beginAttachmentR2Upload({ creator, input, size }, deps) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
    throw failure(400, "FILE_SIZE_INVALID", "Le fichier doit contenir des données et ne pas dépasser 10 Mo.");
  }
  if (!EXTENSIONS[input.mimeType]) throw failure(400, "FILE_TYPE_FORBIDDEN", "Seuls les fichiers PDF, JPEG, PNG et WebP sont autorisés.");
  const randomId = deps.randomId || randomUUID;
  const uploadId = randomId();
  const { client, configuration, owned } = await clientFor(deps);
  try {
    const { PutObjectCommand } = await s3();
    const signer = deps.signer || (await import("@aws-sdk/s3-request-presigner")).getSignedUrl;
    const url = await signer(client, new PutObjectCommand({
      Bucket: configuration.bucket, Key: pendingKey(uploadId), ContentType: input.mimeType, ContentLength: size,
    }), { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) });
    await deps.store.set(ticketKey(uploadId), {
      version: 1, uploadId, companyId: creator.companyId, userId: creator.userId,
      equipmentId: input.equipmentId, interventionId: input.interventionId, documentKind: input.documentKind,
      title: input.title, description: input.description, originalFilename: input.originalFilename,
      mimeType: input.mimeType, size,
    }, { ex: TICKET_TTL_SECONDS });
    return { ok: true, provider: "r2", uploadId, url, headers: { "Content-Type": input.mimeType }, expiresInSeconds: URL_TTL_SECONDS };
  } finally { if (owned) client.destroy?.(); }
}

async function inspectPending(client, bucket, key, ticket) {
  const { GetObjectCommand } = await s3();
  let stored;
  try {
    stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(60_000) });
  } catch (error) {
    if (error?.name === "NoSuchKey" || httpStatus(error) === 404) {
      throw failure(409, "UPLOAD_NOT_RECEIVED", "Le fichier n'a pas encore été reçu. Réessaie l'envoi.");
    }
    throw error;
  }
  const invalid = () => failure(400, "FILE_CONTENT_INVALID", "Le contenu réel du fichier ne correspond pas au format annoncé.");
  if (Number(stored.ContentLength) !== ticket.size || stored.ContentType !== ticket.mimeType || !stored.Body) throw invalid();
  const stream = typeof stored.Body.transformToWebStream === "function" ? stored.Body.transformToWebStream() : stored.Body;
  const hash = createHash("sha256");
  const parts = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > ticket.size || total > MAX_ATTACHMENT_BYTES) throw invalid();
    hash.update(bytes);
    parts.push(bytes);
  }
  const content = Buffer.concat(parts, total);
  if (total !== ticket.size || detectMimeType(content.subarray(0, 1_024)) !== ticket.mimeType) throw invalid();
  return { sha256: hash.digest("hex"), content };
}

// deps.verifyScope(ticket) : l'appelant revérifie que l'équipement et
// l'intervention appartiennent toujours à l'entreprise (404 sinon).
// deps.db : client Supabase serveur.
export async function completeAttachmentR2Upload({ creator, uploadId }, deps) {
  if (typeof uploadId !== "string" || !UUID.test(uploadId)) throw failure(400, "UPLOAD_REQUEST_INVALID", "La demande d'envoi du fichier est invalide.");
  const ticket = await deps.store.get(ticketKey(uploadId));
  if (!ticket || ticket.version !== 1 || ticket.uploadId !== uploadId
    || ticket.userId !== creator.userId || ticket.companyId !== creator.companyId) {
    throw failure(403, "UPLOAD_FORBIDDEN", "Cet envoi de fichier est expiré ou n'est pas autorisé.");
  }
  if (ticket.result) return ticket.result;
  const lock = `${ticketKey(uploadId)}:lock`;
  const owner = (deps.randomId || randomUUID)();
  if (!await deps.store.set(lock, owner, { nx: true, ex: 600 })) throw failure(409, "UPLOAD_IN_PROGRESS", "La vérification de ce fichier est déjà en cours.");
  const { client, configuration, owned } = await clientFor(deps);
  const { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } = await s3();
  const removePending = () => client.send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: pendingKey(uploadId) })).catch(() => {});
  try {
    try { await deps.verifyScope(ticket); }
    catch (error) { if (error?.status === 404) await removePending(); throw error; }
    let inspected;
    try { inspected = await inspectPending(client, configuration.bucket, pendingKey(uploadId), ticket); }
    catch (error) { if (error?.status === 400) await removePending(); throw error; }
    const key = finalKey(ticket.equipmentId, ticket.mimeType, deps.randomId || randomUUID);
    await client.send(new PutObjectCommand({
      Bucket: configuration.bucket, Key: key, Body: inspected.content, ContentLength: inspected.content.length,
      Metadata: { sha256: inspected.sha256 }, ContentType: ticket.mimeType, CacheControl: "private, no-store",
      IfNoneMatch: "*",
    }), { abortSignal: AbortSignal.timeout(60_000) });
    const head = await client.send(new HeadObjectCommand({ Bucket: configuration.bucket, Key: key }));
    if (Number(head.ContentLength) !== ticket.size || head.ContentType !== ticket.mimeType || head.Metadata?.sha256 !== inspected.sha256) {
      throw failure(503, "UPLOAD_VERIFICATION_FAILED", "La vérification du fichier a échoué. Réessaie.");
    }
    const pathname = PRIVATE_R2_SCHEME + key;
    const { error } = await deps.db.from("equipment_private_attachments").upsert({
      company_id: ticket.companyId, equipment_id: ticket.equipmentId, intervention_id: ticket.interventionId,
      uploaded_by: ticket.userId, document_kind: ticket.documentKind, title: ticket.title,
      description: ticket.description, original_filename: ticket.originalFilename, mime_type: ticket.mimeType,
      size_bytes: ticket.size, blob_url: pathname, blob_pathname: pathname, sha256: inspected.sha256,
    }, { onConflict: "blob_pathname", ignoreDuplicates: true });
    if (error) {
      await client.send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: key })).catch(() => {});
      throw failure(503, "DATABASE_UNAVAILABLE", "L'enregistrement de la pièce jointe a échoué. Réessaie.");
    }
    const result = { ok: true, provider: "r2", sizeBytes: ticket.size, sha256: inspected.sha256 };
    await deps.store.set(ticketKey(uploadId), { ...ticket, result }, { ex: TICKET_TTL_SECONDS });
    await removePending();
    return result;
  } finally {
    if (owned) client.destroy?.();
    // Libère le verrou seulement s'il nous appartient encore.
    if (typeof deps.store.eval === "function") {
      await deps.store.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        [lock], [owner]).catch(() => {});
    } else if (await deps.store.get(lock) === owner) await deps.store.del(lock);
  }
}
