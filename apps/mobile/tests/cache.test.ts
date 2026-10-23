import type { Client } from '@barber/shared';
import type { VisitSummary } from '@/api';
import { type CacheFiles, type CacheStorage, type ReadTransport, readCache } from '@/api/read-cache';
import { client, visit } from './support/fixtures';

// Device storage that outlives any one cache, as AsyncStorage outlives the app.
function fakeStorage(): CacheStorage {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

// The device's files: each saved image is a file named after its download,
// holding the URL it came from.
function fakeFiles() {
  const saved = new Map<string, string>();
  const files: CacheFiles = {
    async save(url, name) {
      const uri = `file:///read-cache/${name}`;
      saved.set(uri, url);
      return uri;
    },
    async remove(uri) {
      saved.delete(uri);
    },
    async clear() {
      saved.clear();
    },
  };
  return { files, saved };
}

// The shop as the server holds it, behind a connection the test drops.
function fakeTransport({ clients = [] as Client[], visits = [] as VisitSummary[] } = {}) {
  const shop = { clients, visits };
  let down = false;

  function online() {
    if (down) throw new Error('Network request failed');
  }

  const transport: ReadTransport = {
    async searchClients(query) {
      online();
      const needle = query.toLowerCase();
      return shop.clients.filter((one) => one.name.toLowerCase().includes(needle));
    },
    async listClients() {
      online();
      return shop.clients;
    },
    async getClient(clientId) {
      online();
      const found = shop.clients.find((one) => one.id === clientId);
      if (!found) throw new Error('not found');
      return found;
    },
    async listRecentVisits() {
      online();
      return shop.visits;
    },
    async listClientVisits(clientId) {
      online();
      return shop.visits.filter((one) => one.clientId === clientId);
    },
  };

  return {
    transport,
    shop,
    goDown: () => {
      down = true;
    },
    comeBack: () => {
      down = false;
    },
  };
}

// Lets the cache's background writes and downloads settle.
async function settle() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

const ana = client({ id: 'c1', name: 'Ana Souza' });
const mariana = client({ id: 'c2', name: 'Mariana Costa' });
const bruno = client({ id: 'c3', name: 'Bruno Lima' });

describe('the read cache', () => {
  it('searches the shop client list it last synced when the transport is down', async () => {
    const network = fakeTransport({ clients: [mariana, bruno, ana] });
    const cache = readCache({ transport: network.transport, storage: fakeStorage(), files: fakeFiles().files });
    await cache.syncClients();

    network.goDown();

    await expect(cache.searchClients('an')).resolves.toEqual([ana, mariana]);
    await expect(cache.searchClients('LIMA')).resolves.toEqual([bruno]);
    await expect(cache.searchClients('zé')).resolves.toEqual([]);
  });

  it('returns a visit read before with its thumbnails as files on the device, after a restart with the transport down', async () => {
    const storage = fakeStorage();
    const device = fakeFiles();
    const network = fakeTransport({
      clients: [ana],
      visits: [
        visit({
          id: 'v1',
          lookThumbnailUrl: 'https://storage.test/previews/s1/v1/pv1.thumb.jpg?token=a',
          afterPhotoUrl: 'https://storage.test/originals/s1/v1/after.jpg?token=b',
        }),
      ],
    });
    const before = readCache({ transport: network.transport, storage, files: device.files });
    await before.getClient('c1');
    const online = await before.listClientVisits('c1');
    expect(online[0]!.lookThumbnailUrl).toBe('https://storage.test/previews/s1/v1/pv1.thumb.jpg?token=a');
    await settle();

    network.goDown();
    const after = readCache({ transport: network.transport, storage, files: device.files });

    await expect(after.getClient('c1')).resolves.toEqual(ana);
    const [offline] = await after.listClientVisits('c1');
    expect(offline).toEqual({ ...online[0], lookThumbnailUrl: expect.any(String), afterPhotoUrl: expect.any(String) });
    expect(device.saved.get(offline!.lookThumbnailUrl!)).toBe('https://storage.test/previews/s1/v1/pv1.thumb.jpg?token=a');
    expect(device.saved.get(offline!.afterPhotoUrl!)).toBe('https://storage.test/originals/s1/v1/after.jpg?token=b');
  });

  it('keeps what a successful network read returns, in place of what it held', async () => {
    const network = fakeTransport({ clients: [ana], visits: [visit({ id: 'v1', barberName: 'Rafa' })] });
    const cache = readCache({ transport: network.transport, storage: fakeStorage(), files: fakeFiles().files });
    await cache.syncClients();
    await cache.listRecentVisits();

    network.shop.clients = [{ ...ana, phone: '11 90000-0000' }, mariana];
    network.shop.visits = [visit({ id: 'v2', clientName: 'Mariana Costa' }), visit({ id: 'v1', barberName: 'Téo' })];
    await cache.syncClients();
    await cache.listRecentVisits();
    network.goDown();

    await expect(cache.searchClients('an')).resolves.toEqual([{ ...ana, phone: '11 90000-0000' }, mariana]);
    const recent = await cache.listRecentVisits();
    expect(recent.map((one) => [one.id, one.barberName])).toEqual([
      ['v2', 'Rafa'],
      ['v1', 'Téo'],
    ]);
  });

  it('hands over the cached copy before the network answers', async () => {
    const network = fakeTransport({ visits: [visit({ id: 'v1' })] });
    const cache = readCache({ transport: network.transport, storage: fakeStorage(), files: fakeFiles().files });
    await cache.listRecentVisits();
    network.shop.visits = [visit({ id: 'v2' }), visit({ id: 'v1' })];

    const seen: string[][] = [];
    const fresh = await cache.listRecentVisits((cached) => seen.push(cached.map((one) => one.id)));

    expect(seen).toEqual([['v1']]);
    expect(fresh.map((one) => one.id)).toEqual(['v2', 'v1']);
  });

  it('fails a read it holds nothing for while the transport is down', async () => {
    const network = fakeTransport({ clients: [ana] });
    network.goDown();
    const cache = readCache({ transport: network.transport, storage: fakeStorage(), files: fakeFiles().files });

    await expect(cache.getClient('c1')).rejects.toThrow('Network request failed');
    await expect(cache.listRecentVisits()).rejects.toThrow('Network request failed');
    await expect(cache.searchClients('an')).rejects.toThrow('Network request failed');
  });

  it('is empty after sign-out, its files removed, even across a restart', async () => {
    const storage = fakeStorage();
    const device = fakeFiles();
    const network = fakeTransport({
      clients: [ana],
      visits: [visit({ id: 'v1', lookThumbnailUrl: 'https://storage.test/previews/s1/v1/pv1.thumb.jpg?token=a' })],
    });
    const cache = readCache({ transport: network.transport, storage, files: device.files });
    await cache.syncClients();
    await cache.listRecentVisits();
    await cache.listClientVisits('c1');
    await settle();
    expect(device.saved.size).toBe(1);

    await cache.clear();
    network.goDown();

    expect(device.saved.size).toBe(0);
    await expect(cache.searchClients('an')).rejects.toThrow();
    await expect(cache.getClient('c1')).rejects.toThrow();
    await expect(cache.listRecentVisits()).rejects.toThrow();
    const restarted = readCache({ transport: network.transport, storage, files: device.files });
    await expect(restarted.listClientVisits('c1')).rejects.toThrow();
  });

  it('keeps the home list and the last twenty visits opened on client screens, and drops older ones with their files', async () => {
    const device = fakeFiles();
    const opened = Array.from({ length: 21 }, (_, i) =>
      visit({ id: `old${i}`, clientId: `c${i}`, lookThumbnailUrl: `https://storage.test/previews/old${i}.jpg?t=1` }),
    );
    const network = fakeTransport({ visits: [visit({ id: 'home', clientId: 'cx' }), ...opened] });
    const cache = readCache({ transport: network.transport, storage: fakeStorage(), files: device.files });
    for (let i = 0; i < 21; i += 1) await cache.listClientVisits(`c${i}`);
    network.shop.visits = [visit({ id: 'home', clientId: 'cx' })];
    await cache.listRecentVisits();
    await settle();

    network.goDown();

    await expect(cache.listClientVisits('c0')).rejects.toThrow();
    await expect(cache.listClientVisits('c1')).resolves.toEqual([
      expect.objectContaining({ id: 'old1', lookThumbnailUrl: expect.stringMatching(/^file:/) }),
    ]);
    await expect(cache.listClientVisits('c20')).resolves.toHaveLength(1);
    await expect(cache.listRecentVisits()).resolves.toEqual([expect.objectContaining({ id: 'home' })]);
    expect([...device.saved.values()]).not.toContain('https://storage.test/previews/old0.jpg?t=1');
    expect(device.saved.size).toBe(20);
  });
});
