import type { Client } from '@barber/shared';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import * as api from '@/api';
import type { VisitSummary } from '@/api';
import { reportLink, subscribeToConnectivity } from '@/api/connectivity';
import { type ReadCache, type ReadTransport, readCache } from '@/api/read-cache';
import { strings } from '@/lib/strings';
import { client, rafa, visit } from './support/fixtures';

const ana = client({ id: 'c1', name: 'Ana Souza' });
const mariana = client({ id: 'c2', name: 'Mariana Costa' });

const VISITS = [
  visit({
    id: 'v2',
    clientId: 'c2',
    clientName: 'Mariana Costa',
    barberName: 'Téo',
    createdAt: '2026-10-21T14:00:00.000Z',
    lookThumbnailUrl: 'https://storage.test/previews/s1/v2/pv.thumb.jpg?token=a',
    afterPhotoUrl: 'https://storage.test/originals/s1/v2/after.jpg?token=b',
  }),
  visit({
    id: 'v1',
    clientId: 'c1',
    clientName: 'Ana Souza',
    barberName: 'Rafa',
    createdAt: '2026-10-20T15:00:00.000Z',
    lookThumbnailUrl: 'https://storage.test/previews/s1/v1/pv.thumb.jpg?token=c',
  }),
];

// The shop behind a connection the test drops.
function fakeTransport(clients: Client[], visits: VisitSummary[]) {
  let down = false;
  async function online() {
    if (down) throw new Error('Network request failed');
  }
  const transport: ReadTransport = {
    searchClients: async (query) => {
      await online();
      return clients.filter((one) => one.name.toLowerCase().includes(query.toLowerCase()));
    },
    listClients: async () => {
      await online();
      return clients;
    },
    getClient: async (clientId) => {
      await online();
      return clients.find((one) => one.id === clientId)!;
    },
    listRecentVisits: async () => {
      await online();
      return visits;
    },
    listClientVisits: async (clientId) => {
      await online();
      return visits.filter((one) => one.clientId === clientId);
    },
  };
  return {
    transport,
    goDown: () => {
      down = true;
    },
  };
}

let network: ReturnType<typeof fakeTransport>;
let cache: ReadCache;

// Lets the cache's background downloads settle.
async function settle() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

beforeEach(() => {
  const stored = new Map<string, string>();
  network = fakeTransport([ana, mariana], VISITS);
  cache = readCache({
    transport: network.transport,
    storage: {
      getItem: async (key) => stored.get(key) ?? null,
      setItem: async (key, value) => void stored.set(key, value),
      removeItem: async (key) => void stored.delete(key),
    },
    files: {
      save: async (_url, name) => `file:///read-cache/${name}`,
      remove: async () => undefined,
      clear: async () => undefined,
    },
    onLink: (up) => reportLink('reads', up),
  });

  // The screens read through the real cache and hear the real connectivity.
  jest.mocked(api.searchClients).mockImplementation(cache.searchClients);
  jest.mocked(api.syncClients).mockImplementation(cache.syncClients);
  jest.mocked(api.getClient).mockImplementation(cache.getClient);
  jest.mocked(api.listRecentVisits).mockImplementation(cache.listRecentVisits);
  jest.mocked(api.listClientVisits).mockImplementation(cache.listClientVisits);
  jest.mocked(api.subscribeToConnectivity).mockImplementation(subscribeToConnectivity);
  jest.mocked(api.getCurrentBarber).mockResolvedValue(rafa);
  jest.mocked(api.listOpenVisitsToday).mockRejectedValue(new Error('Network request failed'));
});

afterEach(() => reportLink('reads', true));

function lookOf(row: ReturnType<typeof within>) {
  return row.getByLabelText(strings.visit.look);
}

describe('screens with the network down', () => {
  it('home shows the recent visits read before, thumbnails from the device, and the connectivity indicator', async () => {
    await cache.listRecentVisits();
    await settle();
    network.goDown();

    await renderRouter('./app', { initialUrl: '/' });

    const mariana = within(await screen.findByLabelText('Mariana Costa, 21/10/2026'));
    expect(mariana.getByText('com Téo')).toBeOnTheScreen();
    expect(lookOf(mariana).props.source.uri).toMatch(/^file:\/\/\/read-cache\/v2-look-/);
    expect(mariana.getByLabelText(strings.visit.after).props.source.uri).toMatch(/^file:\/\/\/read-cache\/v2-after-/);
    const ana = within(screen.getByLabelText('Ana Souza, 20/10/2026'));
    expect(lookOf(ana).props.source.uri).toMatch(/^file:\/\/\/read-cache\/v1-look-/);
    expect(await screen.findByText(strings.connectivity.offline)).toBeOnTheScreen();
    expect(screen.queryByText(strings.home.loadFailed)).toBeNull();
  });

  it('search finds clients in the client list synced before', async () => {
    await cache.syncClients();
    await cache.listRecentVisits();
    network.goDown();

    await renderRouter('./app', { initialUrl: '/' });
    await fireEvent.changeText(await screen.findByLabelText(strings.home.search), 'an');

    expect(await screen.findByText('Mariana Costa')).toBeOnTheScreen();
    expect(screen.getByText('Ana Souza')).toBeOnTheScreen();
    expect(screen.queryByText(strings.home.loadFailed)).toBeNull();
  });

  it('the client screen shows a client opened before with their visits', async () => {
    await cache.getClient('c1');
    await cache.listClientVisits('c1');
    await settle();
    network.goDown();

    await renderRouter('./app', { initialUrl: '/clients/c1' });

    expect(await screen.findByText('Ana Souza')).toBeOnTheScreen();
    const row = within(await screen.findByLabelText('20/10/2026'));
    expect(lookOf(row).props.source.uri).toMatch(/^file:\/\/\/read-cache\/v1-look-/);
    expect(await screen.findByText(strings.connectivity.offline)).toBeOnTheScreen();
    expect(screen.queryByText(strings.client.loadFailed)).toBeNull();
  });
});
