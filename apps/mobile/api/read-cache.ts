import type { Client } from '@barber/shared';
import { searchClientList } from './clients';
import type { VisitSummary } from './visits';

// Everything the cache reads over the network.
export interface ReadTransport {
  searchClients(query: string): Promise<Client[]>;
  // Every client of the shop.
  listClients(): Promise<Client[]>;
  getClient(clientId: string): Promise<Client>;
  listRecentVisits(): Promise<VisitSummary[]>;
  listClientVisits(clientId: string): Promise<VisitSummary[]>;
}

// The three calls of AsyncStorage the cache needs.
export interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// The device's files the thumbnails are kept in.
export interface CacheFiles {
  // Downloads the image at `url` to a file called `name`; resolves with its URI.
  save(url: string, name: string): Promise<string>;
  remove(uri: string): Promise<void>;
  // Removes every file the cache saved.
  clear(): Promise<void>;
}

// A thumbnail of a cached visit: the object its signed URL points at, and the
// file it was saved to once the download is done.
interface Thumbnail {
  source: string;
  file: string | null;
}

interface CachedVisit {
  summary: VisitSummary;
  look: Thumbnail | null;
  after: Thumbnail | null;
}

interface Stored {
  // The shop's clients by id; null until a client list is read.
  clients: Record<string, Client> | null;
  visits: Record<string, CachedVisit>;
  // The home list, by visit id; null until it is read.
  recent: string[] | null;
  // Each client's visits, by visit id.
  clientVisits: Record<string, string[]>;
  // Visits read on a client screen, the latest first.
  opened: string[];
}

export const CACHE_STORAGE_KEY = 'barber.read-cache';
// The visits read on client screens the cache keeps, on top of the home list.
const OPENED_LIMIT = 20;

function empty(): Stored {
  return { clients: null, visits: {}, recent: null, clientVisits: {}, opened: [] };
}

// A signed URL without its token names the object it signs.
function sourceOf(url: string): string {
  return url.split('?')[0]!;
}

// A copy on the device of what the screens read: the shop's client list and
// the last visits read, their thumbnails saved as files. Every read hands the
// cached copy to `onCached` before asking the network, answers with the
// network's copy and keeps it, and falls back to the cached copy when the
// network fails; with nothing cached the failure is the answer. `onLink`
// hears whether each network read went through.
export function readCache({
  transport,
  storage,
  files,
  onLink,
  storageKey = CACHE_STORAGE_KEY,
}: {
  transport: ReadTransport;
  storage: CacheStorage;
  files: CacheFiles;
  onLink?: (up: boolean) => void;
  storageKey?: string;
}) {
  let stored = empty();
  let loaded: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();
  let downloads: Promise<void> = Promise.resolve();
  // Bumped by `clear`, so a read or download that started before it keeps nothing.
  let generation = 0;
  let saves = 0;

  // Storage that cannot be read, or holds what is not a cache, starts it empty.
  function load(): Promise<void> {
    loaded ??= storage
      .getItem(storageKey)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && 'visits' in parsed) stored = { ...empty(), ...(parsed as Stored) };
      })
      .catch(() => undefined);
    return loaded;
  }

  // Writes are chained so the last one stored is the latest cache.
  function persist() {
    const snapshot = JSON.stringify(stored);
    writes = writes.then(() => storage.setItem(storageKey, snapshot)).catch(() => undefined);
  }

  function summaryOf({ summary, look, after }: CachedVisit): VisitSummary {
    return { ...summary, lookThumbnailUrl: look?.file ?? null, afterPhotoUrl: after?.file ?? null };
  }

  function visitsOf(ids: string[]): VisitSummary[] {
    return ids.flatMap((id) => {
      const cached = stored.visits[id];
      return cached ? [summaryOf(cached)] : [];
    });
  }

  // Saves the thumbnail's file in the background, one download at a time. A
  // thumbnail replaced or cleared meanwhile keeps no file.
  function download(visitId: string, kind: 'look' | 'after', url: string, thumbnail: Thumbnail) {
    const mine = generation;
    const name = `${visitId}-${kind}-${Date.now().toString(36)}${(saves += 1).toString(36)}.jpg`;
    const wanted = () => mine === generation && stored.visits[visitId]?.[kind] === thumbnail;
    downloads = downloads.then(async () => {
      if (!wanted()) return;
      let file: string;
      try {
        file = await files.save(url, name);
      } catch {
        // Saved on the next read that brings this thumbnail.
        return;
      }
      if (!wanted()) {
        await files.remove(file).catch(() => undefined);
        return;
      }
      thumbnail.file = file;
      persist();
    });
  }

  // The thumbnail at `url`: the one cached when its file holds the same
  // object, or a new one whose file is on its way.
  function thumbnail(visitId: string, kind: 'look' | 'after', url: string | null): Thumbnail | null {
    if (!url) return null;
    const previous = stored.visits[visitId]?.[kind];
    if (previous?.file && previous.source === sourceOf(url)) return previous;
    const fresh: Thumbnail = { source: sourceOf(url), file: null };
    download(visitId, kind, url, fresh);
    return fresh;
  }

  function removeFiles(...thumbnails: (Thumbnail | null)[]) {
    for (const old of thumbnails) {
      if (old?.file) void files.remove(old.file).catch(() => undefined);
    }
  }

  function keepVisits(summaries: VisitSummary[]) {
    for (const summary of summaries) {
      const previous = stored.visits[summary.id];
      const look = thumbnail(summary.id, 'look', summary.lookThumbnailUrl);
      const after = thumbnail(summary.id, 'after', summary.afterPhotoUrl);
      if (previous?.look !== look) removeFiles(previous?.look ?? null);
      if (previous?.after !== after) removeFiles(previous?.after ?? null);
      stored.visits[summary.id] = { summary, look, after };
    }
  }

  // Drops the visits neither on the home list nor among the last opened, and
  // their files.
  function evict() {
    stored.opened = stored.opened.slice(0, OPENED_LIMIT);
    const held = new Set([...(stored.recent ?? []), ...stored.opened]);
    for (const [id, cached] of Object.entries(stored.visits)) {
      if (held.has(id)) continue;
      removeFiles(cached.look, cached.after);
      delete stored.visits[id];
    }
    for (const [clientId, ids] of Object.entries(stored.clientVisits)) {
      if (ids.length > 0 && !ids.some((id) => held.has(id))) delete stored.clientVisits[clientId];
    }
  }

  // One read: the cached copy first, then the network's, kept by `keep`.
  async function read<T>(
    network: () => Promise<T>,
    cached: () => T | undefined,
    keep: (fresh: T) => void,
    onCached?: (value: T) => void,
  ): Promise<T> {
    await load();
    const mine = generation;
    const before = cached();
    if (before !== undefined) onCached?.(before);
    let fresh: T;
    try {
      fresh = await network();
    } catch (error) {
      onLink?.(false);
      const fallback = mine === generation ? cached() : undefined;
      if (fallback === undefined) throw error;
      return fallback;
    }
    onLink?.(true);
    if (mine === generation) {
      keep(fresh);
      persist();
    }
    return fresh;
  }

  function keepClients(clients: Client[]) {
    stored.clients ??= {};
    for (const client of clients) stored.clients[client.id] = client;
  }

  return {
    // The shop's clients whose name contains the query, as `fetchClients` ranks them.
    searchClients(query: string, onCached?: (clients: Client[]) => void): Promise<Client[]> {
      return read(
        () => transport.searchClients(query),
        () => (stored.clients ? searchClientList(query, Object.values(stored.clients)) : undefined),
        keepClients,
        onCached,
      );
    },

    // Replaces the cached client list with the shop's. Never rejects: a
    // failed sync leaves the last list in place.
    async syncClients(): Promise<void> {
      await read(
        () => transport.listClients(),
        () => undefined,
        (clients) => {
          stored.clients = {};
          keepClients(clients);
        },
      ).catch(() => undefined);
    },

    getClient(clientId: string, onCached?: (client: Client) => void): Promise<Client> {
      return read(
        () => transport.getClient(clientId),
        () => stored.clients?.[clientId],
        (client) => keepClients([client]),
        onCached,
      );
    },

    listRecentVisits(onCached?: (visits: VisitSummary[]) => void): Promise<VisitSummary[]> {
      return read(
        () => transport.listRecentVisits(),
        () => (stored.recent ? visitsOf(stored.recent) : undefined),
        (visits) => {
          keepVisits(visits);
          stored.recent = visits.map((visit) => visit.id);
          evict();
        },
        onCached,
      );
    },

    listClientVisits(clientId: string, onCached?: (visits: VisitSummary[]) => void): Promise<VisitSummary[]> {
      return read(
        () => transport.listClientVisits(clientId),
        () => {
          const ids = stored.clientVisits[clientId];
          return ids ? visitsOf(ids) : undefined;
        },
        (visits) => {
          const ids = visits.map((visit) => visit.id);
          keepVisits(visits);
          stored.clientVisits[clientId] = ids;
          stored.opened = [...ids, ...stored.opened.filter((id) => !ids.includes(id))];
          evict();
        },
        onCached,
      );
    },

    // Forgets everything, files included, as signing out does.
    async clear(): Promise<void> {
      await load();
      generation += 1;
      stored = empty();
      writes = writes.then(() => storage.removeItem(storageKey)).catch(() => undefined);
      await Promise.all([writes, files.clear().catch(() => undefined)]);
    },
  };
}

export type ReadCache = ReturnType<typeof readCache>;
