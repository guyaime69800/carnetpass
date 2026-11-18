import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { workerConfiguration } from '../cloudflare/environment.js';
const offline = process.argv.includes('--offline');
const environment = process.argv.includes('--production') ? 'production' : 'preview';
const vars = { ...process.env, CARNETPASS_RUNTIME: 'cloudflare', CARNETPASS_ENV: environment };
if (offline) {
  if (environment !== 'preview') throw Error('Offline build cannot target production');
  vars.VITE_SUPABASE_URL = 'https://bqqzzbwqmiyxcotvqtoc.supabase.co';
  vars.VITE_SUPABASE_PUBLISHABLE_KEY = 'offline-build-only-not-a-working-key';
}
if (!vars.VITE_SUPABASE_URL || !vars.VITE_SUPABASE_PUBLISHABLE_KEY) throw Error('Set the public VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY locally');
// Incident du 18/11 : un export Vercel remplace certaines valeurs par « [SENSITIVE] »,
// compilées telles quelles dans le site (page blanche). Refus explicite.
const masked = Object.keys(vars).filter((name) => name.startsWith('VITE_') && /^\[SENSITIVE\]$|\\n$/.test(String(vars[name]).trim()));
if (masked.length) throw Error(`MASKED_PUBLIC_VALUE: ${masked.join(', ')}`);
if (workerConfiguration({ ...vars, CARNETPASS_RELEASE_BRANCH: environment === 'production' ? 'main' : 'migration/cloudflare-20261115' })) throw Error('BUILD_DATABASE_TARGET_REFUSED');
for (const file of ['scripts/validate-equipment-catalog.mjs', 'scripts/render-public-pages.mjs', 'node_modules/vite/bin/vite.js', 'scripts/audit-client-secret-exposure.mjs', 'scripts/prepare-cloudflare-rag.mjs']) {
  const run = spawnSync(process.execPath, [file, ...(file.includes('/vite/') ? ['build'] : [])], { env: vars, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status || 1);
}
fs.mkdirSync('.cloudflare', { recursive: true });
fs.writeFileSync('.cloudflare/build.json', JSON.stringify({ at: new Date().toISOString(), environment, offline, publishable: !offline, supabaseUrl: vars.VITE_SUPABASE_URL,
  indexSha256: createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex') }, null, 2));
console.log(offline ? 'Compilation hors ligne uniquement : aucun parcours connecté ni publication validés.' : 'Compilation Cloudflare créée ; validation du déploiement restant nécessaire.');
