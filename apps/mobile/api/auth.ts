import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Barber, isBarberRole } from '@barber/shared';
import { isAuthApiError, isAuthPKCECodeVerifierMissingError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import type { Unsubscribe } from './previews';
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

// The barber last signed in on this device, kept so the app opens on its
// cache with no connection. The device's copy of the shop is that barber's:
// anyone else signing in starts it empty.
export const BARBER_STORAGE_KEY = 'barber.signed-in';

async function knownBarber(): Promise<Barber | null> {
  try {
    const raw = await AsyncStorage.getItem(BARBER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Barber) : null;
  } catch {
    return null;
  }
}

async function remember(barber: Barber): Promise<void> {
  const previous = await knownBarber();
  if (previous?.id !== barber.id) await clearReadCache();
  await AsyncStorage.setItem(BARBER_STORAGE_KEY, JSON.stringify(barber)).catch(() => undefined);
}

async function forget(): Promise<void> {
  await Promise.all([clearReadCache(), AsyncStorage.removeItem(BARBER_STORAGE_KEY).catch(() => undefined)]);
}

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
  await remember(barber);
  return { ok: true, barber };
}

// The device's copy of the shop goes first, so it is gone even when the
// network refuses the sign-out.
export async function signOut(): Promise<void> {
  await forget();
  const { error } = await supabase().auth.signOut();
  if (error) throw error;
}

// The barber of the persisted session, or null when nobody is signed in.
// With no connection, a session this device still holds opens as the barber
// it last signed in, so the screens read their cache.
export async function getCurrentBarber(): Promise<Barber | null> {
  const { data, error } = await supabase().auth.getSession();
  if (error && !isAuthRetryableFetchError(error)) throw error;
  const userId = data.session?.user.id;
  if (!userId && !error) return null;
  try {
    if (!userId) throw error;
    const barber = await fetchBarber(userId);
    if (barber) await remember(barber);
    return barber;
  } catch (failure) {
    const known = await knownBarber();
    if (known && (!userId || known.id === userId)) return known;
    throw failure;
  }
}

// A session that ends without the sign-out button, revoked or replaced, takes
// the device's copy of the shop with it. The root layout calls it once.
export function watchSession(): Unsubscribe {
  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') void forget();
  });
  return () => data.subscription.unsubscribe();
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
  await remember(barber);
  return { ok: true, barber };
}
