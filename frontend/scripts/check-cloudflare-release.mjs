import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { workerConfiguration } from '../cloudflare/environment.js';
const environment = process.argv.includes('--production') ? 'production' : 'preview';
const build = JSON.parse(fs.readFileSync('.cloudflare/build.json', 'utf8'));
if (build.offline || !build.publishable) throw Error('OFFLINE_BUILD_NOT_PUBLISHABLE');
if (build.environment !== environment) throw Error('BUILD_ENVIRONMENT_MISMATCH');
if (workerConfiguration({ CARNETPASS_RUNTIME: 'cloudflare', CARNETPASS_ENV: environment,
  CARNETPASS_RELEASE_BRANCH: environment === 'production' ? 'main' : 'migration/cloudflare-20261115', VITE_SUPABASE_URL: build.supabaseUrl })) throw Error('BUILD_DATABASE_TARGET_REFUSED');
const actual = createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex');
if (actual !== build.indexSha256) throw Error('BUILD_OUTPUT_CHANGED');
console.log('Contrôle de construction réussi. Les accès, coûts et parcours distants restent à valider avant toute publication.');
