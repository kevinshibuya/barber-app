import { type Barber, isBarberRole } from '@barber/shared';
import { supabase } from './supabase';

interface BarberRow {
  id: string;
  shop_id: string;
  display_name: string;
  role: string;
}

async function fetchBarber(userId: string): Promise<Barber | null> {
  const { data, error } = await supabase()
    .from('barbers')
    .select('id, shop_id, display_name, role')
    .eq('id', userId)
    .maybeSingle<BarberRow>();
  if (error) throw error;
  if (!data) return null;
  if (!isBarberRole(data.role)) throw new Error(`barber ${data.id} has unknown role ${data.role}`);
  return { id: data.id, shopId: data.shop_id, displayName: data.display_name, role: data.role };
}

// Signs in with the email and password the shop was given. A user with no
// barber row belongs to no shop, so the session is dropped again.
export async function signIn(email: string, password: string): Promise<Barber> {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  const barber = await fetchBarber(data.user.id);
  if (!barber) {
    await supabase().auth.signOut();
    throw new Error(`user ${data.user.id} is not a barber of any shop`);
  }
  return barber;
}

export async function signOut(): Promise<void> {
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
