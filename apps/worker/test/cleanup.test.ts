// The nightly cleanup, run once as the schedule or the package script runs it,
// over the local Supabase with visits seeded per test. The job sweeps the
// whole database, so each test ages its own rows and asserts on those.
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { clientPagePath, STORAGE_BUCKETS } from '@barber/shared';
import { AppModule } from '../src/app.module';
import { nextCleanupAt, runCleanup } from '../src/cleanup/cleanup';
import { seedClientPageVisit } from './support/client-page';
import { createTestShop, deleteTestShop, must, serviceClient, type TestShop } from './support/supabase';

jest.setTimeout(30_000);

const service = serviceClient();
const DAY_MS = 24 * 60 * 60 * 1000;
let shop: TestShop;

beforeEach(async () => {
  shop = await createTestShop(service);
});

afterEach(async () => {
  await deleteTestShop(service, shop, [STORAGE_BUCKETS.originals, STORAGE_BUCKETS.previews]);
});

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

async function age(previewId: string, days: number): Promise<void> {
  must(await service.from('previews').update({ created_at: daysAgo(days) }).eq('id', previewId).select().single());
}

async function exists(bucket: string, path: string): Promise<boolean> {
  const { data, error } = await service.storage.from(bucket).exists(path);
  if (error && data !== false) throw error;
  return data;
}

async function preview(id: string) {
  return must(await service.from('previews').select('*').eq('id', id).single());
}

describe('unchosen previews', () => {
  it('lose their objects after seven days and keep their rows; chosen and younger ones are kept', async () => {
    const { visit, done } = await seedClientPageVisit(service, shop, {
      after: true,
      done: [
        { hair: 'low-fade', beard: 'keep' },
        { hair: 'keep', beard: 'full-beard' },
        { hair: 'mid-fade', beard: 'keep' },
      ],
      chosen: { hair: 'keep', beard: 'full-beard' },
    });
    const [old, chosen, young] = done;
    if (!old || !chosen || !young) throw new Error('expected three done previews');
    await age(old.id, 8);
    await age(chosen.id, 8);
    await age(young.id, 6);

    const counts = await runCleanup({ db: service, log: () => undefined });

    const purged = await preview(old.id);
    expect(purged.purged_at).not.toBeNull();
    expect(purged.storage_path).toBeNull();
    expect(purged.thumbnail_path).toBeNull();
    expect(purged.status).toBe('done');
    expect(await exists(STORAGE_BUCKETS.previews, old.storage_path!)).toBe(false);
    expect(await exists(STORAGE_BUCKETS.previews, old.thumbnail_path!)).toBe(false);

    for (const kept of [chosen, young]) {
      const row = await preview(kept.id);
      expect(row.purged_at).toBeNull();
      expect(row.storage_path).toBe(kept.storage_path);
      expect(await exists(STORAGE_BUCKETS.previews, kept.storage_path!)).toBe(true);
      expect(await exists(STORAGE_BUCKETS.previews, kept.thumbnail_path!)).toBe(true);
    }

    // Originals and the after photo are never touched.
    const photos = must(await service.from('photos').select('storage_path').eq('visit_id', visit.id));
    for (const path of [...photos.map((p) => p.storage_path), visit.after_photo_path!]) {
      expect(await exists(STORAGE_BUCKETS.originals, path)).toBe(true);
    }

    expect(counts.previewsPurged).toBeGreaterThanOrEqual(1);
    expect(counts.objectsRemoved).toBeGreaterThanOrEqual(2);
  });
});

describe('objects a retake orphaned', () => {
  it('are removed from storage and forgotten', async () => {
    const { done } = await seedClientPageVisit(service, shop, { done: [{ hair: 'low-fade', beard: 'keep' }] });
    const [row] = done;
    if (!row) throw new Error('expected a done preview');
    const paths = [row.storage_path!, row.thumbnail_path!];
    must(
      await service
        .from('orphaned_objects')
        .insert(paths.map((path) => ({ bucket: STORAGE_BUCKETS.previews, path })))
        .select(),
    );

    const counts = await runCleanup({ db: service, log: () => undefined });

    for (const path of paths) expect(await exists(STORAGE_BUCKETS.previews, path)).toBe(false);
    expect(must(await service.from('orphaned_objects').select('id').in('path', paths))).toEqual([]);
    expect(counts.orphansRemoved).toBeGreaterThanOrEqual(2);
  });
});

describe('share links', () => {
  it('lose their token once past expiry, so the page is 404; a live link keeps it', async () => {
    const expired = await seedClientPageVisit(service, shop);
    const live = await seedClientPageVisit(service, shop);
    must(
      await service
        .from('visits')
        .update({ share_expires_at: daysAgo(1) })
        .eq('id', expired.visit.id)
        .select()
        .single(),
    );

    const counts = await runCleanup({ db: service, log: () => undefined });

    const visits = must(
      await service.from('visits').select('id, share_token').in('id', [expired.visit.id, live.visit.id]),
    );
    expect(visits.find((v) => v.id === expired.visit.id)?.share_token).toBeNull();
    expect(visits.find((v) => v.id === live.visit.id)?.share_token).toBe(live.token);
    expect(counts.linksCleared).toBeGreaterThanOrEqual(1);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot({ db: service })] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get(clientPagePath(expired.token)).expect(404);
      await request(app.getHttpServer()).get(clientPagePath(live.token)).expect(200);
    } finally {
      await app.close();
    }
  });
});

describe('the schedule', () => {
  it('runs at 03:00 in São Paulo, the next one after now', () => {
    expect(nextCleanupAt(new Date('2026-10-22T05:59:00Z')).toISOString()).toBe('2026-10-22T06:00:00.000Z');
    expect(nextCleanupAt(new Date('2026-10-22T06:00:00Z')).toISOString()).toBe('2026-10-23T06:00:00.000Z');
    expect(nextCleanupAt(new Date('2026-10-31T21:00:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });
});
