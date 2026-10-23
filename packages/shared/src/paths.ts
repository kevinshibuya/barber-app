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

// Every object of a visit sits under this prefix. A path a row names outside
// it is another visit's object, never to be read or signed for this one.
export function visitObjectPrefix(shopId: string, visitId: string): string {
  return `${shopId}/${visitId}/`;
}

// A slot's first take is `<slot>.jpg`. A retake of an uploaded photo goes to
// `<slot>.<take>.jpg`, a new path, which is what makes the photos trigger
// replace the slot's previews.
export function originalPhotoPath(shopId: string, visitId: string, slot: PhotoSlot, take?: string): string {
  return take === undefined ? `${shopId}/${visitId}/${slot}.jpg` : `${shopId}/${visitId}/${slot}.${take}.jpg`;
}

// Each take of the after photo has a path of its own, like a slot's retake, so
// a copy a device cached is never taken for the photo that replaced it.
export function afterPhotoPath(shopId: string, visitId: string, take?: string): string {
  return take === undefined ? `${shopId}/${visitId}/after.jpg` : `${shopId}/${visitId}/after.${take}.jpg`;
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
