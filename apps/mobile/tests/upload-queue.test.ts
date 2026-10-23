import {
  photoKey,
  type QueueState,
  type QueueStorage,
  type Upload,
  type UploadTransport,
  uploadQueue,
} from '@/api/upload-queue';

// Device storage that outlives any one queue, as AsyncStorage outlives the app.
function fakeStorage(): QueueStorage {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
  };
}

// The network the queue sends to: every upload it receives, in order, and a
// switch that drops the connection.
function fakeTransport() {
  const received: Upload[] = [];
  const attempts: number[] = [];
  let down = false;
  let failures = 0;

  const transport: UploadTransport = {
    async send(upload) {
      attempts.push(Date.now());
      if (down) throw new Error('Network request failed');
      if (failures > 0) {
        failures -= 1;
        throw new Error('Network request failed');
      }
      received.push(upload);
    },
  };

  return {
    transport,
    received,
    attempts,
    goDown: () => {
      down = true;
    },
    comeBack: () => {
      down = false;
    },
    failNext: (count: number) => {
      failures = count;
    },
  };
}

// The barber signed in on the device.
const signedIn = async () => 'b1';

const frontShot: Upload = {
  kind: 'photo',
  shot: { visitId: 'v1', slot: 'front', uri: 'file:///camera/front.jpg', width: 3024, height: 4032 },
  take: 'take1',
};

const sideShot: Upload = {
  kind: 'photo',
  shot: { visitId: 'v1', slot: 'left', uri: 'file:///camera/left.jpg', width: 3024, height: 4032 },
  take: 'take1',
};

// Lets pending promises, storage writes and sends included, settle.
async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-22T14:00:00.000Z') }));
afterEach(() => jest.useRealTimers());

describe('the upload queue', () => {
  it('delivers an upload that fails twice then succeeds once, waiting longer before each retry', async () => {
    const network = fakeTransport();
    network.failNext(2);
    const queue = uploadQueue({ owner: signedIn, storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });

    await queue.add(frontShot);
    await settle();
    expect(network.attempts).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(999);
    expect(network.attempts).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(network.attempts).toHaveLength(2);

    // The second retry waits twice as long as the first.
    await jest.advanceTimersByTimeAsync(1999);
    expect(network.attempts).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(network.attempts).toHaveLength(3);

    expect(network.received).toEqual([frontShot]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(network.received).toEqual([frontShot]);
    expect(network.attempts).toHaveLength(3);
  });

  it('resumes what a killed app left in storage from a fresh queue', async () => {
    const storage = fakeStorage();
    const network = fakeTransport();
    network.goDown();
    const killed = uploadQueue({ owner: signedIn, storage, transport: network.transport });
    await killed.add(frontShot);
    await settle();
    killed.stop();
    expect(network.received).toEqual([]);

    network.comeBack();
    const restarted = uploadQueue({ owner: signedIn, storage, transport: network.transport });
    const seen: string[] = [];
    restarted.subscribe((state) => {
      const front = state.progress.get('photo:v1:front');
      if (front) seen.push(front.status);
    });
    await restarted.start();
    await settle();

    expect(network.received).toEqual([frontShot]);
    expect(seen).toEqual(['waiting', 'sent']);

    // Sent means gone from storage: the next launch sends nothing.
    const next = fakeTransport();
    const relaunched = uploadQueue({ owner: signedIn, storage, transport: next.transport });
    await relaunched.start();
    await settle();
    expect(next.attempts).toEqual([]);
  });

  it('sends a visit started while the network is down once, with its device id, when the network returns', async () => {
    const network = fakeTransport();
    network.goDown();
    const queue = uploadQueue({ owner: signedIn, storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });
    const visit: Upload = {
      kind: 'visit',
      visit: { id: 'device-visit-1', clientId: 'c1', consentGiven: true, consentAt: '2026-10-22T14:00:00.000Z' },
    };

    const { sent } = await queue.add(visit);
    // The barber shoots the front while the visit is still owed.
    await queue.add(frontShot);
    let delivered = false;
    void sent.then(() => (delivered = true));
    await jest.advanceTimersByTimeAsync(7000);
    expect(network.attempts.length).toBeGreaterThan(1);
    expect(network.received).toEqual([]);
    expect(delivered).toBe(false);

    network.comeBack();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(network.received).toEqual([visit, frontShot]);
    expect(delivered).toBe(true);
  });

  it('reports itself offline while a send is failing, with what it still owes', async () => {
    const network = fakeTransport();
    network.goDown();
    const queue = uploadQueue({ owner: signedIn, storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });
    const states: { offline: boolean; pending: number }[] = [];
    queue.subscribe((state) => states.push({ offline: state.offline, pending: state.pending.length }));

    await queue.add(frontShot);
    await settle();
    expect(states.at(-1)).toEqual({ offline: true, pending: 1 });

    network.comeBack();
    await jest.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toEqual({ offline: false, pending: 0 });
  });

  it('starts empty over storage it cannot read, and still queues', async () => {
    const storage = fakeStorage();
    await storage.setItem('barber.upload-queue', '{not json');
    const network = fakeTransport();
    const queue = uploadQueue({ owner: signedIn, storage, transport: network.transport });

    await queue.start();
    await queue.add(frontShot);
    await settle();

    expect(network.received).toEqual([frontShot]);
  });

  it('replaces a waiting take of a slot with the retake, and sends only the retake', async () => {
    const network = fakeTransport();
    network.goDown();
    const queue = uploadQueue({ owner: signedIn, storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });
    const retake: Upload = { ...frontShot, take: 'take2' } as Upload;

    await queue.add(frontShot);
    await settle();
    await queue.add(retake);
    network.comeBack();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(network.received).toEqual([retake]);
  });

  it('sets aside an upload the server refuses for good, and sends the ones behind it', async () => {
    class Refused extends Error {}
    const received: Upload[] = [];
    const transport: UploadTransport = {
      async send(upload) {
        if (upload === frontShot) throw new Refused('row-level security');
        received.push(upload);
      },
    };
    const queue = uploadQueue({
      owner: signedIn,
      storage: fakeStorage(),
      transport,
      isPermanent: (error) => error instanceof Refused,
    });
    const states: QueueState[] = [];
    queue.subscribe((state) => states.push(state));

    const refused = await queue.add(frontShot);
    const outcome = refused.sent.then(
      () => 'sent',
      (error: unknown) => error,
    );
    await queue.add(sideShot);
    await settle();

    expect(received).toEqual([sideShot]);
    expect(await outcome).toBeInstanceOf(Refused);
    const last = states.at(-1)!;
    expect(last.pending).toEqual([]);
    expect(last.offline).toBe(false);
    expect(last.progress.get(photoKey('v1', 'front'))?.status).toBe('failed');
  });

  it('sends an upload only while the barber who made it is signed in', async () => {
    let me: string | null = 'b1';
    const network = fakeTransport();
    network.goDown();
    const queue = uploadQueue({ owner: async () => me, storage: fakeStorage(), transport: network.transport });

    await queue.add(frontShot);
    await settle();
    me = 'b2';
    network.comeBack();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(network.received).toEqual([]);

    await queue.add(sideShot);
    await settle();
    expect(network.received).toEqual([sideShot]);

    me = 'b1';
    queue.wake();
    await settle();
    expect(network.received).toEqual([sideShot, frontShot]);
  });

  it('never sends an upload twice when woken while it stores its progress', async () => {
    const values = new Map<string, string>();
    let storing: Promise<void> | null = null;
    let stored = () => undefined as void;
    const storage: QueueStorage = {
      async getItem(key) {
        return values.get(key) ?? null;
      },
      async setItem(key, value) {
        if (storing) await storing;
        values.set(key, value);
      },
    };
    // The side shot's send is slow, so a second drain would still be sending it.
    let offline = true;
    let sideSent = () => undefined as void;
    const sideSending = new Promise<void>((resolve) => {
      sideSent = resolve;
    });
    const received: Upload[] = [];
    const transport: UploadTransport = {
      async send(upload) {
        if (offline) throw new Error('Network request failed');
        if (upload === sideShot) await sideSending;
        received.push(upload);
      },
    };
    const queue = uploadQueue({ owner: signedIn, storage, transport });
    await queue.add(frontShot);
    await queue.add(sideShot);
    await settle();

    storing = new Promise((resolve) => {
      stored = resolve;
    });
    offline = false;
    queue.wake();
    await settle();
    expect(received).toEqual([frontShot]);
    // Woken again while the first drain waits on storage.
    queue.wake();
    await settle();
    stored();
    await settle();
    sideSent();
    await settle();

    expect(received).toEqual([frontShot, sideShot]);
  });

  it('rejects an upload storage cannot keep, and leaves the queue as it was', async () => {
    const storage: QueueStorage = {
      async getItem() {
        return null;
      },
      async setItem() {
        throw new Error('disk full');
      },
    };
    const network = fakeTransport();
    const queue = uploadQueue({ owner: signedIn, storage, transport: network.transport });
    const states: QueueState[] = [];
    queue.subscribe((state) => states.push(state));

    await expect(queue.add(frontShot)).rejects.toThrow('disk full');
    await settle();

    expect(network.received).toEqual([]);
    expect(states.at(-1)!.pending).toEqual([]);
    expect(states.at(-1)!.progress.size).toBe(0);
  });
});
