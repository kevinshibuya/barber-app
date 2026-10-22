// The four photo slots of a visit as the slots screen shows them. Pure state
// with no network, so screens import this file directly and screen tests keep
// it real while the rest of the `api` module is mocked.
import { PHOTO_SLOTS, type PhotoSlot } from '@barber/shared';
import type { LocalImage, VisitPhoto } from './photos';
import type { DeliveryStatus } from './upload-queue';
import type { SlotUploads } from './uploads';

// Waiting: the shot is queued on the device and goes up when the network
// lets it. Failed: the shot could not even be queued.
export type SlotStatus = 'empty' | 'uploading' | 'waiting' | 'uploaded' | 'failed';

export interface SlotState {
  status: SlotStatus;
  // The shot on the device, kept for a retry; for a photo uploaded earlier,
  // its signed URL. Null when there is nothing to show.
  image: LocalImage | null;
}

export type PhotoSlots = Record<PhotoSlot, SlotState>;

// A visit needs its front photo; the other angles are optional.
export const REQUIRED_SLOT: PhotoSlot = 'front';

export type SlotEvent =
  | { type: 'loaded'; photos: VisitPhoto[] }
  | { type: 'started'; slot: PhotoSlot; image: LocalImage }
  | { type: 'queue'; uploads: SlotUploads }
  | { type: 'failed'; slot: PhotoSlot };

export function emptySlots(): PhotoSlots {
  const empty: SlotState = { status: 'empty', image: null };
  return Object.fromEntries(PHOTO_SLOTS.map((slot) => [slot, empty])) as PhotoSlots;
}

// A resumed visit's uploaded photos fill slots the barber has not touched
// since the screen opened. A row left uploading has no shot on this device
// any more, so its slot shows empty and is shot again.
function loaded(slots: PhotoSlots, photos: VisitPhoto[]): PhotoSlots {
  const next = { ...slots };
  for (const photo of photos) {
    if (photo.uploadStatus !== 'uploaded' || next[photo.slot].status !== 'empty') continue;
    next[photo.slot] = {
      status: 'uploaded',
      image: photo.url ? { uri: photo.url, width: photo.width, height: photo.height } : null,
    };
  }
  return next;
}

const QUEUED_STATUS: Record<DeliveryStatus, SlotStatus> = {
  sending: 'uploading',
  waiting: 'waiting',
  sent: 'uploaded',
};

// The upload queue speaks for every slot it has a shot of, including one a
// closed app left queued.
function queued(slots: PhotoSlots, uploads: SlotUploads): PhotoSlots {
  const next = { ...slots };
  for (const slot of PHOTO_SLOTS) {
    const upload = uploads[slot];
    if (upload) next[slot] = { status: QUEUED_STATUS[upload.status], image: upload.image };
  }
  return next;
}

export function photoSlotsReducer(slots: PhotoSlots, event: SlotEvent): PhotoSlots {
  switch (event.type) {
    case 'loaded':
      return loaded(slots, event.photos);
    case 'started':
      return { ...slots, [event.slot]: { status: 'uploading', image: event.image } };
    case 'queue':
      return queued(slots, event.uploads);
    case 'failed':
      return { ...slots, [event.slot]: { ...slots[event.slot], status: 'failed' } };
  }
}

export function canContinue(slots: PhotoSlots): boolean {
  return slots[REQUIRED_SLOT].status === 'uploaded';
}
