import { randomUUID } from "node:crypto";
import { deploymentEnvironment } from "../../shared/runtime-environment.js";

// Stockage des fichiers privés d'entreprise (pièces jointes, rapports
// réglementaires) avec deux fournisseurs pendant la transition :
//
// - Vercel Blob : comportement historique, conservé par défaut.
// - Cloudflare R2 : compartiment privé DÉDIÉ, distinct du catalogue.
//
// Les chemins R2 portent le préfixe explicite `r2-private://`. Un chemin sans
// préfixe est un ancien chemin Blob. Les colonnes existantes (blob_pathname,
// pdf_pathname) sont réutilisées : aucune migration SQL.
//
// Retour arrière : CARNETPASS_PRIVATE_R2_WRITE_ENABLED absent ou différent de
// "true" => toutes les nouvelles écritures repartent vers Blob ; les fichiers
// déjà écrits dans R2 restent lisibles tant que la configuration R2 existe.
//
// Ce module ne contrôle PAS les droits : l'appelant doit avoir vérifié
// l'entreprise, l'équipement et le document avant tout appel.

export const PRIVATE_R2_SCHEME = "r2-private://";
const ALLOWED_PREFIXES = ["equipment-attachments/", "regulatory/"];
const KEY_PATTERN = /^[A-Za-z0-9._\-/]{1,400}$/;
const ENDPOINT_PATTERN = /^https:\/\/[a-f0-9]{32}\.eu\.r2\.cloudflarestorage\.com$/;
const CATALOG_BUCKET = "carnetpass-documents-production";
// Un compartiment par environnement ; la Preview utilise l'espace de TEST.
const PRIVATE_BUCKETS = Object.freeze({
  preview: "carnetpass-private-files-test",
  production: "carnetpass-private-files-production",
});

const failure = (code) => Object.assign(new Error(code), { code });

export const isPrivateR2Pathname = (pathname) =>
  typeof pathname === "string" && pathname.startsWith(PRIVATE_R2_SCHEME);

// Valide une clé d'objet privée (sans préfixe de fournisseur).
export function validatePrivateKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key) || key.includes("..")
    || key.includes("//") || key.startsWith("/")
    || !ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    throw failure("PRIVATE_KEY_INVALID");
  }
  return key;
}

// Chemin enregistré en base -> { provider, key }.
export function parsePrivatePathname(pathname) {
  if (isPrivateR2Pathname(pathname)) {
    return { provider: "r2", key: validatePrivateKey(pathname.slice(PRIVATE_R2_SCHEME.length)) };
  }
  return { provider: "blob", key: validatePrivateKey(pathname) };
}

// Le compartiment doit correspondre à l'environnement : une Preview ne peut
// jamais écrire ni lire dans le compartiment privé de production.
export function privateR2Configuration(env = process.env) {
  const environment = deploymentEnvironment(env);
  if (environment !== "production" && environment !== "preview") throw failure("PRIVATE_R2_ENVIRONMENT_INVALID");
  if (!ENDPOINT_PATTERN.test(env.R2_ENDPOINT || "")) throw failure("PRIVATE_R2_ENDPOINT_INVALID");
  const bucket = env.R2_PRIVATE_BUCKET_NAME;
  if (bucket !== PRIVATE_BUCKETS[environment] || bucket === CATALOG_BUCKET) {
    throw failure("PRIVATE_R2_BUCKET_INVALID");
  }
  const accessKeyId = env.R2_PRIVATE_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_PRIVATE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw failure("PRIVATE_R2_CREDENTIALS_MISSING");
  return { endpoint: env.R2_ENDPOINT, bucket, credentials: { accessKeyId, secretAccessKey } };
}

function privateR2Available(env) {
  try { privateR2Configuration(env); return true; } catch { return false; }
}

export function privateWriteProvider(env = process.env) {
  if (env.CARNETPASS_PRIVATE_R2_WRITE_ENABLED !== "true") return "blob";
  // Activation demandée mais configuration invalide : refus explicite plutôt
  // qu'une écriture silencieuse dans un autre stockage.
  privateR2Configuration(env);
  return "r2";
}

const legacyR2ReadEnabled = (env) => env.CARNETPASS_PRIVATE_R2_READ_LEGACY === "true" && privateR2Available(env);

async function defaultBlob() {
  const blob = await import("@vercel/blob");
  return { get: blob.get, put: blob.put, del: blob.del };
}

async function s3() {
  return import("@aws-sdk/client-s3");
}

async function withClient(env, deps, action) {
  const configuration = deps.configuration || privateR2Configuration(env);
  let client = deps.client;
  if (!client) {
    const { r2Client } = await import("./r2-document-storage.js");
    client = r2Client(configuration);
  }
  try { return await action(client, configuration.bucket); }
  finally { if (!deps.client) client.destroy?.(); }
}

const notFound = (error) => error?.name === "NoSuchKey" || error?.name === "NotFound"
  || error?.$metadata?.httpStatusCode === 404;

function webStream(body) {
  if (!body) return null;
  if (typeof body.transformToWebStream === "function") return body.transformToWebStream();
  if (typeof body.getReader === "function") return body;
  return null;
}

async function getFromR2(pathname, key, env, deps) {
  const { GetObjectCommand } = await s3();
  try {
    return await withClient(env, deps, async (client, bucket) => {
      const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) });
      const stream = webStream(stored.Body);
      if (!stream) return null;
      return {
        statusCode: 200,
        stream,
        provider: "r2",
        blob: { pathname, url: pathname, contentType: stored.ContentType, size: Number(stored.ContentLength) },
      };
    });
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
}

// Même forme de résultat que `get` de @vercel/blob, pour que les contrôles
// existants (chemin, type, taille, empreinte) restent inchangés chez l'appelant.
export async function getPrivateObject(pathname, { env = process.env, deps = {} } = {}) {
  const { provider, key } = parsePrivatePathname(pathname);
  if (provider === "r2") return getFromR2(pathname, key, env, deps);
  if (legacyR2ReadEnabled(env)) {
    // Transition : une copie R2 future garde la même clé que l'objet Blob.
    // En cas d'absence ou d'erreur R2, repli sur Blob. L'appelant revérifie
    // toujours taille, type et empreinte : une copie divergente est refusée.
    try {
      const copied = await getFromR2(pathname, key, env, deps);
      if (copied) return { ...copied, provider: "r2-legacy-copy" };
    } catch { /* repli Blob */ }
  }
  const blob = deps.blob || await defaultBlob();
  const stored = await blob.get(pathname, { access: "private", useCache: false });
  return stored ? { ...stored, provider: "blob" } : stored;
}

// Écrit un nouvel objet privé avec un suffixe aléatoire non devinable.
// Jamais d'écrasement : `If-None-Match: *` côté R2, `addRandomSuffix` côté Blob.
export async function putPrivateObject(basePathname, bytes, { contentType, env = process.env, deps = {} } = {}) {
  validatePrivateKey(basePathname);
  if (typeof contentType !== "string" || !contentType) throw failure("PRIVATE_CONTENT_TYPE_INVALID");
  const provider = deps.provider || privateWriteProvider(env);
  if (provider === "blob") {
    const blob = deps.blob || await defaultBlob();
    const stored = await blob.put(basePathname, bytes, { access: "private", contentType, addRandomSuffix: true });
    return { pathname: stored.pathname, url: stored.url, provider: "blob" };
  }
  const extension = /\.[a-z0-9]{2,5}$/i.exec(basePathname)?.[0] || "";
  const key = validatePrivateKey(`${basePathname.slice(0, basePathname.length - extension.length)}-${randomUUID()}${extension}`);
  const body = Buffer.from(bytes);
  const { PutObjectCommand } = await s3();
  await withClient(env, deps, (client, bucket) => client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length,
    CacheControl: "private, no-store", IfNoneMatch: "*",
  }), { abortSignal: AbortSignal.timeout(60_000) }));
  const pathname = PRIVATE_R2_SCHEME + key;
  return { pathname, url: pathname, provider: "r2" };
}

// Suppression routée selon le préfixe. Pour un ancien chemin Blob, une copie
// R2 de même clé est aussi supprimée si la configuration R2 existe, afin que
// l'effacement d'un dossier n'oublie pas une copie de transition.
export async function deletePrivateObject(pathname, { env = process.env, deps = {} } = {}) {
  const { provider, key } = parsePrivatePathname(pathname);
  const deleteR2 = async () => {
    const { DeleteObjectCommand } = await s3();
    await withClient(env, deps, (client, bucket) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30_000) }));
  };
  if (provider === "r2") return deleteR2();
  const blob = deps.blob || await defaultBlob();
  await blob.del(pathname);
  if ((deps.client && deps.configuration) || privateR2Available(env)) await deleteR2();
}
