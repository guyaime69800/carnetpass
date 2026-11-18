import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'node:fs';
const roots = ['api', 'server', 'shared', 'src', 'cloudflare'];
const variables = new Map();
const dependencies = new Map();
for (const root of roots) for (const file of globSync(`${root}/**/*.{js,jsx,mjs}`)) {
  if (file.includes('generated/') || file.endsWith('.test.js')) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:process\.env|import\.meta\.env|\benv|\benvironment|\bconfig)\.([A-Z][A-Z0-9_]+)/g)) {
    const set = variables.get(match[1]) || new Set(); set.add(file); variables.set(match[1], set);
  }
  for (const match of text.matchAll(/from\s+["'](@vercel\/[^"']+|node:[^"']+)["']/g)) {
    const set = dependencies.get(match[1]) || new Set(); set.add(file); dependencies.set(match[1], set);
  }
}
const assets = [...globSync('dist/**/*')].filter(file => fs.statSync(file).isFile());
const result = { at: new Date().toISOString(), valuesIncluded: false,
  variables: [...variables].sort().map(([name, files]) => ({ name, publicBuild: name.startsWith('VITE_'), files: [...files] })),
  platformDependencies: [...dependencies].sort().map(([name, files]) => ({ name, files: [...files] })),
  assets: { count: assets.length, bytes: assets.reduce((n, file) => n + fs.statSync(file).size, 0), largestBytes: Math.max(0, ...assets.map(file => fs.statSync(file).size)) },
  vercelCronExpressions: JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons,
};
fs.mkdirSync('.cloudflare', { recursive: true });
fs.writeFileSync(path.join('.cloudflare', 'inventory.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ variables: result.variables.length, platformDependencies: result.platformDependencies.length, assets: result.assets, output: '.cloudflare/inventory.json', valuesIncluded: false }));
