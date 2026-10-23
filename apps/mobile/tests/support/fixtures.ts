import type { Barber, Client, StyleDimension, Visit } from '@barber/shared';
import type { CatalogStyle, VisitPhoto, VisitSummary } from '@/api';

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

export function openVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'v1',
    shopId: 's1',
    clientId: 'c1',
    barberId: 'b1',
    consentGiven: true,
    consentAt: '2026-10-22T14:00:00.000Z',
    status: 'open',
    chosenHairStyleId: null,
    chosenBeardStyleId: null,
    chosenPreviewId: null,
    afterPhotoPath: null,
    shareToken: 'token',
    shareExpiresAt: '2026-11-21T14:00:00.000Z',
    providerName: null,
    createdAt: '2026-10-22T14:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

export function uploadedPhoto(overrides: Partial<VisitPhoto> = {}): VisitPhoto {
  return {
    id: 'p1',
    visitId: 'v1',
    slot: 'front',
    storagePath: 's1/v1/front.jpg',
    width: 768,
    height: 1024,
    uploadStatus: 'uploaded',
    url: 'https://storage.test/front.jpg',
    ...overrides,
  };
}

export function keepStyle(dimension: StyleDimension): CatalogStyle {
  return {
    id: `${dimension}-keep`,
    dimension,
    slug: 'keep',
    name: 'Manter como está',
    referenceImagePath: null,
    prompt: null,
    sortOrder: 0,
    active: true,
    referenceImageUrl: null,
  };
}
