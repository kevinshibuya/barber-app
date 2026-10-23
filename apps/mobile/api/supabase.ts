import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Database, MOBILE_ENV } from '@barber/shared';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

let client: SupabaseClient<Database> | undefined;

// The one Supabase client of the app, created on first use so that importing
// the `api` module has no side effects. Only files in this directory call it.
export function supabase(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(`${MOBILE_ENV.supabaseUrl} and ${MOBILE_ENV.supabaseAnonKey} must be set`);
  }

  const created = createSupabaseClient<Database>(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // A password reset link comes back as `barber://reset-password?code=…`,
      // which the reset screen exchanges for a session.
      flowType: 'pkce',
    },
  });

  // Refresh the session only while the app is in the foreground.
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void created.auth.startAutoRefresh();
      else void created.auth.stopAutoRefresh();
    });
  }

  client = created;
  return created;
}
