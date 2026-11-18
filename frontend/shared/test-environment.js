import { deploymentEnvironment } from './runtime-environment.js';
export const TEST_ORIGIN = 'https://test.carnetpass.fr';
export const TEST_SUPABASE_URL = 'https://bqqzzbwqmiyxcotvqtoc.supabase.co';
export const PRODUCTION_SUPABASE_URL = 'https://tsyukqcyfxcrjrhopvpv.supabase.co';

export function isolatedTestEnvironment(env) {
  return deploymentEnvironment(env) === 'preview' && env.VITE_SUPABASE_URL === TEST_SUPABASE_URL;
}

export function assertDatabaseIsolation(env) {
  if (deploymentEnvironment(env) === 'preview' && env.VITE_SUPABASE_URL !== TEST_SUPABASE_URL) throw Error('Preview requires its dedicated test database');
  if (deploymentEnvironment(env) === 'production' && env.VITE_SUPABASE_URL !== PRODUCTION_SUPABASE_URL) throw Error('Production requires its dedicated production database');
}
