import type { Client } from '@barber/shared';
import { supabase } from './supabase';

export interface NewClient {
  name: string;
  phone: string | null;
}

const SEARCH_LIMIT = 30;

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

// The shop's clients whose name contains the query, case-insensitive. Names
// that start with it come first, then the rest, each alphabetically.
export async function searchClients(query: string): Promise<Client[]> {
  const needle = query.trim();
  if (needle === '') return [];
  const { data, error } = await supabase()
    .from('clients')
    .select(CLIENT_COLUMNS)
    .ilike('name', `%${escapeLike(needle)}%`)
    .order('name')
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  const lower = needle.toLocaleLowerCase('pt-BR');
  const startsWith = (client: Client) => client.name.toLocaleLowerCase('pt-BR').startsWith(lower);
  const clients = data.map(toClient);
  return [...clients.filter(startsWith), ...clients.filter((client) => !startsWith(client))];
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

export async function getClient(clientId: string): Promise<Client> {
  const { data, error } = await supabase().from('clients').select(CLIENT_COLUMNS).eq('id', clientId).single();
  if (error) throw error;
  return toClient(data);
}
