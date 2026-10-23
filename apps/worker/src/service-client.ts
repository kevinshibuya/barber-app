// The worker's Supabase client: the service role, which reads and writes every
// shop's rows and objects.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type Database, WORKER_ENV } from '@barber/shared';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createServiceClient(env: NodeJS.ProcessEnv): SupabaseClient<Database> {
  return createClient<Database>(
    required(env, WORKER_ENV.supabaseUrl),
    required(env, WORKER_ENV.supabaseServiceRoleKey),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
