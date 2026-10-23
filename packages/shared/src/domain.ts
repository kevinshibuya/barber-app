// The domain as the app and the worker exchange it, after the database's
// snake_case columns are mapped to camelCase. The schema tickets own the
// columns; these types follow them. The row types themselves, as Supabase
// returns them, are `Tables<'visits'>` and friends in `./database`, generated
// with `pnpm --filter @barber/shared run db:types`.
import { Constants } from './database';

// The database's enums, in the database's order.
export const PHOTO_SLOTS = Constants.public.Enums.photo_slot;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export const STYLE_DIMENSIONS = Constants.public.Enums.style_dimension;
export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export const VISIT_STATUSES = Constants.public.Enums.visit_status;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const UPLOAD_STATUSES = Constants.public.Enums.upload_status;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const PREVIEW_STATUSES = Constants.public.Enums.preview_status;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export interface Shop {
  id: string;
  name: string;
  createdAt: string;
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
  // `<dimension>/<slug>.png` in the styles bucket; null for keep.
  referenceImagePath: string | null;
  // Null for keep, which is never generated.
  prompt: string | null;
  sortOrder: number;
  active: boolean;
}

export interface Visit {
  id: string;
  shopId: string;
  clientId: string;
  barberId: string;
  consentGiven: boolean;
  consentAt: string | null;
  status: VisitStatus;
  chosenHairStyleId: string | null;
  chosenBeardStyleId: string | null;
  chosenPreviewId: string | null;
  afterPhotoPath: string | null;
  // The client page is `/v/<shareToken>`; null once the link has expired and
  // been cleared.
  shareToken: string | null;
  shareExpiresAt: string | null;
  providerName: string | null;
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
  uploadStatus: UploadStatus;
}

export interface Preview {
  id: string;
  visitId: string;
  hairStyleId: string;
  beardStyleId: string;
  slot: PhotoSlot;
  status: PreviewStatus;
  // Claims so far; the worker fails a row for good after its third.
  attemptCount: number;
  // Higher is claimed first: see PREVIEW_PRIORITY.
  priority: number;
  // A pending row is not claimed before this.
  notBefore: string;
  storagePath: string | null;
  thumbnailPath: string | null;
  error: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  // Set when the nightly cleanup deleted the objects; the row stays.
  purgedAt: string | null;
  createdAt: string;
}
