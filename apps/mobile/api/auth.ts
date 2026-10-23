import { type Barber, isBarberRole } from '@barber/shared';
import { isAuthApiError, isAuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { clearReadCache } from './reads';
import { supabase } from './supabase';

// The screen the password reset email's link opens, through the `barber`
// scheme. Supabase appends `?code=…` (PKCE) on its way back.
const RESET_PASSWORD_PATH = 'reset-password';

export type SignInResult =
  | { ok: true; barber: Barber }
  | { ok: false; reason: 'wrong-credentials' | 'not-a-barber' };

export type SetNewPasswordResult =
  | { ok: true; barber: Barber }
  | { ok: false; reason: 'weak-password' | 'same-password' };

async function fetchBarber(userId: string): Promise<Barber | null> {
  const { data, error } = await supabase()
    .from('barbers')
    .select('id, shop_id, display_name, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!isBarberRole(data.role)) throw new Error(`barber ${data.id} has unknown role ${data.role}`);
  return { id: data.id, shopId: data.shop_id, displayName: data.display_name, role: data.role };
}

// Signs in with the email and password the shop was given. A user with no
// barber row belongs to no shop, so the session is dropped again. Network and
// server errors throw; a refusal the barber can fix is a result.
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (isAuthApiError(error) && error.code === 'invalid_credentials') {
    return { ok: false, reason: 'wrong-credentials' };
  }
  if (error) throw error;
  const barber = await fetchBarber(data.user.id);
  if (!barber) {
    await supabase().auth.signOut();
    return { ok: false, reason: 'not-a-barber' };
  }
  return { ok: true, barber };
}

// The device's copy of the shop goes first, so it is gone even when the
// network refuses the sign-out.
export async function signOut(): Promise<void> {
  await clearReadCache();
  const { error } = await supabase().auth.signOut();
  if (error) throw error;
}

// The barber of the persisted session, or null when nobody is signed in.
export async function getCurrentBarber(): Promise<Barber | null> {
  const { data, error } = await supabase().auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  return fetchBarber(data.session.user.id);
}

// Emails a reset link that opens the app's set-new-password screen. Supabase
// answers the same whether or not the email has an account.
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: Linking.createURL(RESET_PASSWORD_PATH),
  });
  if (error) throw error;
}

// Exchanges the code the reset link carries for a session, so the new password
// can be set. False when the link is expired, used, or was requested on
// another device.
export async function openPasswordResetLink(code: string): Promise<boolean> {
  const { error } = await supabase().auth.exchangeCodeForSession(code);
  if (!error) return true;
  if (isAuthApiError(error) || isAuthPKCECodeVerifierMissingError(error)) return false;
  throw error;
}

// Sets the password of the session the reset link opened; the barber stays
// signed in.
export async function setNewPassword(password: string): Promise<SetNewPasswordResult> {
  const { data, error } = await supabase().auth.updateUser({ password });
  if (isAuthApiError(error) && error.code === 'weak_password') return { ok: false, reason: 'weak-password' };
  if (isAuthApiError(error) && error.code === 'same_password') return { ok: false, reason: 'same-password' };
  if (error) throw error;
  const barber = await fetchBarber(data.user.id);
  if (!barber) throw new Error(`user ${data.user.id} is not a barber of any shop`);
  return { ok: true, barber };
}
