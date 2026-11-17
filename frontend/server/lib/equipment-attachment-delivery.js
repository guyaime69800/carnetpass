import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getPrivateObject } from "./private-object-store.js";

function requestError(status, code, publicMessage) {
    return Object.assign(new Error(code), { status, code, publicMessage });
}

function asciiFilename(value) {
    const normalized = value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .replace(/[\r\n"]/g, "_")
        .trim();

    return normalized.slice(0, 140) || "document-carnetpass";
}

export function contentDisposition(filename, download) {
    const disposition = download ? "attachment" : "inline";
    const fallback = asciiFilename(filename);
    const encoded = encodeURIComponent(filename)
        .replace(/[!'()*]/g, (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        );

    return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const integrityError = () => requestError(
    409,
    "ATTACHMENT_INTEGRITY_ERROR",
    "L'intégrité de cette pièce jointe doit être vérifiée."
);

// Diffuse le fichier d'une pièce jointe DÉJÀ autorisée (entreprise et
// identifiant vérifiés par l'appelant). Fichier Blob historique ou R2 privé
// (préfixe r2-private://) ; chemin, type et taille doivent correspondre.
export async function deliverAttachmentFile(
    res,
    attachment,
    action,
    getObject = getPrivateObject
) {
    let blob;

    try {
        blob = await getObject(attachment.blob_pathname);
    } catch (error) {
        if (error?.code === "PRIVATE_KEY_INVALID") throw integrityError();
        throw error;
    }

    if (!blob || blob.statusCode !== 200 || !blob.stream) {
        throw requestError(
            410,
            "ATTACHMENT_FILE_MISSING",
            "Le fichier associé à cette pièce jointe n'est plus disponible."
        );
    }

    if (
        blob.blob.pathname !== attachment.blob_pathname ||
        blob.blob.contentType !== attachment.mime_type ||
        Number(blob.blob.size) !== Number(attachment.size_bytes)
    ) {
        throw integrityError();
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", attachment.mime_type);
    res.setHeader("Content-Length", String(blob.blob.size));
    res.setHeader(
        "Content-Disposition",
        contentDisposition(attachment.original_filename, action === "download")
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");

    await pipeline(Readable.fromWeb(blob.stream), res);
}
