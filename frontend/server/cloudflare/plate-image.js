import { env } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import { fail } from '../lib/devis-security.js';

// Uses the real Images API when its binding has been approved/configured.
export async function canonicalPlateImage(dataUrl) {
  if (!env.IMAGES) throw fail(503, 'Prétraitement des photos non configuré sur Cloudflare.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!match || match[2].length > 2800000) throw fail(413, 'Image de moins de 2 Mo requise.');
  const bytes = Buffer.from(match[2], 'base64');
  const formats = { jpeg: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    png: bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    webp: bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' };
  if (bytes.length > 2097152 || !formats[match[1]]) throw fail(415, 'Le contenu ne correspond pas au format annoncé.');
  const source = () => new Response(bytes).body;
  let info;
  try { info = await env.IMAGES.info(source()); } catch { throw fail(415, 'Image illisible.'); }
  if (!info.width || !info.height || info.width * info.height > 20000000) throw fail(413, 'Dimensions excessives.');
  const output = await env.IMAGES.input(source()).transform({ width: 1600, height: 1600, fit: 'scale-down', background: '#ffffff' }).output({ format: 'image/jpeg', quality: 85 });
  const canonical = Buffer.from(await output.response().arrayBuffer());
  return { dataUrl: `data:image/jpeg;base64,${canonical.toString('base64')}`, hash: createHash('sha256').update(canonical).digest('hex') };
}
