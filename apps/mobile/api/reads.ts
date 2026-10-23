import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Client } from '@barber/shared';
import { Directory, File, Paths } from 'expo-file-system';
import { fetchAllClients, fetchClient, fetchClients } from './clients';
import { reportLink } from './connectivity';
import { type CacheFiles, type ReadCache, readCache } from './read-cache';
import { fetchClientVisits, fetchRecentVisits, type VisitSummary } from './visits';

// The thumbnails live in the app's documents, which the system never clears.
function directory(): Directory {
  return new Directory(Paths.document, 'read-cache');
}

const deviceFiles: CacheFiles = {
  async save(url, name) {
    const folder = directory();
    folder.create({ idempotent: true, intermediates: true });
    const file = await File.downloadFileAsync(url, new File(folder, name), { idempotent: true });
    return file.uri;
  },
  async remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async clear() {
    const folder = directory();
    if (folder.exists) folder.delete();
  },
};

let cache: ReadCache | undefined;

// The app's one cache, created on first use so that importing the `api`
// module has no side effects.
function reads(): ReadCache {
  cache ??= readCache({
    transport: {
      searchClients: fetchClients,
      listClients: fetchAllClients,
      getClient: fetchClient,
      listRecentVisits: fetchRecentVisits,
      listClientVisits: fetchClientVisits,
    },
    storage: AsyncStorage,
    files: deviceFiles,
    onLink: (up) => reportLink('reads', up),
  });
  return cache;
}

// Each read below hands the copy on the device to `onCached` first, when
// there is one, then resolves with the network's and keeps it. With no
// connection it resolves with the copy on the device, and rejects only when
// there is none.

// The shop's clients whose name contains the query, case-insensitive. Names
// that start with it come first, then the rest, each alphabetically.
export function searchClients(query: string, onCached?: (clients: Client[]) => void): Promise<Client[]> {
  return reads().searchClients(query, onCached);
}

// Brings the device's copy of the shop's client list up to date, so search
// works with no connection. Never rejects.
export function syncClients(): Promise<void> {
  return reads().syncClients();
}

export function getClient(clientId: string, onCached?: (client: Client) => void): Promise<Client> {
  return reads().getClient(clientId, onCached);
}

// The shop's latest visits, newest first.
export function listRecentVisits(onCached?: (visits: VisitSummary[]) => void): Promise<VisitSummary[]> {
  return reads().listRecentVisits(onCached);
}

// A client's visits, newest first.
export function listClientVisits(
  clientId: string,
  onCached?: (visits: VisitSummary[]) => void,
): Promise<VisitSummary[]> {
  return reads().listClientVisits(clientId, onCached);
}

// Empties the device's copy, thumbnails included. Signing out calls it.
export function clearReadCache(): Promise<void> {
  return reads().clear();
}
