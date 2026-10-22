// Storage buckets and object paths, fixed for every package. Storage policies
// read the first path segment of `originals` and `previews` as the shop id, so
// every object of a visit sits under `<shop id>/<visit id>/`.
import type { PhotoSlot, StyleDimension } from './domain';

export const STORAGE_BUCKETS = {
  // Private: client photos and after photos.
  originals: 'originals',
  // Private: generated previews and their thumbnails.
  previews: 'previews',
  // Public: style reference images.
  styles: 'styles',
} as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

// Each dimension's "keep as is" style: no prompt, no image, no generation.
export const KEEP_STYLE_SLUG = 'keep';

export const SHARE_LINK_DAYS = 30;
// 32 random bytes as unpadded base64url.
export const SHARE_TOKEN_LENGTH = 43;

export function originalPhotoPath(shopId: string, visitId: string, slot: PhotoSlot): string {
  return `${shopId}/${visitId}/${slot}.jpg`;
}

export function afterPhotoPath(shopId: string, visitId: string): string {
  return `${shopId}/${visitId}/after.jpg`;
}

export function previewImagePath(shopId: string, visitId: string, previewId: string): string {
  return `${shopId}/${visitId}/${previewId}.jpg`;
}

export function previewThumbnailPath(shopId: string, visitId: string, previewId: string): string {
  return `${shopId}/${visitId}/${previewId}.thumb.jpg`;
}

// Also the style row's `reference_image_path`.
export function styleReferencePath(dimension: StyleDimension, slug: string): string {
  return `${dimension}/${slug}.png`;
}

// The client page's route on the worker.
export function clientPagePath(shareToken: string): string {
  return `/v/${shareToken}`;
}
