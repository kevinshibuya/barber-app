import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { anonClient, must, serviceClient, uniqueEmail } from './support/supabase';

const run = promisify(execFile);
const service = serviceClient();
const packageDir = join(__dirname, '..');

const shopName = `Barbearia ${randomUUID().slice(0, 8)}`;
const password = 'provisioned-1234';
const owner = uniqueEmail('owner');
const barbers = [uniqueEmail('rafa'), uniqueEmail('duda')];

function provision(...args: string[]) {
  return run('pnpm', ['run', '--silent', 'provision', ...args], { cwd: packageDir, env: process.env });
}

const args = ['--shop', shopName, '--owner', owner, ...barbers.flatMap((b) => ['--barber', b]), '--password', password];

async function usersByEmail() {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return new Map(data.users.filter((u) => u.email && [owner, ...barbers].includes(u.email)).map((u) => [u.email!, u]));
}

async function snapshot() {
  const users = await usersByEmail();
  const ids = [...users.values()].map((u) => u.id);
  const rows = must(await service.from('barbers').select('*').in('id', ids).order('id'));
  const shops = must(await service.from('shops').select('*').eq('name', shopName));
  const userState = [...users.entries()]
    .map(([email, u]) => ({ email, id: u.id, updated_at: u.updated_at }))
    .sort((a, b) => a.email.localeCompare(b.email));
  return { users, rows, shops, userState };
}

afterAll(async () => {
  const { users, shops } = await snapshot();
  for (const shop of shops) await service.from('shops').delete().eq('id', shop.id);
  for (const user of users.values()) await service.auth.admin.deleteUser(user.id);
});

describe('the provisioning script', () => {
  it('documents its arguments', async () => {
    const { stdout } = await provision('--help');
    for (const flag of ['--shop', '--owner', '--barber', '--password']) {
      expect(stdout).toContain(flag);
    }
  });

  it('creates the shop, its owner and its barbers, and changes nothing when run again', async () => {
    await provision(...args);
    const first = await snapshot();

    expect(first.shops).toHaveLength(1);
    const shop = first.shops[0]!;
    expect(first.users.size).toBe(3);
    const roleOf = (email: string) => first.rows.find((r) => r.id === first.users.get(email)!.id);
    expect(roleOf(owner)).toMatchObject({ shop_id: shop.id, role: 'owner' });
    for (const email of barbers) {
      expect(roleOf(email)).toMatchObject({ shop_id: shop.id, role: 'barber' });
    }

    await provision(...args);
    const second = await snapshot();

    expect(second.shops).toEqual(first.shops);
    expect(second.rows).toEqual(first.rows);
    expect(second.userState).toEqual(first.userState);

    // The barber can sign in with the password given, and sees their shop.
    const db = anonClient();
    expect((await db.auth.signInWithPassword({ email: barbers[0]!, password })).error).toBeNull();
    expect(must(await db.from('shops').select('id, name'))).toEqual([{ id: shop.id, name: shopName }]);
    await db.auth.signOut();
  });

  it('refuses to run without an owner', async () => {
    await expect(provision('--shop', shopName, '--password', password)).rejects.toMatchObject({
      stderr: expect.stringContaining('--owner'),
    });
  });
});
