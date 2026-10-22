import type { Barber, Client } from '@barber/shared';
import type { VisitSummary } from '@/api';

export const rafa: Barber = { id: 'b1', shopId: 's1', displayName: 'Rafa', role: 'owner' };

export function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    shopId: 's1',
    name: 'Ana Souza',
    phone: '11 98888-7777',
    createdAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

export function visit(overrides: Partial<VisitSummary> = {}): VisitSummary {
  return {
    id: 'v1',
    clientId: 'c1',
    clientName: 'Ana Souza',
    barberName: 'Rafa',
    status: 'closed',
    createdAt: '2026-10-20T15:00:00.000Z',
    lookThumbnailUrl: null,
    afterPhotoUrl: null,
    ...overrides,
  };
}
