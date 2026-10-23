import AsyncStorage from '@react-native-async-storage/async-storage';
import { PHOTO_SLOTS, type PhotoSlot, type Visit } from '@barber/shared';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';
import { reportLink, reportQueued } from './connectivity';
import { type LocalImage, type PhotoUpload, sendAfterPhoto, sendPhoto } from './photos';
import type { Unsubscribe } from './previews';
import { isPermanentUploadError, MissingShotError } from './upload-errors';
import { supabase } from './supabase';
import { type QueueState, type Upload, type DeliveryProgress, type UploadQueue, photoKey, uploadQueue } from './upload-queue';
import { createVisit, getVisit, type NewVisit } from './visits';

export type { DeliveryProgress, DeliveryStatus } from './upload-queue';

// Queued shots wait in the app's documents, which the system never clears;
// the picker leaves its file in a cache the system may empty first.
function shotsDirectory(): Directory {
  return new Directory(Paths.document, 'upload-queue');
}

async function keepShot<T extends LocalImage>(shot: T): Promise<T> {
  const folder = shotsDirectory();
  folder.create({ idempotent: true, intermediates: true });
  const copy = new File(folder, `${randomUUID()}.jpg`);
  await new File(shot.uri).copy(copy);
  return { ...shot, uri: copy.uri };
}

// Removes the kept shots no queued upload names any more: sent, replaced by a
// retake or set aside in an earlier session.
function sweepShots(pending: Upload[]) {
  const folder = shotsDirectory();
  if (!folder.exists) return;
  const named = new Set(pending.flatMap((upload) => (upload.kind === 'visit' ? [] : [upload.shot.uri])));
  for (const entry of folder.list()) {
    if (entry instanceof File && !named.has(entry.uri)) entry.delete();
  }
}

function present(shot: LocalImage) {
  if (shot.uri.startsWith('file:') && !new File(shot.uri).exists) {
    throw new MissingShotError(`the shot at ${shot.uri} is gone`);
  }
}

// The signed-in barber, whose uploads the queue sends.
async function signedInBarber(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

async function send(upload: Upload): Promise<void> {
  if (upload.kind !== 'visit') present(upload.shot);
  switch (upload.kind) {
    case 'visit':
      return createVisit(upload.visit);
    case 'photo':
      await sendPhoto(upload.shot, upload.take);
      return;
    case 'after':
      await sendAfterPhoto(upload.visitId, upload.shot, upload.take ?? Date.now().toString(36));
      return;
  }
}

let queue: UploadQueue | undefined;

// The app's one queue, created on first use so that importing the `api`
// module has no side effects.
function uploads(): UploadQueue {
  if (queue) return queue;
  const created = uploadQueue({
    storage: AsyncStorage,
    transport: { send },
    owner: signedInBarber,
    isPermanent: isPermanentUploadError,
  });
  created.subscribe((state) => {
    reportLink('uploads', !state.offline);
    reportQueued(state.pending.length);
  });
  queue = created;
  return created;
}

// Sends what the app owed when it last closed, and tries again whenever the
// app comes back to the foreground or a barber signs in. The root layout
// calls it once.
export function resumeUploads(): Unsubscribe {
  const queue = uploads();
  void queue.start().then(() => {
    const stop = queue.subscribe((state) => {
      try {
        sweepShots(state.pending);
      } catch {
        // A file that cannot be listed or deleted waits for the next start.
      }
    });
    stop();
  });
  const listener = AppState.addEventListener('change', (state) => {
    if (state === 'active') queue.wake();
  });
  const auth = supabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') queue.wake();
  });
  return () => {
    listener.remove();
    auth.data.subscription.unsubscribe();
  };
}

// Opens the visit, queued: it resolves once the visit is safe on the device,
// and the visit reaches the server as soon as the network lets it, ahead of
// its photos.
export async function startVisit(input: NewVisit): Promise<void> {
  await uploads().add({ kind: 'visit', visit: { ...input, consentAt: new Date().toISOString() } });
}

// Queues one slot's shot; it resolves once the shot is safe on the device.
// `subscribeToUploads` follows it to the server.
export async function uploadPhoto(shot: PhotoUpload): Promise<void> {
  await uploads().add({ kind: 'photo', shot: await keepShot(shot), take: Date.now().toString(36) });
}

// Queues the visit's after photo and resolves with the visit once the photo
// is recorded on it, however long the network takes.
export async function uploadAfterPhoto(visitId: string, shot: LocalImage): Promise<Visit> {
  const { sent } = await uploads().add({
    kind: 'after',
    visitId,
    shot: await keepShot(shot),
    take: Date.now().toString(36),
  });
  await sent;
  return getVisit(visitId);
}

// The progress of each slot of the visit with an upload this session or one
// still owed, now and each time one changes. A sent slot carries the shot the
// device took.
export type SlotUploads = Partial<Record<PhotoSlot, DeliveryProgress & { image: LocalImage }>>;

function slotUploads(state: QueueState, visitId: string): SlotUploads {
  const slots: SlotUploads = {};
  for (const slot of PHOTO_SLOTS) {
    const progress = state.progress.get(photoKey(visitId, slot));
    if (progress?.upload.kind !== 'photo') continue;
    const { uri, width, height } = progress.upload.shot;
    slots[slot] = { ...progress, image: { uri, width, height } };
  }
  return slots;
}

export function subscribeToUploads(visitId: string, onChange: (slots: SlotUploads) => void): Unsubscribe {
  return uploads().subscribe((state) => onChange(slotUploads(state, visitId)));
}
