import {
  afterPhotoPath,
  originalPhotoPath,
  PHOTO_SLOTS,
  type Photo,
  type PhotoSlot,
  STORAGE_BUCKETS,
  type Visit,
} from '@barber/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from './supabase';
import { getVisit } from './visits';

// Photos leave the device at most this long on their long edge, as JPEG, so
// shop wifi carries a few hundred kilobytes per slot.
export const PHOTO_LONG_EDGE = 1024;
const JPEG_QUALITY = 0.8;
// Long enough for the slots screen to stay open through a visit.
const SIGNED_URL_SECONDS = 60 * 60;

export interface LocalImage {
  // A file URI on the device.
  uri: string;
  width: number;
  height: number;
}

// A shot from the camera or the gallery, for one slot of a visit.
export interface PhotoUpload extends LocalImage {
  visitId: string;
  slot: PhotoSlot;
}

// An uploaded photo, with a signed URL to show it.
export interface VisitPhoto extends Photo {
  url: string | null;
}

// What the device does to an image before it is uploaded.
export interface ImageTool {
  // Re-encodes the image as JPEG, resized to `size` when one is given.
  toJpeg(image: LocalImage, size: { width: number; height: number } | null): Promise<LocalImage>;
}

// Everything an upload sends over the network.
export interface PhotoTransport {
  // The visit's shop, and the slot's photo row when it has one.
  slotOf(visitId: string, slot: PhotoSlot): Promise<{ shopId: string; photo: Photo | null }>;
  // Inserts or updates the slot's one row.
  savePhoto(photo: Omit<Photo, 'id'>): Promise<Photo>;
  // Writes the object, replacing one already at the path.
  putOriginal(path: string, image: LocalImage): Promise<void>;
  removeOriginal(path: string): Promise<void>;
}

// The size that fits the long edge in PHOTO_LONG_EDGE, or null when the image
// already fits. Never upscales.
function fittedSize(width: number, height: number): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= PHOTO_LONG_EDGE) return null;
  const scale = PHOTO_LONG_EDGE / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Uploads one slot's shot: downscaled, written to its object path while its
// row says uploading, then flipped to uploaded. A retake of an uploaded photo
// goes to a new path, so the schema replaces the slot's previews; a retry of
// a failed upload reuses the path it had. A shot given a take goes to that
// take's path, and a take already uploaded there is not sent again, so a
// retry after a lost response leaves the slot's previews alone. Rejects when
// any step fails, with the row left uploading.
export function photoUploader(transport: PhotoTransport, images: ImageTool) {
  return async function upload(shot: PhotoUpload, take?: string): Promise<Photo> {
    const { visitId, slot } = shot;
    const [{ shopId, photo: current }, image] = await Promise.all([
      transport.slotOf(visitId, slot),
      images.toJpeg(shot, fittedSize(shot.width, shot.height)),
    ]);

    const takePath = take === undefined ? null : originalPhotoPath(shopId, visitId, slot, take);
    if (current?.uploadStatus === 'uploaded' && current.storagePath === takePath) return current;

    const retake = current?.uploadStatus === 'uploaded';
    const storagePath =
      takePath ??
      (retake
        ? originalPhotoPath(shopId, visitId, slot, Date.now().toString(36))
        : (current?.storagePath ?? originalPhotoPath(shopId, visitId, slot)));
    const row = { visitId, slot, storagePath, width: image.width, height: image.height };

    await transport.savePhoto({ ...row, uploadStatus: 'uploading' });
    await transport.putOriginal(storagePath, image);
    const uploaded = await transport.savePhoto({ ...row, uploadStatus: 'uploaded' });

    // The replaced take has no row pointing at it any more.
    if (current && current.storagePath !== storagePath) {
      await transport.removeOriginal(current.storagePath).catch(() => undefined);
    }
    return uploaded;
  };
}

const deviceImages: ImageTool = {
  async toJpeg(image, size) {
    const context = ImageManipulator.manipulate(image.uri);
    if (size) context.resize(size);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  },
};

const PHOTO_COLUMNS = 'id, visit_id, slot, storage_path, width, height, upload_status';

interface PhotoRow {
  id: string;
  visit_id: string;
  slot: PhotoSlot;
  storage_path: string;
  width: number;
  height: number;
  upload_status: Photo['uploadStatus'];
}

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    visitId: row.visit_id,
    slot: row.slot,
    storagePath: row.storage_path,
    width: row.width,
    height: row.height,
    uploadStatus: row.upload_status,
  };
}

const supabaseTransport: PhotoTransport = {
  async slotOf(visitId, slot) {
    const [visit, photo] = await Promise.all([
      supabase().from('visits').select('shop_id').eq('id', visitId).single(),
      supabase().from('photos').select(PHOTO_COLUMNS).eq('visit_id', visitId).eq('slot', slot).maybeSingle(),
    ]);
    if (visit.error) throw visit.error;
    if (photo.error) throw photo.error;
    return { shopId: visit.data.shop_id, photo: photo.data ? toPhoto(photo.data) : null };
  },

  async savePhoto(photo) {
    const { data, error } = await supabase()
      .from('photos')
      .upsert(
        {
          visit_id: photo.visitId,
          slot: photo.slot,
          storage_path: photo.storagePath,
          width: photo.width,
          height: photo.height,
          upload_status: photo.uploadStatus,
        },
        { onConflict: 'visit_id,slot' },
      )
      .select(PHOTO_COLUMNS)
      .single();
    if (error) throw error;
    return toPhoto(data);
  },

  async putOriginal(path, image) {
    const bytes = await (await fetch(image.uri)).arrayBuffer();
    const { error } = await supabase()
      .storage.from(STORAGE_BUCKETS.originals)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
  },

  async removeOriginal(path) {
    const { error } = await supabase().storage.from(STORAGE_BUCKETS.originals).remove([path]);
    if (error) throw error;
  },
};

const uploadWithSupabase = photoUploader(supabaseTransport, deviceImages);

// Sends one take of a slot now. Screens queue it with `uploadPhoto` instead.
export async function sendPhoto(shot: PhotoUpload, take: string): Promise<Photo> {
  return uploadWithSupabase(shot, take);
}

// The visit's photos in slot order, each with a signed URL to show it.
export async function listVisitPhotos(visitId: string): Promise<VisitPhoto[]> {
  const { data, error } = await supabase().from('photos').select(PHOTO_COLUMNS).eq('visit_id', visitId);
  if (error) throw error;
  const photos = data.map(toPhoto).sort((a, b) => PHOTO_SLOTS.indexOf(a.slot) - PHOTO_SLOTS.indexOf(b.slot));
  const uploaded = photos.filter((photo) => photo.uploadStatus === 'uploaded').map((photo) => photo.storagePath);
  const urls = new Map<string, string>();
  if (uploaded.length > 0) {
    const signed = await supabase()
      .storage.from(STORAGE_BUCKETS.originals)
      .createSignedUrls(uploaded, SIGNED_URL_SECONDS);
    if (signed.error) throw signed.error;
    for (const item of signed.data) {
      if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
    }
  }
  return photos.map((photo) => ({ ...photo, url: urls.get(photo.storagePath) ?? null }));
}

// Everything an after photo upload sends over the network.
export interface AfterPhotoTransport extends Pick<PhotoTransport, 'putOriginal'> {
  visitOf(visitId: string): Promise<Visit>;
  // Points the visit at the object, which locks its look.
  recordAfterPhoto(visitId: string, path: string): Promise<Visit>;
}

// Uploads the visit's after photo, downscaled like the slots, to the visit's
// after path, and records the path on the visit once the object is there. A
// retake replaces the object in place. Rejects with the visit unchanged when
// the upload fails.
export function afterPhotoUploader(transport: AfterPhotoTransport, images: ImageTool) {
  return async function upload(visitId: string, shot: LocalImage): Promise<Visit> {
    const [visit, image] = await Promise.all([
      transport.visitOf(visitId),
      images.toJpeg(shot, fittedSize(shot.width, shot.height)),
    ]);
    const path = afterPhotoPath(visit.shopId, visitId);
    await transport.putOriginal(path, image);
    return transport.recordAfterPhoto(visitId, path);
  };
}

const afterPhotoTransport: AfterPhotoTransport = {
  visitOf: getVisit,
  putOriginal: supabaseTransport.putOriginal,
  async recordAfterPhoto(visitId, path) {
    const { error } = await supabase().from('visits').update({ after_photo_path: path }).eq('id', visitId);
    if (error) throw error;
    return getVisit(visitId);
  },
};

const uploadAfterWithSupabase = afterPhotoUploader(afterPhotoTransport, deviceImages);

// Sends the after photo now. Screens queue it with `uploadAfterPhoto` instead.
export async function sendAfterPhoto(visitId: string, shot: LocalImage): Promise<Visit> {
  return uploadAfterWithSupabase(visitId, shot);
}
