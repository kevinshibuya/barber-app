// The previews table is the generation queue. `claim_previews` claims across
// every shop in the database, so each test runs in a shop of its own that is
// deleted before the next test starts.
import type { RealtimePostgresUpdatePayload } from '@supabase/supabase-js';
import {
  afterPhotoPath,
  KEEP_STYLE_SLUG,
  originalPhotoPath,
  PREVIEW_PRIORITY,
  type PhotoSlot,
  type PreviewRow,
  type Tables,
} from '../src';
import { createTestShop, deleteTestShop, must, serviceClient, type TestShop } from './support/supabase';

const service = serviceClient();
let shop: TestShop;
let styles: Tables<'styles'>[];

beforeAll(async () => {
  styles = must(await service.from('styles').select('*').eq('active', true).order('sort_order'));
});

beforeEach(async () => {
  shop = await createTestShop(service, ['barber']);
});

afterEach(async () => {
  await deleteTestShop(service, shop);
});

const db = () => shop.barbers[0]!.db;

function style(dimension: 'hair' | 'beard', slug: string): string {
  const found = styles.find((s) => s.dimension === dimension && s.slug === slug);
  if (!found) throw new Error(`no ${dimension} style ${slug}`);
  return found.id;
}

const keep = (dimension: 'hair' | 'beard') => style(dimension, KEEP_STYLE_SLUG);
const generated = (dimension: 'hair' | 'beard') =>
  styles.filter((s) => s.dimension === dimension && s.slug !== KEEP_STYLE_SLUG);

async function startVisit(target: TestShop = shop) {
  const client = must(
    await service.from('clients').insert({ shop_id: target.id, name: 'Queue client' }).select().single(),
  );
  return must(
    await service
      .from('visits')
      .insert({ shop_id: target.id, client_id: client.id, barber_id: target.barbers[0]!.id })
      .select()
      .single(),
  );
}

// The barber's app writes the photo row: insert while uploading, then mark it
// uploaded, both as an upsert on the slot.
async function writePhoto(visitId: string, slot: PhotoSlot, take: number, status: 'uploading' | 'uploaded') {
  return must(
    await db()
      .from('photos')
      .upsert(
        {
          visit_id: visitId,
          slot,
          storage_path: originalPhotoPath(shop.id, visitId, slot, String(take)),
          width: 768,
          height: 1024,
          upload_status: status,
        },
        { onConflict: 'visit_id,slot' },
      )
      .select()
      .single(),
  );
}

async function uploadFront(visitId: string, take = 1) {
  await writePhoto(visitId, 'front', take, 'uploading');
  return writePhoto(visitId, 'front', take, 'uploaded');
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

async function claim(n: number, staleAfter = '5 minutes'): Promise<PreviewRow[]> {
  return must(await service.rpc('claim_previews', { n, stale_after: staleAfter }));
}

async function complete(id: string, attempt?: number) {
  return (
    await service.rpc('complete_preview', {
      id,
      storage_path: `${shop.id}/x/${id}.jpg`,
      thumbnail_path: `${shop.id}/x/${id}.thumb.jpg`,
      attempt,
    })
    .maybeSingle()
  ).data;
}

// The app's write of a look: the preview's pair and the preview itself.
function choose(visitId: string, row: PreviewRow) {
  return db()
    .from('visits')
    .update({
      chosen_hair_style_id: row.hair_style_id,
      chosen_beard_style_id: row.beard_style_id,
      chosen_preview_id: row.id,
    })
    .eq('id', visitId)
    .select()
    .single();
}

async function request(visitId: string, hair: string, beard: string, slot: PhotoSlot = 'front') {
  return must(
    await db().rpc('request_preview', {
      visit_id: visitId,
      hair_style_id: hair,
      beard_style_id: beard,
      slot,
    })
    .maybeSingle(),
  );
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the enqueue trigger', () => {
  it('enqueues 17 pending front previews when the front photo is uploaded, hair first, and only once', async () => {
    const visit = await startVisit();

    await writePhoto(visit.id, 'front', 1, 'uploading');
    expect(await previewsOf(visit.id)).toEqual([]);

    await writePhoto(visit.id, 'front', 1, 'uploaded');
    const rows = await previewsOf(visit.id);

    expect(rows).toHaveLength(17);
    expect(rows.every((r) => r.status === 'pending' && r.slot === 'front' && r.attempt_count === 0)).toBe(true);

    const hairRows = rows.slice(0, 12);
    const beardRows = rows.slice(12);
    expect(hairRows.every((r) => r.beard_style_id === keep('beard') && r.priority === PREVIEW_PRIORITY.hair)).toBe(
      true,
    );
    expect(beardRows.every((r) => r.hair_style_id === keep('hair') && r.priority === PREVIEW_PRIORITY.beard)).toBe(
      true,
    );
    expect(new Set(hairRows.map((r) => r.hair_style_id))).toEqual(new Set(ids(generated('hair'))));
    expect(new Set(beardRows.map((r) => r.beard_style_id))).toEqual(new Set(ids(generated('beard'))));
    expect(PREVIEW_PRIORITY.hair).toBeGreaterThan(PREVIEW_PRIORITY.beard);

    await writePhoto(visit.id, 'front', 1, 'uploaded');
    expect(ids(await previewsOf(visit.id))).toEqual(ids(rows));
  });

  it('enqueues nothing for the other slots', async () => {
    const visit = await startVisit();
    await writePhoto(visit.id, 'left', 1, 'uploading');
    await writePhoto(visit.id, 'left', 1, 'uploaded');
    expect(await previewsOf(visit.id)).toEqual([]);
  });

  it('replaces the slot\'s previews on a retake and clears a look chosen from them', async () => {
    const visit = await startVisit();
    await uploadFront(visit.id, 1);
    const before = await previewsOf(visit.id);

    const [done, running] = await claim(2);
    const completed = await complete(done!.id);
    expect(completed).toMatchObject({ id: done!.id, status: 'done' });
    must(await choose(visit.id, done!));

    await uploadFront(visit.id, 2);
    const after = await previewsOf(visit.id);

    expect(after).toHaveLength(17);
    expect(after.every((r) => r.status === 'pending')).toBe(true);
    expect(ids(after).filter((id) => ids(before).includes(id))).toEqual([]);
    const reread = must(
      await service
        .from('visits')
        .select('chosen_hair_style_id, chosen_beard_style_id, chosen_preview_id')
        .eq('id', visit.id)
        .single(),
    );
    expect(reread).toEqual({ chosen_hair_style_id: null, chosen_beard_style_id: null, chosen_preview_id: null });

    // The deleted rows' objects wait for the nightly cleanup.
    const objects = [completed!.storage_path!, completed!.thumbnail_path!];
    const orphaned = must(await service.from('orphaned_objects').select('bucket, path').in('path', objects));
    expect(orphaned).toEqual(
      expect.arrayContaining(objects.map((path) => ({ bucket: 'previews', path }))),
    );
    must(await service.from('orphaned_objects').delete().in('path', objects).select());

    // The worker that was rendering a deleted row completes nothing.
    const late = await service.rpc('complete_preview', {
      id: running!.id,
      storage_path: 'orphan.jpg',
      thumbnail_path: 'orphan.thumb.jpg',
    })
    .maybeSingle();
    expect(late.error).toBeNull();
    expect(late.data).toBeNull();
    expect(await previewsOf(visit.id)).toHaveLength(17);
  });
});

describe('claim_previews', () => {
  it('gives two concurrent callers disjoint rows, highest priority first', async () => {
    const visit = await startVisit();
    await uploadFront(visit.id);

    const [first, second] = await Promise.all([claim(6), claim(6)]);

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([]);

    // Twelve hair rows outrank five beard rows: the union is the hair rows.
    const union = [...first, ...second];
    expect(new Set(union.map((r) => r.hair_style_id))).toEqual(new Set(ids(generated('hair'))));
    expect(union.every((r) => r.status === 'running' && r.attempt_count === 1 && r.claimed_at)).toBe(true);

    const rest = (await previewsOf(visit.id)).filter((r) => !ids(union).includes(r.id));
    expect(rest).toHaveLength(5);
    expect(rest.every((r) => r.status === 'pending' && r.hair_style_id === keep('hair'))).toBe(true);
    expect(await claim(17)).toHaveLength(5);
  });

  it('holds a combination until its hair-only base is done, and fails it with its base', async () => {
    const visit = await startVisit();
    const combination = await request(visit.id, style('hair', 'low-fade'), style('beard', 'goatee'));
    const [base] = (await previewsOf(visit.id)).filter((r) => r.beard_style_id === keep('beard'));

    expect(ids(await claim(10))).toEqual([base!.id]);
    expect(await claim(10)).toEqual([]);
    await complete(base!.id);
    expect(ids(await claim(10))).toEqual([combination!.id]);

    const failing = await request(visit.id, style('hair', 'quiff'), style('beard', 'goatee'));
    const [failingBase] = (await previewsOf(visit.id)).filter(
      (r) => r.hair_style_id === style('hair', 'quiff') && r.beard_style_id === keep('beard'),
    );
    expect(ids(await claim(10))).toEqual([failingBase!.id]);
    const failed = must(
      await service
        .rpc('fail_preview', { id: failingBase!.id, status: 'failed', error: 'provider exploded' })
        .maybeSingle(),
    );
    expect(failed).toMatchObject({ status: 'failed', error: 'provider exploded' });

    const cascaded = (await previewsOf(visit.id)).find((r) => r.id === failing!.id);
    expect(cascaded?.status).toBe('failed');
    expect(await claim(10)).toEqual([]);
  });

  it('reclaims a row running past stale_after and skips a row whose not-before is in the future', async () => {
    const visit = await startVisit();
    const stuck = await request(visit.id, style('hair', 'taper'), keep('beard'));
    const later = await request(visit.id, style('hair', 'quiff'), keep('beard'));

    expect(new Set(ids(await claim(10)))).toEqual(new Set([stuck!.id, later!.id]));
    const retried = must(
      await service.rpc('fail_preview', {
        id: later!.id,
        status: 'pending',
        error: 'rate limited',
        retry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .maybeSingle(),
    );
    expect(retried).toMatchObject({ status: 'pending', error: 'rate limited', attempt_count: 1 });

    expect(await claim(10, '1 hour')).toEqual([]);
    await sleep(1_200);
    const reclaimed = await claim(10, '1 second');
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ id: stuck!.id, status: 'running', attempt_count: 2 });
  });

  it('settles a row only for the claim that holds it', async () => {
    const visit = await startVisit();
    const row = await request(visit.id, style('hair', 'taper'), keep('beard'));
    const [first] = await claim(10);
    await sleep(1_200);
    const [second] = await claim(10, '1 second');
    expect(second).toMatchObject({ id: row!.id, attempt_count: 2 });

    const lateFail = await service
      .rpc('fail_preview', { id: row!.id, status: 'pending', error: 'late', attempt: first!.attempt_count })
      .maybeSingle();
    expect(lateFail.error).toBeNull();
    expect(lateFail.data).toBeNull();
    expect(await complete(row!.id, first!.attempt_count)).toBeNull();

    expect(await complete(row!.id, second!.attempt_count)).toMatchObject({ status: 'done', attempt_count: 2 });
  });

  it('fails a row lost on its last attempt, with its combination, instead of claiming it again', async () => {
    const visit = await startVisit();
    const combination = await request(visit.id, style('hair', 'low-fade'), style('beard', 'goatee'));
    const [base] = await claim(10);
    must(
      await service
        .from('previews')
        .update({ attempt_count: 3, claimed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
        .eq('id', base!.id)
        .select(),
    );

    expect(await claim(10, '5 minutes')).toEqual([]);
    const rows = await previewsOf(visit.id);
    expect(rows.find((r) => r.id === base!.id)).toMatchObject({ status: 'failed', attempt_count: 3 });
    expect(rows.find((r) => r.id === combination!.id)).toMatchObject({ status: 'failed' });
  });
});

describe('the chosen look', () => {
  it('takes a done preview of the visit, until the after photo is taken or the visit is closed', async () => {
    const visit = await startVisit();
    await uploadFront(visit.id);
    const [first, second] = await claim(2);
    await complete(first!.id);
    await complete(second!.id);

    must(await choose(visit.id, first!));
    must(await choose(visit.id, second!));
    const pending = (await previewsOf(visit.id)).find((r) => r.status === 'pending');
    expect((await choose(visit.id, pending!)).error?.code).toBe('55000');

    must(
      await service
        .from('previews')
        .update({ purged_at: new Date().toISOString(), storage_path: null, thumbnail_path: null })
        .eq('id', first!.id)
        .select(),
    );
    expect((await choose(visit.id, first!)).error?.code).toBe('55000');

    must(
      await db()
        .from('visits')
        .update({ after_photo_path: afterPhotoPath(shop.id, visit.id) })
        .eq('id', visit.id)
        .select()
        .single(),
    );
    const third = (await claim(1))[0]!;
    await complete(third.id);
    expect((await choose(visit.id, third)).error?.code).toBe('55000');

    const closed = await startVisit();
    must(await db().from('visits').update({ status: 'closed' }).eq('id', closed.id).select().single());
    const keepBoth = await db()
      .from('visits')
      .update({ chosen_hair_style_id: keep('hair'), chosen_beard_style_id: keep('beard') })
      .eq('id', closed.id);
    expect(keepBoth.error?.code).toBe('55000');
  });
});

describe('request_preview', () => {
  it('dedupes, adds the hair-only base of a combination, and returns null for keep plus keep', async () => {
    const visit = await startVisit();
    await uploadFront(visit.id);
    const prerendered = (await previewsOf(visit.id)).find((r) => r.hair_style_id === style('hair', 'mid-fade'));

    expect(await request(visit.id, style('hair', 'mid-fade'), keep('beard'))).toMatchObject({
      id: prerendered!.id,
      priority: PREVIEW_PRIORITY.hair,
    });

    const side = await request(visit.id, style('hair', 'mid-fade'), keep('beard'), 'left');
    expect(side).toMatchObject({ slot: 'left', status: 'pending', priority: PREVIEW_PRIORITY.request });
    expect(PREVIEW_PRIORITY.request).toBeGreaterThan(PREVIEW_PRIORITY.hair);
    expect((await request(visit.id, style('hair', 'mid-fade'), keep('beard'), 'left'))!.id).toBe(side!.id);

    const combination = await request(visit.id, style('hair', 'pompadour'), style('beard', 'full-beard'), 'right');
    expect(combination).toMatchObject({ slot: 'right', status: 'pending', priority: PREVIEW_PRIORITY.request });
    const right = (await previewsOf(visit.id)).filter((r) => r.slot === 'right');
    expect(right.map((r) => [r.hair_style_id, r.beard_style_id])).toEqual(
      expect.arrayContaining([
        [style('hair', 'pompadour'), style('beard', 'full-beard')],
        [style('hair', 'pompadour'), keep('beard')],
      ]),
    );
    expect(right).toHaveLength(2);
    expect((await request(visit.id, style('hair', 'pompadour'), style('beard', 'full-beard'), 'right'))!.id).toBe(
      combination!.id,
    );
    expect(await previewsOf(visit.id)).toHaveLength(17 + 3);

    const { data, error } = await db().rpc('request_preview', {
      visit_id: visit.id,
      hair_style_id: keep('hair'),
      beard_style_id: keep('beard'),
      slot: 'back',
    })
    .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(await previewsOf(visit.id)).toHaveLength(17 + 3);
  });
});

describe('a barber\'s access', () => {
  it('requests and retries through the functions, never writes rows directly, and only in their shop', async () => {
    const visit = await startVisit();
    const row = await request(visit.id, style('hair', 'buzz-cut'), keep('beard'));

    const visible = must(await db().from('previews').select('*').eq('id', row!.id));
    expect(ids(visible)).toEqual([row!.id]);

    await claim(1);
    await claim(1, '0 seconds');
    must(await service.rpc('fail_preview', { id: row!.id, status: 'failed', error: 'gave up' }).maybeSingle());

    const update = await db().from('previews').update({ status: 'pending', attempt_count: 0 }).eq('id', row!.id);
    expect(update.error?.code).toBe('42501');
    const insert = await db().from('previews').insert({
      visit_id: visit.id,
      hair_style_id: style('hair', 'quiff'),
      beard_style_id: keep('beard'),
      slot: 'front',
    });
    expect(insert.error?.code).toBe('42501');
    const del = await db().from('previews').delete().eq('id', row!.id);
    expect(del.error?.code).toBe('42501');
    for (const fn of ['claim_previews', 'complete_preview', 'fail_preview'] as const) {
      const args = {
        claim_previews: { n: 1, stale_after: '0 seconds' },
        complete_preview: { id: row!.id, storage_path: 'x', thumbnail_path: 'y' },
        fail_preview: { id: row!.id, status: 'failed', error: 'x' },
      }[fn];
      const { error } = await db().rpc(fn, args as never);
      expect([fn, error?.code]).toEqual([fn, '42501']);
    }
    expect((await previewsOf(visit.id))[0]).toMatchObject({ status: 'failed', attempt_count: 2 });

    const retried = must(await db().rpc('retry_preview', { id: row!.id }));
    expect(retried).toMatchObject({ id: row!.id, status: 'pending', attempt_count: 0, error: null });
    expect(new Date(retried.not_before).getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(ids(await claim(1))).toEqual([row!.id]);

    const otherShop = await createTestShop(service, ['barber']);
    try {
      const outsider = otherShop.barbers[0]!.db;
      expect(must(await outsider.from('previews').select('id').eq('visit_id', visit.id))).toEqual([]);
      const theirRequest = await outsider.rpc('request_preview', {
        visit_id: visit.id,
        hair_style_id: style('hair', 'quiff'),
        beard_style_id: keep('beard'),
        slot: 'front',
      });
      expect(theirRequest.error?.code).toBe('42501');
      const theirRetry = await outsider.rpc('retry_preview', { id: row!.id });
      expect(theirRetry.error?.code).toBe('42501');
    } finally {
      await deleteTestShop(service, otherShop);
    }
  });
});

describe('Realtime', () => {
  it('sends a barber subscribed to the visit the status change when a row completes', async () => {
    const visit = await startVisit();
    const changes: RealtimePostgresUpdatePayload<PreviewRow>[] = [];

    const channel = db().channel(`previews:${visit.id}`);
    await new Promise<void>((resolve, reject) => {
      channel
        .on<PreviewRow>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'previews', filter: `visit_id=eq.${visit.id}` },
          (payload) => changes.push(payload),
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
        });
    });

    try {
      // Realtime may join the replication stream a moment after SUBSCRIBED,
      // so a fresh row is completed each round until one is seen.
      const completed: string[] = [];
      for (const hair of generated('hair')) {
        const row = await request(visit.id, hair.id, keep('beard'));
        await claim(1);
        expect(await complete(row!.id)).toMatchObject({ status: 'done' });
        completed.push(row!.id);
        await sleep(1_000);
        if (changes.some((c) => c.new.status === 'done')) break;
      }
      const done = changes.find((c) => c.new.status === 'done');
      expect(done?.new).toMatchObject({ visit_id: visit.id, status: 'done' });
      expect(completed).toContain(done!.new.id);
    } finally {
      await db().removeChannel(channel);
    }
  });
});
