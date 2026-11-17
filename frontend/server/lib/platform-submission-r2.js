import { deploymentEnvironment } from "../../shared/runtime-environment.js";
import { r2Client, r2Configuration, r2DocumentKey } from "./r2-document-storage.js";
import { r2NativePathname, readVerifiedR2Pdf } from "./r2-native-documents.js";

// Proposition d'une pièce jointe au catalogue, écrite dans R2 (production)
// au lieu de Vercel Blob. Même convention que l'import d'administration
// direct : objet adressé par son SHA-256, correspondance vérifiée dans
// platform_document_r2_copies, fiche enregistrée « r2://…#<id> ».
// Désactivé par défaut : CARNETPASS_SUBMISSIONS_R2_ENABLED=true requis.
// L'objet R2 n'est jamais supprimé ici : il peut être partagé par d'autres
// fiches de même contenu.

export const submissionR2Enabled = (env = process.env) =>
  deploymentEnvironment(env) === "production" && env.CARNETPASS_SUBMISSIONS_R2_ENABLED === "true";

const failure = (code) => Object.assign(new Error(code), { code });
const preconditionFailed = (error) => error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;

export async function storeSubmissionInR2(db, { documentId, bytes, sha256 }, deps = {}) {
  const env = deps.env || process.env;
  if (!submissionR2Enabled(env)) throw failure("SUBMISSION_R2_DISABLED");
  const pathname = r2NativePathname(sha256, documentId);
  const key = r2DocumentKey(sha256);
  const entry = { size_bytes: bytes.length, sha256 };
  const configuration = deps.configuration || r2Configuration(env, "upload");
  const client = deps.client || r2Client(configuration);
  const s3 = await import("@aws-sdk/client-s3");
  try {
    const existing = await db.from("platform_document_r2_copies")
      .select("sha256,size_bytes,object_key,verified_at").eq("sha256", sha256).maybeSingle();
    if (existing.error) throw failure("R2_TRACKING_UNAVAILABLE");
    if (existing.data) {
      if (existing.data.object_key !== key || existing.data.size_bytes !== bytes.length || !existing.data.verified_at) {
        throw failure("R2_TRACKING_INCONSISTENT");
      }
      await readVerifiedR2Pdf(client, configuration.bucket, key, entry);
      return { pathname, reused: true };
    }
    try {
      await client.send(new s3.PutObjectCommand({ Bucket: configuration.bucket, Key: key, Body: bytes,
        ContentType: "application/pdf", ContentLength: bytes.length, CacheControl: "private, no-store",
        Metadata: { sha256 }, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(60_000) });
    } catch (error) {
      // Objet déjà présent sans correspondance : jamais écrasé, seulement vérifié.
      if (!preconditionFailed(error)) throw error;
    }
    await readVerifiedR2Pdf(client, configuration.bucket, key, entry);
    const head = await client.send(new s3.HeadObjectCommand({ Bucket: configuration.bucket, Key: key }));
    // La lecture catalogue (tryR2Delivery) exige ces métadonnées.
    if (head.ContentLength !== bytes.length || head.ContentType !== "application/pdf" || head.Metadata?.sha256 !== sha256) {
      throw failure("R2_OBJECT_INCONSISTENT");
    }
    const saved = await db.from("platform_document_r2_copies").upsert({ sha256, size_bytes: bytes.length,
      object_key: key, verified_at: new Date().toISOString() }, { onConflict: "sha256", ignoreDuplicates: true });
    if (saved.error) throw failure("R2_TRACKING_UNAVAILABLE");
    return { pathname, reused: false };
  } finally { if (!deps.client) client.destroy?.(); }
}
