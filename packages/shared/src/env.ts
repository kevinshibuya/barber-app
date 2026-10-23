// Environment variable names, fixed for the whole repo. Each app lists its
// names in its `.env.example`; a test keeps the two in step.

// Expo inlines a public variable only when the code reads it as
// `process.env.EXPO_PUBLIC_…` literally, so the mobile app reads these by
// name and this object documents them.
export const MOBILE_ENV = {
  supabaseUrl: 'EXPO_PUBLIC_SUPABASE_URL',
  supabaseAnonKey: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  clientPageBaseUrl: 'EXPO_PUBLIC_CLIENT_PAGE_BASE_URL',
} as const;

export const WORKER_ENV = {
  port: 'PORT',
  supabaseUrl: 'SUPABASE_URL',
  supabaseServiceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
  databaseUrl: 'DATABASE_URL',
  imageProvider: 'IMAGE_PROVIDER',
  geminiApiKey: 'GEMINI_API_KEY',
  falKey: 'FAL_KEY',
  clientPageBaseUrl: 'CLIENT_PAGE_BASE_URL',
  previewConcurrency: 'PREVIEW_CONCURRENCY',
  previewStaleTimeoutSeconds: 'PREVIEW_STALE_TIMEOUT_SECONDS',
} as const;

// What `scripts/db-test.sh` exports from `supabase status` before it runs a
// package script against the local database.
export const GATE_ENV = {
  supabaseUrl: WORKER_ENV.supabaseUrl,
  supabaseAnonKey: 'SUPABASE_ANON_KEY',
  supabaseServiceRoleKey: WORKER_ENV.supabaseServiceRoleKey,
  databaseUrl: WORKER_ENV.databaseUrl,
  mobileSupabaseUrl: MOBILE_ENV.supabaseUrl,
  mobileSupabaseAnonKey: MOBILE_ENV.supabaseAnonKey,
} as const;

// `fake` answers with a fixed image, for tests and local runs.
export const IMAGE_PROVIDERS = ['gemini', 'nano-banana-2.1', 'flux', 'flux-klein', 'seedream', 'fake'] as const;
export type ImageProviderName = (typeof IMAGE_PROVIDERS)[number];
