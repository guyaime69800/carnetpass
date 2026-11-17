// Doublures locales de R2 (API S3) et de Vercel Blob. Aucun appel réseau.

export function fakeR2() {
  const objects = new Map();
  const calls = [];
  const client = {
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push({ name, input });
      if (name === "PutObjectCommand") {
        if (input.IfNoneMatch === "*" && objects.has(input.Key)) {
          throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
        }
        objects.set(input.Key, { bytes: Buffer.from(input.Body), contentType: input.ContentType });
        return {};
      }
      if (name === "GetObjectCommand") {
        const stored = objects.get(input.Key);
        if (!stored) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        return {
          ContentType: stored.contentType,
          ContentLength: stored.bytes.length,
          Body: { transformToWebStream: () => new Blob([stored.bytes]).stream() },
        };
      }
      if (name === "DeleteObjectCommand") { objects.delete(input.Key); return {}; }
      throw new Error(`Commande inattendue ${name}`);
    },
  };
  return { client, objects, calls };
}

export function fakeBlob() {
  const objects = new Map();
  const calls = [];
  let counter = 0;
  return {
    objects,
    calls,
    async get(pathname, options) {
      calls.push({ op: "get", pathname, options });
      const stored = objects.get(pathname);
      if (!stored) return null;
      return {
        statusCode: 200,
        stream: new Blob([stored.bytes]).stream(),
        blob: { pathname, url: `https://blob.test/${pathname}`, contentType: stored.contentType, size: stored.bytes.length },
      };
    },
    async put(pathname, bytes, options) {
      calls.push({ op: "put", pathname, options });
      const finalPath = options?.addRandomSuffix ? pathname.replace(/(\.[a-z0-9]+)$/i, `-rnd${++counter}$1`) : pathname;
      objects.set(finalPath, { bytes: Buffer.from(bytes), contentType: options?.contentType });
      return { pathname: finalPath, url: `https://blob.test/${finalPath}` };
    },
    async del(pathname) { calls.push({ op: "del", pathname }); objects.delete(pathname); },
  };
}

export const r2Env = (environment = "production", extra = {}) => ({
  CARNETPASS_RUNTIME: "cloudflare",
  CARNETPASS_ENV: environment,
  R2_ENDPOINT: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
  R2_PRIVATE_BUCKET_NAME: `carnetpass-private-files-${environment}`,
  R2_PRIVATE_ACCESS_KEY_ID: "fake-id",
  R2_PRIVATE_SECRET_ACCESS_KEY: "fake-secret",
  ...extra,
});

export const fakeConfiguration = (environment = "production") => ({
  endpoint: "https://fake", bucket: `carnetpass-private-files-${environment}`, credentials: {},
});

export async function readAll(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}
