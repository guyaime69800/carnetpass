export function workerConfiguration(env) {
  if (env.CARNETPASS_RUNTIME !== 'cloudflare' || !['preview', 'production'].includes(env.CARNETPASS_ENV)) return 'WORKER_ENVIRONMENT_REQUIRED';
  if (env.CARNETPASS_ENV === 'preview' && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL !== 'https://bqqzzbwqmiyxcotvqtoc.supabase.co') return 'PREVIEW_PRODUCTION_DATABASE_REFUSED';
  if (env.CARNETPASS_ENV === 'production' && (env.CARNETPASS_RELEASE_BRANCH !== 'main' || env.VITE_SUPABASE_URL !== 'https://tsyukqcyfxcrjrhopvpv.supabase.co')) return 'PRODUCTION_TARGET_REQUIRED';
  return null;
}
export function apiConfiguration(env) {
  if (workerConfiguration(env)) return 'WORKER_CONFIGURATION_REQUIRED';
  return ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'UPSTASH_REDIS_REST_KV_REST_API_URL', 'UPSTASH_REDIS_REST_KV_REST_API_TOKEN'].some(name => !env[name]) ? 'BACKEND_CONFIGURATION_REQUIRED' : null;
}
