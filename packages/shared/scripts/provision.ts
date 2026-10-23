// Creates a shop, its owner and its barbers in any Supabase project, with the
// service role. Idempotent on email: a user that exists keeps its password,
// and a barber row that exists is left as it is, so a second run with the
// same emails changes nothing and a run with one more barber adds just that
// one.
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { type BarberRole, type Database, WORKER_ENV } from '../src';

const USAGE = `Usage: pnpm --filter @barber/shared run provision -- \\
  --shop <name> --owner <email> [--barber <email>]... --password <password>

Creates the shop, the owner (role owner) and each barber (role barber) as
confirmed auth users sharing one password. An email may carry a display name
as <email>:<name>; without one the part before the @ is used.

Runs against ${WORKER_ENV.supabaseUrl} with ${WORKER_ENV.supabaseServiceRoleKey}.
Idempotent on email: existing users and barber rows are left unchanged, and
the shop is the owner's existing shop when the owner already has one.

Options:
  --shop <name>        the shop's name, used only when the shop is created
  --owner <email>      the shop's owner
  --barber <email>     a barber of the shop; repeat for each
  --password <pw>      the password of every user this run creates
  -h, --help           show this text`;

export interface ProvisionInput {
  shopName: string;
  owner: Person;
  barbers: Person[];
  password: string;
}

interface Person {
  email: string;
  displayName: string;
}

export interface ProvisionResult {
  shopId: string;
  shopCreated: boolean;
  barbers: { email: string; id: string; role: BarberRole; created: boolean }[];
}

class UsageError extends Error {}

function person(arg: string): Person {
  const [rawEmail = '', ...nameParts] = arg.split(':');
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new UsageError(`not an email: ${rawEmail}`);
  const displayName = nameParts.join(':').trim() || email.slice(0, email.indexOf('@'));
  return { email, displayName };
}

export function parseProvisionArgs(argv: string[]): ProvisionInput | 'help' {
  const { values } = parseArgs({
    // `pnpm run provision -- …` passes the `--` through.
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      shop: { type: 'string' },
      owner: { type: 'string' },
      barber: { type: 'string', multiple: true },
      password: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) return 'help';
  for (const name of ['shop', 'owner', 'password'] as const) {
    if (!values[name]?.trim()) throw new UsageError(`--${name} is required`);
  }
  const owner = person(values.owner!);
  const barbers = (values.barber ?? []).map(person);
  const emails = [owner, ...barbers].map((p) => p.email);
  const repeated = emails.find((email, index) => emails.indexOf(email) !== index);
  if (repeated) throw new UsageError(`${repeated} is given twice`);
  return { shopName: values.shop!.trim(), owner, barbers, password: values.password! };
}

async function allUsersByEmail(service: SupabaseClient<Database>): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) users.set(user.email.toLowerCase(), user);
    }
    if (data.users.length < 1000) return users;
  }
}

export async function provision(service: SupabaseClient<Database>, input: ProvisionInput): Promise<ProvisionResult> {
  const users = await allUsersByEmail(service);

  async function userFor(p: Person): Promise<{ user: User; created: boolean }> {
    const existing = users.get(p.email);
    if (existing) return { user: existing, created: false };
    const { data, error } = await service.auth.admin.createUser({
      email: p.email,
      password: input.password,
      email_confirm: true,
    });
    if (error) throw new Error(`creating ${p.email}: ${error.message}`);
    return { user: data.user, created: true };
  }

  async function barberRow(id: string) {
    const { data, error } = await service.from('barbers').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const owner = await userFor(input.owner);
  const ownerRow = await barberRow(owner.user.id);
  if (ownerRow && ownerRow.role !== 'owner') {
    throw new Error(`${input.owner.email} is already a barber, not an owner, of shop ${ownerRow.shop_id}`);
  }

  let shopId = ownerRow?.shop_id;
  const shopCreated = !shopId;
  if (!shopId) {
    const { data, error } = await service.from('shops').insert({ name: input.shopName }).select('id').single();
    if (error) throw new Error(`creating the shop: ${error.message}`);
    shopId = data.id;
  }

  const result: ProvisionResult = { shopId, shopCreated, barbers: [] };
  const people: [Person, BarberRole][] = [
    [input.owner, 'owner'],
    ...input.barbers.map((b): [Person, BarberRole] => [b, 'barber']),
  ];
  for (const [p, role] of people) {
    const { user, created } = p === input.owner ? owner : await userFor(p);
    const row = p === input.owner ? ownerRow : await barberRow(user.id);
    if (row && row.shop_id !== shopId) {
      throw new Error(`${p.email} is already a barber of another shop (${row.shop_id})`);
    }
    if (!row) {
      const { error } = await service
        .from('barbers')
        .insert({ id: user.id, shop_id: shopId, display_name: p.displayName, role });
      if (error) throw new Error(`adding ${p.email} to the shop: ${error.message}`);
    }
    result.barbers.push({ email: p.email, id: user.id, role: row?.role ?? role, created: created || !row });
  }
  return result;
}

async function main(argv: string[]): Promise<void> {
  let input: ProvisionInput | 'help';
  try {
    input = parseProvisionArgs(argv);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exitCode = 64;
    return;
  }
  if (input === 'help') {
    console.log(USAGE);
    return;
  }

  const url = process.env[WORKER_ENV.supabaseUrl];
  const key = process.env[WORKER_ENV.supabaseServiceRoleKey];
  if (!url || !key) {
    console.error(`${WORKER_ENV.supabaseUrl} and ${WORKER_ENV.supabaseServiceRoleKey} must be set.`);
    process.exitCode = 64;
    return;
  }
  const service = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await provision(service, input);

  console.log(`shop ${result.shopId} ${result.shopCreated ? 'created' : 'already existed'}`);
  for (const b of result.barbers) {
    console.log(`${b.role} ${b.email} ${b.id} ${b.created ? 'created' : 'already existed'}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
