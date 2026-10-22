import type { Photo, PhotoSlot, Visit } from '@barber/shared';
import { notImplemented } from './not-implemented';

export interface PhotoUpload {
  visitId: string;
  slot: PhotoSlot;
  // A local file URI from the camera or the gallery.
  uri: string;
}

export async function uploadPhoto(upload: PhotoUpload): Promise<Photo> {
  return notImplemented('uploadPhoto');
}

export async function uploadAfterPhoto(visitId: string, uri: string): Promise<Visit> {
  return notImplemented('uploadAfterPhoto');
}
