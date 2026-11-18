// Doublures locales de R2 (API S3) et de Vercel Blob. Aucun appel réseau.

export function fakeR2() {
  const objects = new Map();
  const calls = [];
  let version = 0;
  const client = {
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push({ name, input });
      if (name === "PutObjectCommand") {
        if (input.IfNoneMatch === "*" && objects.has(input.Key)) {
          throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
        }
        objects.set(input.Key, { bytes: Buffer.from(input.Body), contentType: input.ContentType, etag: `"e${++version}"`, metadata: input.Metadata });
        return {};
      }
      const missing = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      if (name === "GetObjectCommand") {
        const stored = objects.get(input.Key);
        if (!stored) throw missing();
        return {
          ContentType: stored.contentType,
          ContentLength: stored.bytes.length,
          ETag: stored.etag,
          // Comme le SDK : flux itérable, convertible en flux Web.
          Body: (() => { const body = new Blob([stored.bytes]).stream(); body.transformToWebStream = () => body; return body; })(),
        };
      }
      if (name === "HeadObjectCommand") {
        const stored = objects.get(input.Key);
        if (!stored) throw missing();
        return { ContentType: stored.contentType, ContentLength: stored.bytes.length, ETag: stored.etag, Metadata: stored.metadata };
      }
      if (name === "CopyObjectCommand") {
        const sourceKey = input.CopySource.slice(input.CopySource.indexOf("/") + 1);
        const source = objects.get(sourceKey);
        if (!source) throw missing();
        if (input.CopySourceIfMatch && input.CopySourceIfMatch !== source.etag) {
          throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
        }
        objects.set(input.Key, { bytes: source.bytes, contentType: input.ContentType, etag: source.etag, metadata: input.Metadata });
        return {};
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

// Doublure de Redis (sous-ensemble utilisé : get, set nx/ex, del).
export function fakeStore() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : null; },
    async set(key, value, options = {}) {
      if (options.nx && values.has(key)) return null;
      values.set(key, structuredClone(value));
      return "OK";
    },
    async del(key) { values.delete(key); },
  };
}

// Doublure de la table equipment_private_attachments (upsert seul).
export function fakeAttachmentsTable({ fail = false } = {}) {
  const rows = [];
  return {
    rows,
    from(table) {
      if (table !== "equipment_private_attachments") throw new Error(`Table inattendue ${table}`);
      return {
        async upsert(row, options) {
          if (fail) return { error: { message: "indisponible" } };
          if (!rows.some((existing) => existing[options.onConflict] === row[options.onConflict])) rows.push(row);
          return { error: null };
        },
      };
    },
  };
}

export const r2Env =(environment = "production", extra = {}) => ({
  CARNETPASS_RUNTIME: "cloudflare",
  CARNETPASS_ENV: environment,
  R2_ENDPOINT: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
  R2_PRIVATE_BUCKET_NAME: `carnetpass-private-files-${environment === "preview" ? "test" : environment}`,
  R2_PRIVATE_ACCESS_KEY_ID: "fake-id",
  R2_PRIVATE_SECRET_ACCESS_KEY: "fake-secret",
  ...extra,
});

export const fakeConfiguration = (environment = "production") => ({
  endpoint: "https://fake", bucket: `carnetpass-private-files-${environment === "preview" ? "test" : environment}`, credentials: {},
});

export async function readAll(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}
