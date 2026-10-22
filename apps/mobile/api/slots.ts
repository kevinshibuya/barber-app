// The four photo slots of a visit as the slots screen shows them. Pure state
// with no network, so screens import this file directly and screen tests keep
// it real while the rest of the `api` module is mocked.
import { PHOTO_SLOTS, type PhotoSlot } from '@barber/shared';
import type { LocalImage, VisitPhoto } from './photos';

export type SlotStatus = 'empty' | 'uploading' | 'uploaded' | 'failed';

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
  | { type: 'uploaded'; slot: PhotoSlot }
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

export function photoSlotsReducer(slots: PhotoSlots, event: SlotEvent): PhotoSlots {
  switch (event.type) {
    case 'loaded':
      return loaded(slots, event.photos);
    case 'started':
      return { ...slots, [event.slot]: { status: 'uploading', image: event.image } };
    case 'uploaded':
    case 'failed':
      return { ...slots, [event.slot]: { ...slots[event.slot], status: event.type } };
  }
}

export function canContinue(slots: PhotoSlots): boolean {
  return slots[REQUIRED_SLOT].status === 'uploaded';
}
