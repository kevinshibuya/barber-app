import type { Client } from '@barber/shared';
import { supabase } from './supabase';

export interface NewClient {
  name: string;
  phone: string | null;
}

const SEARCH_LIMIT = 30;
// PostgREST answers at most this many rows per request.
const PAGE_SIZE = 1000;

const CLIENT_COLUMNS = 'id, shop_id, name, phone, created_at';

interface ClientRow {
  id: string;
  shop_id: string;
  name: string;
  phone: string | null;
  created_at: string;
}

function toClient(row: ClientRow): Client {
  return { id: row.id, shopId: row.shop_id, name: row.name, phone: row.phone, createdAt: row.created_at };
}

// `%`, `_` and `\` are wildcards or the escape in a LIKE pattern.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function lower(text: string): string {
  return text.toLocaleLowerCase('pt-BR');
}

// Clients sorted by name, those whose name starts with the needle first.
function rankByName(needle: string, clients: Client[]): Client[] {
  const startsWith = (client: Client) => lower(client.name).startsWith(lower(needle));
  return [...clients.filter(startsWith), ...clients.filter((client) => !startsWith(client))];
}

// The shop's clients whose name contains the query, case-insensitive. Names
// that start with it come first, then the rest, each alphabetically.
export async function fetchClients(query: string): Promise<Client[]> {
  const needle = query.trim();
  if (needle === '') return [];
  const { data, error } = await supabase()
    .from('clients')
    .select(CLIENT_COLUMNS)
    .ilike('name', `%${escapeLike(needle)}%`)
    .order('name')
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  return rankByName(needle, data.map(toClient));
}

// The same search as `fetchClients`, over a list of clients on the device.
export function searchClientList(query: string, clients: Client[]): Client[] {
  const needle = query.trim();
  if (needle === '') return [];
  const matches = clients
    .filter((client) => lower(client.name).includes(lower(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return rankByName(needle, matches).slice(0, SEARCH_LIMIT);
}

// Every client of the shop, alphabetically.
export async function fetchAllClients(): Promise<Client[]> {
  const clients: Client[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase()
      .from('clients')
      .select(CLIENT_COLUMNS)
      .order('name')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    clients.push(...data.map(toClient));
    if (data.length < PAGE_SIZE) return clients;
  }
}

// Registers a client in the caller's shop. A blank phone is stored as none.
export async function createClient(input: NewClient): Promise<Client> {
  const { data: shopId, error: shopError } = await supabase().rpc('current_shop_id');
  if (shopError) throw shopError;
  if (!shopId) throw new Error('the signed-in user is not a barber of any shop');
  const phone = input.phone?.trim() || null;
  const { data, error } = await supabase()
    .from('clients')
    .insert({ shop_id: shopId, name: input.name.trim(), phone })
    .select(CLIENT_COLUMNS)
    .single();
  if (error) throw error;
  return toClient(data);
}

export async function fetchClient(clientId: string): Promise<Client> {
  const { data, error } = await supabase().from('clients').select(CLIENT_COLUMNS).eq('id', clientId).single();
  if (error) throw error;
  return toClient(data);
}
