import { type QueueStorage, type Upload, type UploadTransport, uploadQueue } from '@/api/upload-queue';

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

const frontShot: Upload = {
  kind: 'photo',
  shot: { visitId: 'v1', slot: 'front', uri: 'file:///camera/front.jpg', width: 3024, height: 4032 },
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
    const queue = uploadQueue({ storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });

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
    const killed = uploadQueue({ storage, transport: network.transport });
    await killed.add(frontShot);
    await settle();
    killed.stop();
    expect(network.received).toEqual([]);

    network.comeBack();
    const restarted = uploadQueue({ storage, transport: network.transport });
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
    const relaunched = uploadQueue({ storage, transport: next.transport });
    await relaunched.start();
    await settle();
    expect(next.attempts).toEqual([]);
  });

  it('sends a visit started while the network is down once, with its device id, when the network returns', async () => {
    const network = fakeTransport();
    network.goDown();
    const queue = uploadQueue({ storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });
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
    const queue = uploadQueue({ storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });
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
    const queue = uploadQueue({ storage, transport: network.transport });

    await queue.start();
    await queue.add(frontShot);
    await settle();

    expect(network.received).toEqual([frontShot]);
  });

  it('replaces a waiting take of a slot with the retake, and sends only the retake', async () => {
    const network = fakeTransport();
    network.goDown();
    const queue = uploadQueue({ storage: fakeStorage(), transport: network.transport, baseDelayMs: 1000 });
    const retake: Upload = { ...frontShot, take: 'take2' } as Upload;

    await queue.add(frontShot);
    await settle();
    await queue.add(retake);
    network.comeBack();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(network.received).toEqual([retake]);
  });
});
