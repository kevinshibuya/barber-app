// The worker's preview queue consumer, run as the real loop against the local
// Supabase with the fake provider. `claim_previews` claims across every shop,
// so each test runs in a shop of its own that is deleted before the next one.
import sharp from 'sharp';
import {
  KEEP_STYLE_SLUG,
  originalPhotoPath,
  previewImagePath,
  previewThumbnailPath,
  STORAGE_BUCKETS,
  type PreviewRow,
  type Tables,
} from '@barber/shared';
import { readPreviewWorkerConfig } from '../src/previews/config';
import { FakeImageProvider } from '../src/previews/fake-provider';
import { PreviewWorker, type PreviewOutcomeLine, type PreviewWorkerOptions } from '../src/previews/preview-worker';
import { createImageProvider } from '../src/previews/providers';
import { createTestShop, deleteTestShop, must, serviceClient, type TestShop } from './support/supabase';

jest.setTimeout(60_000);

const service = serviceClient();
let shop: TestShop;
let styles: Tables<'styles'>[];
// Placeholder reference images this file uploaded, removed after the file.
const uploadedReferences: string[] = [];

async function solidJpeg(width: number, height: number, background: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
}

beforeAll(async () => {
  styles = must(await service.from('styles').select('*').eq('active', true).order('sort_order'));
  const placeholder = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#2a6' },
  })
    .png()
    .toBuffer();
  for (const style of styles) {
    if (!style.reference_image_path) continue;
    // A real reference image already in the bucket is left alone.
    const { error } = await service.storage
      .from(STORAGE_BUCKETS.styles)
      .upload(style.reference_image_path, placeholder, { contentType: 'image/png', upsert: false });
    if (!error) uploadedReferences.push(style.reference_image_path);
  }
});

afterAll(async () => {
  if (uploadedReferences.length > 0) {
    await service.storage.from(STORAGE_BUCKETS.styles).remove(uploadedReferences);
  }
});

beforeEach(async () => {
  shop = await createTestShop(service);
});

afterEach(async () => {
  await deleteTestShop(service, shop, [STORAGE_BUCKETS.originals, STORAGE_BUCKETS.previews]);
});

function style(dimension: 'hair' | 'beard', slug: string): Tables<'styles'> {
  const found = styles.find((s) => s.dimension === dimension && s.slug === slug);
  if (!found) throw new Error(`no ${dimension} style ${slug}`);
  return found;
}

const keep = (dimension: 'hair' | 'beard') => style(dimension, KEEP_STYLE_SLUG).id;

// A visit whose front photo is uploaded: the trigger enqueues its 17 previews.
async function visitWithFront() {
  const client = must(
    await service.from('clients').insert({ shop_id: shop.id, name: 'Worker client' }).select().single(),
  );
  const visit = must(
    await service
      .from('visits')
      .insert({ shop_id: shop.id, client_id: client.id, barber_id: shop.barberId })
      .select()
      .single(),
  );
  const path = originalPhotoPath(shop.id, visit.id, 'front');
  const original = await solidJpeg(600, 800, '#c33');
  must(
    await service.storage
      .from(STORAGE_BUCKETS.originals)
      .upload(path, original, { contentType: 'image/jpeg', upsert: true }),
  );
  must(
    await service
      .from('photos')
      .insert({ visit_id: visit.id, slot: 'front', storage_path: path, width: 600, height: 800, upload_status: 'uploaded' })
      .select()
      .single(),
  );
  return { visit, original };
}

async function previewsOf(visitId: string): Promise<PreviewRow[]> {
  return must(
    await service
      .from('previews')
      .select('*')
      .eq('visit_id', visitId)
      .order('priority', { ascending: false })
      .order('created_at')
      .order('id'),
  );
}

const SETTLED = ['done', 'failed', 'refused'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until every preview of the visit has settled, and returns them.
async function settled(visitId: string, timeoutMs = 45_000): Promise<PreviewRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await previewsOf(visitId);
    if (rows.length > 0 && rows.every((r) => SETTLED.includes(r.status))) return rows;
    if (Date.now() > deadline) {
      throw new Error(`previews not settled: ${rows.map((r) => r.status).join(', ')}`);
    }
    await sleep(100);
  }
}

interface Run {
  provider: FakeImageProvider;
  logs: PreviewOutcomeLine[];
  worker: PreviewWorker;
}

const running: PreviewWorker[] = [];

function startWorker(options: Partial<PreviewWorkerOptions> = {}, provider = new FakeImageProvider()): Run {
  const logs: PreviewOutcomeLine[] = [];
  const worker = new PreviewWorker({
    db: service,
    provider,
    intervalMs: 50,
    retryBaseMs: 200,
    log: (line) => logs.push(line),
    ...options,
  });
  running.push(worker);
  worker.start();
  return { provider, logs, worker };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((worker) => worker.stop()));
});

async function download(bucket: string, path: string): Promise<Buffer> {
  const blob = must(await service.storage.from(bucket).download(path));
  return Buffer.from(await blob.arrayBuffer());
}

const mine = (logs: PreviewOutcomeLine[], visitId: string) => logs.filter((l) => l.visitId === visitId);

describe('the preview queue consumer', () => {
  it('renders a visit\'s 17 front previews with an image and a thumbnail each, hair before beard', async () => {
    const { visit } = await visitWithFront();
    const run = startWorker();

    const rows = await settled(visit.id);

    expect(rows).toHaveLength(17);
    expect(rows.every((r) => r.status === 'done' && r.attempt_count === 1 && r.error === null)).toBe(true);
    for (const row of rows) {
      expect(row.storage_path).toBe(previewImagePath(shop.id, visit.id, row.id));
      expect(row.thumbnail_path).toBe(previewThumbnailPath(shop.id, visit.id, row.id));
    }
    const objects = must(await service.storage.from(STORAGE_BUCKETS.previews).list(`${shop.id}/${visit.id}`));
    expect(objects.map((o) => o.name).sort()).toEqual(
      rows.flatMap((r) => [`${r.id}.jpg`, `${r.id}.thumb.jpg`]).sort(),
    );

    // The fake's image is 768 by 1024: the thumbnail's long edge is 256.
    const image = await sharp(await download(STORAGE_BUCKETS.previews, rows[0]!.storage_path!)).metadata();
    expect([image.format, image.width, image.height]).toEqual(['jpeg', 768, 1024]);
    const thumbnail = await sharp(await download(STORAGE_BUCKETS.previews, rows[0]!.thumbnail_path!)).metadata();
    expect([thumbnail.format, thumbnail.width, thumbnail.height]).toEqual(['jpeg', 192, 256]);

    const hair = rows.filter((r) => r.beard_style_id === keep('beard'));
    const beard = rows.filter((r) => r.hair_style_id === keep('hair'));
    expect([hair.length, beard.length]).toEqual([12, 5]);
    const lastHair = Math.max(...hair.map((r) => Date.parse(r.completed_at!)));
    const firstBeard = Math.min(...beard.map((r) => Date.parse(r.completed_at!)));
    expect(lastHair).toBeLessThanOrEqual(firstBeard);

    const updated = must(await service.from('visits').select('provider_name').eq('id', visit.id).single());
    expect(updated.provider_name).toBe('fake');

    const lines = mine(run.logs, visit.id);
    expect(lines).toHaveLength(17);
    expect(lines.every((l) => l.outcome === 'done' && l.provider === 'fake')).toBe(true);
    expect(lines.map((l) => l.previewId).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('fails a row whose style keeps failing after three attempts with backoff between them, and renders the rest', async () => {
    const { visit } = await visitWithFront();
    const quiff = style('hair', 'quiff');
    const provider = new FakeImageProvider();
    provider.script(quiff.prompt!, 'retryable');
    const run = startWorker({ retryBaseMs: 300 }, provider);

    const rows = await settled(visit.id);

    const failing = rows.find((r) => r.hair_style_id === quiff.id)!;
    expect(failing.status).toBe('failed');
    expect(failing.attempt_count).toBe(3);
    expect(failing.error).toBe('fake provider: scripted retryable failure');
    const others = rows.filter((r) => r.id !== failing.id);
    expect(others.every((r) => r.status === 'done' && r.attempt_count === 1)).toBe(true);

    // 300 ms after the first attempt, then 600 ms after the second.
    const attempts = provider.calls.filter((c) => c.prompt === quiff.prompt).map((c) => c.at);
    expect(attempts).toHaveLength(3);
    expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(300);
    expect(attempts[2]! - attempts[1]!).toBeGreaterThanOrEqual(600);

    const lines = mine(run.logs, visit.id).filter((l) => l.previewId === failing.id);
    expect(lines.map((l) => [l.outcome, l.attempt])).toEqual([
      ['retry', 1],
      ['retry', 2],
      ['failed', 3],
    ]);
    expect(lines.every((l) => l.error === 'fake provider: scripted retryable failure')).toBe(true);
  });

  it('marks a row refused after one attempt when the provider refuses its style', async () => {
    const { visit } = await visitWithFront();
    const goatee = style('beard', 'goatee');
    const provider = new FakeImageProvider();
    provider.script(goatee.prompt!, 'refused');
    const run = startWorker({}, provider);

    const rows = await settled(visit.id);

    const refused = rows.find((r) => r.beard_style_id === goatee.id)!;
    expect([refused.status, refused.attempt_count, refused.error]).toEqual([
      'refused',
      1,
      'fake provider: refused on safety grounds',
    ]);
    expect(provider.calls.filter((c) => c.prompt === goatee.prompt)).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'done')).toHaveLength(16);
    expect(mine(run.logs, visit.id).filter((l) => l.previewId === refused.id).map((l) => l.outcome)).toEqual([
      'refused',
    ]);
  });

  it('renders a combination on its slot\'s hair-only preview, only once that base is done', async () => {
    const { visit, original } = await visitWithFront();
    const quiff = style('hair', 'quiff');
    const fullBeard = style('beard', 'full-beard');
    const combination = must(
      await shop.barber
        .rpc('request_preview', {
          visit_id: visit.id,
          hair_style_id: quiff.id,
          beard_style_id: fullBeard.id,
          slot: 'front',
        })
        .maybeSingle(),
    );
    const provider = new FakeImageProvider({ image: await solidJpeg(768, 1024, '#36c') });
    startWorker({}, provider);

    const rows = await settled(visit.id);

    expect(rows).toHaveLength(18);
    const done = rows.find((r) => r.id === combination.id)!;
    const base = rows.find((r) => r.hair_style_id === quiff.id && r.beard_style_id === keep('beard'))!;
    expect([done.status, base.status]).toEqual(['done', 'done']);
    expect(Date.parse(done.claimed_at!)).toBeGreaterThanOrEqual(Date.parse(base.completed_at!));

    // The full beard is rendered twice: alone on the photo, and on the quiff.
    const baseImage = await download(STORAGE_BUCKETS.previews, base.storage_path!);
    expect(baseImage.equals(original)).toBe(false);
    const fullBeardBases = provider.calls.filter((c) => c.prompt === fullBeard.prompt).map((c) => c.base);
    expect(fullBeardBases).toHaveLength(2);
    expect(fullBeardBases.filter((b) => b.equals(original))).toHaveLength(1);
    expect(fullBeardBases.filter((b) => b.equals(baseImage))).toHaveLength(1);
  });

  it('never renders a row twice with two workers of concurrency 2 on the same queue', async () => {
    const { visit } = await visitWithFront();
    const first = startWorker({ concurrency: 2 });
    const second = startWorker({ concurrency: 2 });

    const rows = await settled(visit.id);

    expect(rows).toHaveLength(17);
    expect(rows.every((r) => r.status === 'done' && r.attempt_count === 1)).toBe(true);
    const lines = [...mine(first.logs, visit.id), ...mine(second.logs, visit.id)];
    expect(lines.map((l) => l.previewId).sort()).toEqual(rows.map((r) => r.id).sort());
    expect(mine(first.logs, visit.id).length).toBeGreaterThan(0);
    expect(mine(second.logs, visit.id).length).toBeGreaterThan(0);
  });

  it('drops the completion of a row deleted while it rendered, and goes on', async () => {
    const { visit } = await visitWithFront();
    const slickBack = style('hair', 'slick-back');
    const provider = new FakeImageProvider({
      beforeAnswer: async (request) => {
        if (request.prompt !== slickBack.prompt) return;
        must(
          await service
            .from('previews')
            .delete()
            .eq('visit_id', visit.id)
            .eq('hair_style_id', slickBack.id)
            .select(),
        );
      },
    });
    const run = startWorker({ concurrency: 2 }, provider);

    const rows = await settled(visit.id);

    expect(rows).toHaveLength(16);
    expect(rows.every((r) => r.status === 'done')).toBe(true);
    const dropped = mine(run.logs, visit.id).filter((l) => l.outcome === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.hairStyleId).toBe(slickBack.id);
    const objects = must(await service.storage.from(STORAGE_BUCKETS.previews).list(`${shop.id}/${visit.id}`));
    expect(objects.filter((o) => o.name.startsWith(dropped[0]!.previewId))).toEqual([]);
    expect(objects).toHaveLength(32);
  });
});

describe('the worker\'s configuration', () => {
  it('chooses the provider by its configured name, fake among them', () => {
    const provider = createImageProvider(readPreviewWorkerConfig({ IMAGE_PROVIDER: 'fake' }).provider);
    expect(provider).toBeInstanceOf(FakeImageProvider);
    expect(provider.name).toBe('fake');
    expect(() => readPreviewWorkerConfig({ IMAGE_PROVIDER: 'dall-e' })).toThrow(
      'IMAGE_PROVIDER is dall-e: expected one of gemini, flux, seedream, fake',
    );
  });

  it('reads the concurrency and the stale timeout, 6 and 300 seconds unless set, and gemini by default', () => {
    expect(readPreviewWorkerConfig({})).toEqual({ provider: 'gemini', concurrency: 6, staleAfterSeconds: 300 });
    expect(
      readPreviewWorkerConfig({ IMAGE_PROVIDER: 'fake', PREVIEW_CONCURRENCY: '2', PREVIEW_STALE_TIMEOUT_SECONDS: '60' }),
    ).toEqual({ provider: 'fake', concurrency: 2, staleAfterSeconds: 60 });
    expect(() => readPreviewWorkerConfig({ PREVIEW_CONCURRENCY: '0' })).toThrow(
      'PREVIEW_CONCURRENCY is 0: expected a positive whole number',
    );
  });
});
