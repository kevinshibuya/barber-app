import type { Client } from '@barber/shared';
import { notImplemented } from './not-implemented';

export interface NewClient {
  name: string;
  phone: string | null;
}

export async function searchClients(query: string): Promise<Client[]> {
  return notImplemented('searchClients');
}

export async function createClient(input: NewClient): Promise<Client> {
  return notImplemented('createClient');
}

export async function getClient(clientId: string): Promise<Client> {
  return notImplemented('getClient');
}
