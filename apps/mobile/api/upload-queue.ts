import type { PhotoSlot } from '@barber/shared';
import type { LocalImage, PhotoUpload } from './photos';

// A visit as the device opens it: its id is generated on the device and its
// consent is timed when the box was ticked, so a visit sent late is still the
// visit the barber started.
export interface QueuedVisit {
  id: string;
  clientId: string;
  consentGiven: true;
  consentAt: string;
}

// One write the device owes the server. A photo's take names its object, so
// sending the same take twice writes one photo.
export type Upload =
  | { kind: 'visit'; visit: QueuedVisit }
  | { kind: 'photo'; shot: PhotoUpload; take: string }
  | { kind: 'after'; visitId: string; shot: LocalImage };

// Everything the queue sends over the network. A send that rejects is tried
// again later; sending an upload twice must leave the server as sending it once.
export interface UploadTransport {
  send(upload: Upload): Promise<void>;
}

// The two calls of AsyncStorage the queue needs.
export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// Sending: added this session and not yet failed. Waiting: an attempt failed,
// or the app closed before it was sent, and a retry is due. Sent: on the server.
export type DeliveryStatus = 'sending' | 'waiting' | 'sent';

export interface DeliveryProgress {
  upload: Upload;
  status: DeliveryStatus;
}

export interface QueueState {
  // What is still owed, oldest first.
  pending: Upload[];
  // The latest upload of each key this session, and of each key still owed.
  progress: ReadonlyMap<string, DeliveryProgress>;
  // The last attempt failed and nothing has been sent since.
  offline: boolean;
}

export interface Delivery {
  // Resolves once this upload, or a later one of the same key, is sent.
  sent: Promise<void>;
}

interface Item {
  upload: Upload;
  attempts: number;
}

export const QUEUE_STORAGE_KEY = 'barber.upload-queue';
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

// Two uploads of one key are the same write: the later one replaces the
// earlier while it waits.
export function uploadKey(upload: Upload): string {
  switch (upload.kind) {
    case 'visit':
      return `visit:${upload.visit.id}`;
    case 'photo':
      return photoKey(upload.shot.visitId, upload.shot.slot);
    case 'after':
      return `after:${upload.visitId}`;
  }
}

export function photoKey(visitId: string, slot: PhotoSlot): string {
  return `photo:${visitId}:${slot}`;
}

// A persistent queue of uploads, sent one at a time in the order they were
// added, so a visit reaches the server before its photos. The queue is kept
// in storage after every change: a fresh queue on the same storage, as after
// the app is killed, picks up where the last one stopped. A failed send is
// retried after a delay that doubles from `baseDelayMs` up to `maxDelayMs`,
// until it succeeds.
export function uploadQueue({
  storage,
  transport,
  baseDelayMs = BASE_DELAY_MS,
  maxDelayMs = MAX_DELAY_MS,
  storageKey = QUEUE_STORAGE_KEY,
}: {
  storage: QueueStorage;
  transport: UploadTransport;
  baseDelayMs?: number;
  maxDelayMs?: number;
  storageKey?: string;
}) {
  let items: Item[] = [];
  const progress = new Map<string, DeliveryProgress>();
  const waiters = new Map<string, (() => void)[]>();
  const listeners = new Set<(state: QueueState) => void>();
  let offline = false;
  let failures = 0;
  let inFlight: Item | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let loaded: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();

  function state(): QueueState {
    return { pending: items.map((item) => item.upload), progress: new Map(progress), offline };
  }

  function emit() {
    const snapshot = state();
    for (const listener of listeners) listener(snapshot);
  }

  // Writes are chained so the last one stored is the latest queue.
  function persist(): Promise<void> {
    writes = writes
      .then(() => storage.setItem(storageKey, JSON.stringify(items.map((item) => item.upload))))
      .catch(() => undefined);
    return writes;
  }

  // Storage that cannot be read, or holds what is not a queue, starts the
  // queue empty rather than refusing every upload after it.
  function load(): Promise<void> {
    loaded ??= storage
      .getItem(storageKey)
      .then((raw) => {
        const stored: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(stored)) return;
        items = stored.map((upload: Upload) => ({ upload, attempts: 0 }));
        for (const { upload } of items) progress.set(uploadKey(upload), { upload, status: 'waiting' });
        if (items.length > 0) emit();
      })
      .catch(() => undefined);
    return loaded;
  }

  function schedule() {
    const delay = Math.min(baseDelayMs * 2 ** (failures - 1), maxDelayMs);
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  function delivered(item: Item) {
    const key = uploadKey(item.upload);
    items = items.filter((other) => other !== item);
    // A newer upload of the key is still owed; its progress stands.
    if (items.some((other) => uploadKey(other.upload) === key)) return;
    progress.set(key, { upload: item.upload, status: 'sent' });
    for (const resolve of waiters.get(key) ?? []) resolve();
    waiters.delete(key);
  }

  async function drain() {
    if (inFlight || stopped) return;
    while (items.length > 0 && !stopped) {
      const item = items[0]!;
      inFlight = item;
      try {
        await transport.send(item.upload);
      } catch {
        inFlight = null;
        item.attempts += 1;
        failures += 1;
        offline = true;
        const key = uploadKey(item.upload);
        if (progress.get(key)?.upload === item.upload) progress.set(key, { upload: item.upload, status: 'waiting' });
        emit();
        if (!stopped) schedule();
        return;
      }
      inFlight = null;
      failures = 0;
      offline = false;
      delivered(item);
      await persist();
      emit();
    }
  }

  // Sends now whatever is owed, cutting short a retry delay.
  function wake() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = null;
    void drain();
  }

  return {
    // Reads the queue left in storage and starts sending it.
    async start(): Promise<void> {
      await load();
      wake();
    },

    // Queues the upload, in place of one of the same key still waiting, and
    // resolves once it is in storage.
    async add(upload: Upload): Promise<Delivery> {
      await load();
      const key = uploadKey(upload);
      items = items.filter((item) => item === inFlight || uploadKey(item.upload) !== key);
      items.push({ upload, attempts: 0 });
      progress.set(key, { upload, status: 'sending' });
      const sent = new Promise<void>((resolve) => waiters.set(key, [...(waiters.get(key) ?? []), resolve]));
      emit();
      await persist();
      wake();
      return { sent };
    },

    wake,

    // Calls the listener with the queue now and after every change.
    subscribe(listener: (state: QueueState) => void): () => void {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },

    // Stops sending, as a killed app does; what is owed stays in storage.
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type UploadQueue = ReturnType<typeof uploadQueue>;
