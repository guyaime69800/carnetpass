// Explicit hosting identity. Cloudflare never impersonates Vercel system variables.
export function deploymentEnvironment(env = process.env) {
  if (env.CARNETPASS_RUNTIME === 'cloudflare') return ['preview', 'production'].includes(env.CARNETPASS_ENV) ? env.CARNETPASS_ENV : 'unconfigured';
  if (env.CARNETPASS_RUNTIME && env.CARNETPASS_RUNTIME !== 'vercel') return 'unconfigured';
  return env.VERCEL_ENV;
}
export function deploymentBranch(env = process.env) {
  return env.CARNETPASS_RUNTIME === 'cloudflare' ? env.CARNETPASS_RELEASE_BRANCH : env.VERCEL_GIT_COMMIT_REF;
}

export function previewOrigin(env = process.env) {
  if (env.CARNETPASS_RUNTIME !== 'cloudflare') return env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'https://test.carnetpass.fr';
  const url = new URL(env.CARNETPASS_PUBLIC_ORIGIN || 'https://test.carnetpass.fr');
  if (deploymentEnvironment(env) !== 'preview' || url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !(url.hostname === 'test.carnetpass.fr' || /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname))) throw Error('PREVIEW_ORIGIN_REFUSED');
  return url.origin;
}
