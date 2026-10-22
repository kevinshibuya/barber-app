// The domain as the app and the worker exchange it, after the database's
// snake_case columns are mapped to camelCase. The schema tickets own the
// columns; these types follow them.

export const PHOTO_SLOTS = ['front', 'left', 'right', 'back'] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export const STYLE_DIMENSIONS = ['hair', 'beard'] as const;
export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export const VISIT_STATUSES = ['open', 'closed'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const PREVIEW_STATUSES = ['pending', 'running', 'done', 'failed', 'refused'] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export interface Shop {
  id: string;
  name: string;
}

export interface Client {
  id: string;
  shopId: string;
  name: string;
  phone: string | null;
  createdAt: string;
}

export interface Style {
  id: string;
  dimension: StyleDimension;
  slug: string;
  name: string;
  referenceImagePath: string | null;
  sortOrder: number;
}

export interface Visit {
  id: string;
  shopId: string;
  clientId: string;
  barberId: string;
  consentGiven: boolean;
  status: VisitStatus;
  chosenHairStyleId: string | null;
  chosenBeardStyleId: string | null;
  chosenPreviewId: string | null;
  afterPhotoPath: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface Photo {
  id: string;
  visitId: string;
  slot: PhotoSlot;
  storagePath: string;
  width: number;
  height: number;
}

export interface Preview {
  id: string;
  visitId: string;
  hairStyleId: string;
  beardStyleId: string;
  slot: PhotoSlot;
  status: PreviewStatus;
  storagePath: string | null;
  thumbnailPath: string | null;
}
