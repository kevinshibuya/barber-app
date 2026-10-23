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
// again later, unless the queue's `isPermanent` says no retry can succeed;
// sending an upload twice must leave the server as sending it once.
export interface UploadTransport {
  send(upload: Upload): Promise<void>;
}

// The two calls of AsyncStorage the queue needs.
export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// Sending: added this session and not yet failed. Waiting: an attempt failed,
// or the app closed before it was sent, and a retry is due. Sent: on the
// server. Failed: the server refused it in a way no retry changes, so it was
// set aside.
export type DeliveryStatus = 'sending' | 'waiting' | 'sent' | 'failed';

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
  // Resolves once this upload, or a later one of the same key, is sent;
  // rejects if it fails for good.
  sent: Promise<void>;
}

// Each upload belongs to the barber who made it: it is sent only while that
// barber is signed in, so it is recorded as theirs and never under another
// shop. An upload stored before owners were kept has none and goes with
// whoever is signed in.
interface Item {
  upload: Upload;
  owner: string | null;
  attempts: number;
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
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
// until it succeeds; one `isPermanent` calls hopeless is set aside, and the
// uploads behind it go on. `owner` names the signed-in barber, whose uploads
// alone are sent.
export function uploadQueue({
  storage,
  transport,
  owner,
  isPermanent = () => false,
  baseDelayMs = BASE_DELAY_MS,
  maxDelayMs = MAX_DELAY_MS,
  storageKey = QUEUE_STORAGE_KEY,
}: {
  storage: QueueStorage;
  transport: UploadTransport;
  owner: () => Promise<string | null>;
  isPermanent?: (error: unknown) => boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  storageKey?: string;
}) {
  let items: Item[] = [];
  const progress = new Map<string, DeliveryProgress>();
  const waiters = new Map<string, Waiter[]>();
  const listeners = new Set<(state: QueueState) => void>();
  let offline = false;
  let failures = 0;
  let inFlight: Item | null = null;
  // Held for a whole drain, its storage writes included, so two drains never
  // send at once.
  let draining = false;
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

  // Writes are chained so the last one stored is the latest queue. The
  // returned write rejects when storage refuses it; the chain goes on.
  function persist(): Promise<void> {
    const snapshot = JSON.stringify(items.map(({ upload, owner: by }) => ({ upload, owner: by })));
    const write = writes.then(() => storage.setItem(storageKey, snapshot));
    writes = write.catch(() => undefined);
    return write;
  }

  // Storage that cannot be read, or holds what is not a queue, starts the
  // queue empty rather than refusing every upload after it.
  function load(): Promise<void> {
    loaded ??= storage
      .getItem(storageKey)
      .then((raw) => {
        const stored: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(stored)) return;
        items = stored.map((entry: { upload: Upload; owner: string | null } | Upload) =>
          'kind' in entry ? { upload: entry, owner: null, attempts: 0 } : { ...entry, attempts: 0 },
        );
        for (const { upload } of items) progress.set(uploadKey(upload), { upload, status: 'waiting' });
        if (items.length > 0) emit();
      })
      .catch(() => undefined);
    return loaded;
  }

  function schedule(delay = Math.min(baseDelayMs * 2 ** (failures - 1), maxDelayMs)) {
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
    for (const waiter of waiters.get(key) ?? []) waiter.resolve();
    waiters.delete(key);
  }

  function setAside(item: Item, error: unknown) {
    const key = uploadKey(item.upload);
    items = items.filter((other) => other !== item);
    if (items.some((other) => uploadKey(other.upload) === key)) return;
    progress.set(key, { upload: item.upload, status: 'failed' });
    for (const waiter of waiters.get(key) ?? []) waiter.reject(error);
    waiters.delete(key);
  }

  async function drain() {
    if (draining || stopped) return;
    draining = true;
    try {
      const me = await owner();
      // No barber to send as, such as a session that cannot refresh offline:
      // look again later.
      if (me === null) {
        if (items.length > 0 && !stopped) schedule(maxDelayMs);
        return;
      }
      for (;;) {
        if (stopped) return;
        const item = items.find((candidate) => candidate.owner === null || candidate.owner === me);
        if (!item) return;
        inFlight = item;
        try {
          await transport.send(item.upload);
        } catch (error) {
          inFlight = null;
          if (isPermanent(error)) {
            setAside(item, error);
            await persist().catch(() => undefined);
            emit();
            continue;
          }
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
        await persist().catch(() => undefined);
        emit();
      }
    } finally {
      draining = false;
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

    // Queues the signed-in barber's upload, in place of one of the same key
    // still waiting, and resolves once it is in storage. Rejects, with the
    // queue as it was, when storage refuses it.
    async add(upload: Upload): Promise<Delivery> {
      const [by] = await Promise.all([owner(), load()]);
      const key = uploadKey(upload);
      const before = { items, progress: progress.get(key) };
      items = items.filter((item) => item === inFlight || uploadKey(item.upload) !== key);
      items.push({ upload, owner: by, attempts: 0 });
      progress.set(key, { upload, status: 'sending' });
      try {
        await persist();
      } catch (error) {
        items = before.items;
        if (before.progress) progress.set(key, before.progress);
        else progress.delete(key);
        emit();
        throw error;
      }
      const sent = new Promise<void>((resolve, reject) =>
        waiters.set(key, [...(waiters.get(key) ?? []), { resolve, reject }]),
      );
      emit();
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
