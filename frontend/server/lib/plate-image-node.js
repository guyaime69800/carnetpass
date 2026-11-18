import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { fail } from './devis-security.js';
export async function canonicalPlateImage(dataUrl) {
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl || "",
    );
  if (!match || match[2].length > 2800000)
    throw fail(
      413,
      "Image JPEG, PNG ou WebP de moins de 2 Mo requise après compression.",
    );
  const bytes = Buffer.from(match[2], "base64");
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP";
  if (bytes.length > 2097152 || !{ png, jpeg, webp }[match[1]])
    throw fail(415, "Le contenu réel ne correspond pas au format annoncé.");
  let image;
  try {
    image = await loadImage(bytes);
  } catch {
    throw fail(415, "Image endommagée ou illisible.");
  }
  if (!image.width || !image.height || image.width * image.height > 20000000)
    throw fail(413, "Dimensions d’image excessives.");
  const scale = Math.min(1, 1600 / image.width, 1600 / image.height);
  const canvas = createCanvas(
    Math.round(image.width * scale),
    Math.round(image.height * scale),
  );
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const canonical = canvas.toBuffer("image/jpeg", 85);
  return {
    dataUrl: `data:image/jpeg;base64,${canonical.toString("base64")}`,
    hash: createHash("sha256").update(canonical).digest("hex"),
  };
}
