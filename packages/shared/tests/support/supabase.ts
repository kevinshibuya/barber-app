// What every database test needs: a service-role client for setup, and a
// shop of its own with signed-in barbers whose clients carry only the anon key
// and the barber's JWT, so row-level security applies as it does in the app.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type BarberRole, type Database, GATE_ENV } from '../../src';

export type Db = SupabaseClient<Database>;

export const TEST_PASSWORD = 'test-password-1234';

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: run database tests through scripts/db-test.sh`);
  }
  return value;
}

export const supabaseUrl = () => env(GATE_ENV.supabaseUrl);
export const anonKey = () => env(GATE_ENV.supabaseAnonKey);
export const serviceRoleKey = () => env(GATE_ENV.supabaseServiceRoleKey);

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient(): Db {
  return createClient<Database>(supabaseUrl(), serviceRoleKey(), clientOptions);
}

export function anonClient(): Db {
  return createClient<Database>(supabaseUrl(), anonKey(), clientOptions);
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@test.barber.local`;
}

export function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) {
    throw result.error instanceof Error ? result.error : new Error(JSON.stringify(result.error));
  }
  if (result.data === null || result.data === undefined) {
    throw new Error('expected data, got null');
  }
  return result.data;
}

export interface TestBarber {
  id: string;
  email: string;
  role: BarberRole;
  // Anon key plus this barber's JWT.
  db: Db;
}

export interface TestShop {
  id: string;
  name: string;
  barbers: TestBarber[];
}

async function signIn(email: string): Promise<Db> {
  const db = anonClient();
  const { error } = await db.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  return db;
}

// Creates a shop and one auth user plus barber row per role given, and signs
// each barber in.
export async function createTestShop(service: Db, roles: BarberRole[]): Promise<TestShop> {
  const name = `Test shop ${randomUUID().slice(0, 8)}`;
  const shop = must(await service.from('shops').insert({ name }).select().single());
  const barbers: TestBarber[] = [];
  for (const [index, role] of roles.entries()) {
    const email = uniqueEmail(`${role}${index}`);
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    must(
      await service
        .from('barbers')
        .insert({ id: data.user.id, shop_id: shop.id, display_name: `${role} ${index}`, role })
        .select()
        .single(),
    );
    barbers.push({ id: data.user.id, email, role, db: await signIn(email) });
  }
  return { id: shop.id, name, barbers };
}

// Deletes the shop (its barbers, clients, visits and photos cascade) and then
// the auth users.
export async function deleteTestShop(service: Db, shop: TestShop | undefined): Promise<void> {
  if (!shop) return;
  for (const barber of shop.barbers) {
    await barber.db.auth.signOut().catch(() => undefined);
  }
  const { error } = await service.from('shops').delete().eq('id', shop.id);
  if (error) throw error;
  for (const barber of shop.barbers) {
    await service.auth.admin.deleteUser(barber.id);
  }
}

export function barber(shop: TestShop, role: BarberRole): TestBarber {
  const found = shop.barbers.find((b) => b.role === role);
  if (!found) throw new Error(`test shop has no ${role}`);
  return found;
}
