import type { Preview } from '@barber/shared';
import {
  PREVIEW_POLL_MS,
  PREVIEW_RESIGN_MS,
  type PreviewsTransport,
  previewFeed,
  type VisitPreview,
} from '@/api/previews';

function preview(overrides: Partial<Preview> = {}): Preview {
  return {
    id: 'pv1',
    visitId: 'v1',
    hairStyleId: 'h-fade',
    beardStyleId: 'b-keep',
    slot: 'front',
    status: 'pending',
    attemptCount: 0,
    priority: 20,
    notBefore: '2026-10-22T14:00:00.000Z',
    storagePath: null,
    thumbnailPath: null,
    error: null,
    claimedAt: null,
    completedAt: null,
    purgedAt: null,
    createdAt: '2026-10-22T14:00:00.000Z',
    ...overrides,
  };
}

// One visit's previews on a network the test drives: the rows the database
// holds, every read of them, and the Realtime channel's events and health.
function fakeNetwork(initial: Preview[] = []) {
  let rows = initial;
  let reads = 0;
  let failing = 0;
  let signed: string[] = [];
  let change: () => void = () => undefined;
  let health: (healthy: boolean) => void = () => undefined;
  let listening = false;

  const transport: PreviewsTransport = {
    async list(visitId) {
      reads += 1;
      if (failing > 0) {
        failing -= 1;
        throw new Error('Network request failed');
      }
      return rows.filter((row) => row.visitId === visitId);
    },
    async sign(paths) {
      signed = [...signed, ...paths];
      return new Map(paths.map((path) => [path, `https://signed.test/${path}`]));
    },
    listen(_visitId, onChange, onHealth) {
      listening = true;
      change = onChange;
      health = onHealth;
      return () => {
        listening = false;
      };
    },
  };

  return {
    transport,
    reads: () => reads,
    signed: () => signed,
    listening: () => listening,
    set: (next: Preview[]) => {
      rows = next;
    },
    failNext: (count: number) => {
      failing = count;
    },
    emitChange: () => change(),
    report: (healthy: boolean) => health(healthy),
  };
}

// Lets the feed's pending reads and signing settle.
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('the previews feed', () => {
  it('emits the visit previews on subscribe and again on every change, with done rows signed', async () => {
    const network = fakeNetwork([preview()]);
    const seen: VisitPreview[][] = [];
    previewFeed(network.transport)('v1', (previews) => seen.push(previews));
    await settle();

    expect(seen.at(-1)).toEqual([expect.objectContaining({ id: 'pv1', status: 'pending', thumbnailUrl: null })]);

    network.set([
      preview({
        status: 'done',
        storagePath: 's1/v1/pv1.jpg',
        thumbnailPath: 's1/v1/pv1.thumb.jpg',
      }),
    ]);
    network.emitChange();
    await settle();

    expect(seen.at(-1)).toEqual([
      expect.objectContaining({
        id: 'pv1',
        status: 'done',
        thumbnailUrl: 'https://signed.test/s1/v1/pv1.thumb.jpg',
        imageUrl: 'https://signed.test/s1/v1/pv1.jpg',
      }),
    ]);
  });

  it('signs a done row once however often it is read', async () => {
    const network = fakeNetwork([
      preview({ status: 'done', storagePath: 's1/v1/pv1.jpg', thumbnailPath: 's1/v1/pv1.thumb.jpg' }),
    ]);
    previewFeed(network.transport)('v1', () => undefined);
    await settle();
    network.emitChange();
    await settle();

    expect(network.reads()).toBe(2);
    expect(network.signed()).toEqual(['s1/v1/pv1.thumb.jpg', 's1/v1/pv1.jpg']);
  });

  it('signs a done row again before its URL expires, on a picker left open', async () => {
    const network = fakeNetwork([
      preview({ status: 'done', storagePath: 's1/v1/pv1.jpg', thumbnailPath: 's1/v1/pv1.thumb.jpg' }),
    ]);
    const seen: VisitPreview[][] = [];
    previewFeed(network.transport)('v1', (previews) => seen.push(previews));
    await settle();
    network.report(true);
    await settle();

    await jest.advanceTimersByTimeAsync(PREVIEW_RESIGN_MS);
    await settle();

    expect(network.signed()).toEqual([
      's1/v1/pv1.thumb.jpg',
      's1/v1/pv1.jpg',
      's1/v1/pv1.thumb.jpg',
      's1/v1/pv1.jpg',
    ]);
    expect(seen.at(-1)?.[0]?.imageUrl).toBe('https://signed.test/s1/v1/pv1.jpg');
  });

  it('reads again after a failed read while the subscription stays healthy', async () => {
    const network = fakeNetwork([preview({ status: 'done', storagePath: 's1/v1/pv1.jpg', thumbnailPath: null })]);
    const seen: VisitPreview[][] = [];
    network.failNext(2);
    previewFeed(network.transport)('v1', (previews) => seen.push(previews));
    await settle();
    network.report(true);
    await settle();
    expect(seen).toEqual([]);

    await jest.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('done');
  });

  it('polls every five seconds while the subscription reports an error and stops once it recovers', async () => {
    const network = fakeNetwork([preview()]);
    const seen: VisitPreview[][] = [];
    previewFeed(network.transport)('v1', (previews) => seen.push(previews));
    network.report(true);
    await settle();
    const healthyReads = network.reads();

    jest.advanceTimersByTime(PREVIEW_POLL_MS * 3);
    await settle();
    expect(PREVIEW_POLL_MS).toBe(5000);
    expect(network.reads()).toBe(healthyReads);

    network.report(false);
    network.set([preview({ status: 'done', thumbnailPath: 's1/v1/pv1.thumb.jpg', storagePath: 's1/v1/pv1.jpg' })]);
    jest.advanceTimersByTime(PREVIEW_POLL_MS);
    await settle();
    expect(network.reads()).toBe(healthyReads + 1);
    expect(seen.at(-1)).toEqual([expect.objectContaining({ status: 'done' })]);

    jest.advanceTimersByTime(PREVIEW_POLL_MS * 2);
    await settle();
    expect(network.reads()).toBe(healthyReads + 3);

    // Recovering reads once to catch what the channel missed, then stops polling.
    network.report(true);
    await settle();
    const recoveredReads = network.reads();
    expect(recoveredReads).toBe(healthyReads + 4);
    jest.advanceTimersByTime(PREVIEW_POLL_MS * 3);
    await settle();
    expect(network.reads()).toBe(recoveredReads);
  });

  it('stops listening, polling and emitting once unsubscribed', async () => {
    const network = fakeNetwork([preview()]);
    const seen: VisitPreview[][] = [];
    const unsubscribe = previewFeed(network.transport)('v1', (previews) => seen.push(previews));
    network.report(false);
    await settle();
    const emitted = seen.length;

    unsubscribe();
    // Removing the channel closes it, which Realtime reports as unhealthy.
    network.report(false);
    jest.advanceTimersByTime(PREVIEW_POLL_MS * 3);
    await settle();

    expect(network.listening()).toBe(false);
    expect(seen.length).toBe(emitted);
  });
});
