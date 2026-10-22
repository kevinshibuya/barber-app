// What the worker's database tests need: a service-role client, as the worker
// itself holds, and a shop of their own with one signed-in barber, whose
// client carries the anon key and the barber's JWT for the barber's functions.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type Database, GATE_ENV } from '@barber/shared';

export type Db = SupabaseClient<Database>;

const TEST_PASSWORD = 'test-password-1234';

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: run database tests through scripts/db-test.sh`);
  }
  return value;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient(): Db {
  return createClient<Database>(
    env(GATE_ENV.supabaseUrl),
    env(GATE_ENV.supabaseServiceRoleKey),
    clientOptions,
  );
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

export interface TestShop {
  id: string;
  barberId: string;
  // Anon key plus the barber's JWT.
  barber: Db;
}

export async function createTestShop(service: Db): Promise<TestShop> {
  const shop = must(
    await service
      .from('shops')
      .insert({ name: `Worker test shop ${randomUUID().slice(0, 8)}` })
      .select()
      .single(),
  );
  const email = `worker-${randomUUID().slice(0, 8)}@test.barber.local`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  must(
    await service
      .from('barbers')
      .insert({ id: data.user.id, shop_id: shop.id, display_name: 'Worker barber', role: 'barber' })
      .select()
      .single(),
  );
  const barber = createClient<Database>(
    env(GATE_ENV.supabaseUrl),
    env(GATE_ENV.supabaseAnonKey),
    clientOptions,
  );
  const signIn = await barber.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signIn.error) throw signIn.error;
  return { id: shop.id, barberId: data.user.id, barber };
}

// Deletes the shop's objects under its prefix in each bucket given, then the
// shop (its rows cascade), then the barber's auth user.
export async function deleteTestShop(
  service: Db,
  shop: TestShop | undefined,
  buckets: string[],
): Promise<void> {
  if (!shop) return;
  await shop.barber.auth.signOut().catch(() => undefined);
  for (const bucket of buckets) {
    const visits = must(await service.storage.from(bucket).list(shop.id, { limit: 1000 }));
    for (const visit of visits) {
      const prefix = `${shop.id}/${visit.name}`;
      const objects = must(await service.storage.from(bucket).list(prefix, { limit: 1000 }));
      if (objects.length > 0) {
        must(await service.storage.from(bucket).remove(objects.map((o) => `${prefix}/${o.name}`)));
      }
    }
  }
  const { error } = await service.from('shops').delete().eq('id', shop.id);
  if (error) throw error;
  await service.auth.admin.deleteUser(shop.barberId);
}
