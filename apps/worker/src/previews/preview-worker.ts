// The preview queue's consumer. Each tick claims up to `concurrency` rows
// through `claim_previews`, renders them in parallel, and claims again until
// the queue has nothing claimable; the next tick starts `intervalMs` after the
// last one ended, so ticks never overlap. A row is rendered on its base (the
// slot's photo, or for a combination the slot's done hair-only preview) with
// its style's reference image and prompt, then stored as an image and a
// 256 px thumbnail and settled through `complete_preview` or `fail_preview`.
// The worker writes preview rows only through those functions.
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  KEEP_STYLE_SLUG,
  previewImagePath,
  previewThumbnailPath,
  type PreviewRow,
  STORAGE_BUCKETS,
  type Tables,
} from '@barber/shared';
import type { ImageProvider, RenderFailure, RenderRequest, RenderResult } from './image-provider';

export const THUMBNAIL_SIZE = 256;

// The first attempt and two retries; a row failing its third is failed.
export const MAX_ATTEMPTS = 3;

// `retry`: a retryable failure, pending again after a backoff. `dropped`: the
// row was deleted or settled while it rendered, so nothing was recorded.
// `error`: the row could not be settled and stays running until the stale
// timeout hands it back to the queue.
export type PreviewOutcome = 'done' | 'retry' | 'failed' | 'refused' | 'dropped' | 'error';

// One structured line per row outcome.
export interface PreviewOutcomeLine {
  event: 'preview';
  outcome: PreviewOutcome;
  previewId: string;
  visitId: string;
  slot: PreviewRow['slot'];
  hairStyleId: string;
  beardStyleId: string;
  attempt: number;
  provider: string;
  ms: number;
  error?: string;
}

interface StoredPreview {
  imagePath: string;
  thumbnailPath: string;
  // Whether the visit already named its provider when the image was stored.
  providerRecorded: boolean;
}

export interface PreviewWorkerOptions {
  // Service role: the worker reads every shop's rows and objects.
  db: SupabaseClient<Database>;
  provider: ImageProvider;
  // Rows claimed, and so provider calls, at a time.
  concurrency?: number;
  // A running row claimed longer ago than this is claimed again.
  staleAfterSeconds?: number;
  // Pause between the end of one tick and the start of the next.
  intervalMs?: number;
  // A retryable failure is claimable again after this, doubled per attempt.
  retryBaseMs?: number;
  log?: (line: PreviewOutcomeLine) => void;
}

export const PREVIEW_WORKER_DEFAULTS = {
  concurrency: 6,
  staleAfterSeconds: 300,
  intervalMs: 2_000,
  retryBaseMs: 5_000,
} as const;

function writeLine(line: PreviewOutcomeLine): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// `check`, for a result that is never null without an error.
function present<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = check(result, what);
  if (data === null || data === undefined) throw new Error(`${what}: no data`);
  return data;
}

export class PreviewWorker {
  private readonly db: SupabaseClient<Database>;
  private readonly provider: ImageProvider;
  private readonly concurrency: number;
  private readonly staleAfterSeconds: number;
  private readonly intervalMs: number;
  private readonly retryBaseMs: number;
  private readonly log: (line: PreviewOutcomeLine) => void;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;

  constructor(options: PreviewWorkerOptions) {
    this.db = options.db;
    this.provider = options.provider;
    this.concurrency = options.concurrency ?? PREVIEW_WORKER_DEFAULTS.concurrency;
    this.staleAfterSeconds = options.staleAfterSeconds ?? PREVIEW_WORKER_DEFAULTS.staleAfterSeconds;
    this.intervalMs = options.intervalMs ?? PREVIEW_WORKER_DEFAULTS.intervalMs;
    this.retryBaseMs = options.retryBaseMs ?? PREVIEW_WORKER_DEFAULTS.retryBaseMs;
    this.log = options.log ?? writeLine;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  // Lets the tick in flight finish its rows, then resolves.
  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.current;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.current = this.tick()
        .catch((error: unknown) => {
          process.stderr.write(`preview worker: tick failed: ${String(error)}\n`);
        })
        .finally(() => {
          this.current = undefined;
          if (this.running) this.schedule(this.intervalMs);
        });
    }, delayMs);
  }

  // Claims and renders until nothing is claimable or the worker is stopped.
  async tick(): Promise<void> {
    do {
      const rows = present(
        await this.db.rpc('claim_previews', {
          n: this.concurrency,
          stale_after: `${this.staleAfterSeconds} seconds`,
        }),
        'claim_previews',
      );
      if (rows.length === 0) return;
      await Promise.all(rows.map((row) => this.process(row)));
    } while (this.running);
  }

  // Renders and settles one claimed row. Anything that goes wrong before the
  // row is settled, a missing photo as much as a provider error or an image
  // that will not decode, is a retryable failure.
  private async process(row: PreviewRow): Promise<void> {
    const startedAt = Date.now();
    let outcome: PreviewOutcome;
    let error: string | undefined;
    try {
      let result: { ok: true; stored: StoredPreview } | Extract<RenderResult, { ok: false }>;
      try {
        const rendered = await this.provider.render(await this.renderRequest(row));
        result = rendered.ok ? { ok: true, stored: await this.store(row, rendered.image) } : rendered;
      } catch (thrown) {
        result = { ok: false, failure: 'retryable', message: errorText(thrown) };
      }
      if (result.ok) {
        outcome = await this.complete(row, result.stored);
      } else {
        error = result.message;
        outcome = await this.fail(row, result.failure, result.message);
      }
    } catch (thrown) {
      outcome = 'error';
      error = errorText(thrown);
    }
    this.log({
      event: 'preview',
      outcome,
      previewId: row.id,
      visitId: row.visit_id,
      slot: row.slot,
      hairStyleId: row.hair_style_id,
      beardStyleId: row.beard_style_id,
      attempt: row.attempt_count,
      provider: this.provider.name,
      ms: Date.now() - startedAt,
      ...(error === undefined ? {} : { error }),
    });
  }

  // A refusal is final at once; a retryable failure is pending again after
  // retryBaseMs, doubled per attempt, until the last attempt fails the row.
  private async fail(row: PreviewRow, failure: RenderFailure, message: string): Promise<PreviewOutcome> {
    let status: 'pending' | 'failed' | 'refused';
    let retryAt: string | undefined;
    if (failure === 'refused') {
      status = 'refused';
    } else if (row.attempt_count >= MAX_ATTEMPTS) {
      status = 'failed';
    } else {
      status = 'pending';
      retryAt = new Date(Date.now() + this.retryBaseMs * 2 ** (row.attempt_count - 1)).toISOString();
    }
    const settled = check(
      await this.db
        .rpc('fail_preview', { id: row.id, status, error: message, retry_at: retryAt })
        .maybeSingle(),
      'fail_preview',
    );
    if (!settled) return 'dropped';
    return status === 'pending' ? 'retry' : status;
  }

  private async download(bucket: string, path: string): Promise<Buffer> {
    const blob = present(await this.db.storage.from(bucket).download(path), `download ${bucket}/${path}`);
    return Buffer.from(await blob.arrayBuffer());
  }

  // The row's base image, its style's reference images and prompt. A
  // single-style row is rendered on the slot's photo with that style; a
  // combination on the slot's hair-only preview with its beard style.
  private async renderRequest(row: PreviewRow): Promise<RenderRequest> {
    const pair = present(
      await this.db.from('styles').select('*').in('id', [row.hair_style_id, row.beard_style_id]),
      'styles',
    );
    const hair = pair.find((s) => s.id === row.hair_style_id);
    const beard = pair.find((s) => s.id === row.beard_style_id);
    if (!hair || !beard) throw new Error(`preview ${row.id} names a missing style`);
    const style: Tables<'styles'> = beard.slug === KEEP_STYLE_SLUG ? hair : beard;
    if (!style.prompt || !style.reference_image_path) {
      throw new Error(`style ${style.dimension}/${style.slug} has no prompt or reference image`);
    }
    const combination = hair.slug !== KEEP_STYLE_SLUG && beard.slug !== KEEP_STYLE_SLUG;
    const [base, reference] = await Promise.all([
      combination ? this.hairOnlyPreview(row) : this.slotPhoto(row),
      this.download(STORAGE_BUCKETS.styles, style.reference_image_path),
    ]);
    return { base, references: [reference], prompt: style.prompt };
  }

  private async slotPhoto(row: PreviewRow): Promise<Buffer> {
    const photo = check(
      await this.db
        .from('photos')
        .select('storage_path')
        .eq('visit_id', row.visit_id)
        .eq('slot', row.slot)
        .eq('upload_status', 'uploaded')
        .maybeSingle(),
      'photos',
    );
    if (!photo) throw new Error(`visit ${row.visit_id} has no uploaded ${row.slot} photo`);
    return this.download(STORAGE_BUCKETS.originals, photo.storage_path);
  }

  private async hairOnlyPreview(row: PreviewRow): Promise<Buffer> {
    const base = check(
      await this.db
        .from('previews')
        .select('status, storage_path, styles!previews_beard_style_id_fkey!inner(slug)')
        .eq('visit_id', row.visit_id)
        .eq('slot', row.slot)
        .eq('hair_style_id', row.hair_style_id)
        .eq('styles.slug', KEEP_STYLE_SLUG)
        .maybeSingle(),
      'base preview',
    );
    if (base?.status !== 'done' || !base.storage_path) {
      throw new Error(`preview ${row.id} has no done hair-only base`);
    }
    return this.download(STORAGE_BUCKETS.previews, base.storage_path);
  }

  // Writes the image as a JPEG and its thumbnail at the previews path
  // convention.
  private async store(row: PreviewRow, image: Buffer): Promise<StoredPreview> {
    const visit = present(
      await this.db.from('visits').select('shop_id, provider_name').eq('id', row.visit_id).maybeSingle(),
      `visit ${row.visit_id}`,
    );
    const imagePath = previewImagePath(visit.shop_id, row.visit_id, row.id);
    const thumbnailPath = previewThumbnailPath(visit.shop_id, row.visit_id, row.id);
    const [jpeg, thumbnail] = await Promise.all([
      sharp(image).rotate().jpeg({ quality: 90 }).toBuffer(),
      sharp(image)
        .rotate()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer(),
    ]);
    const bucket = this.db.storage.from(STORAGE_BUCKETS.previews);
    const options = { contentType: 'image/jpeg', upsert: true };
    check(await bucket.upload(imagePath, jpeg, options), `upload ${imagePath}`);
    check(await bucket.upload(thumbnailPath, thumbnail, options), `upload ${thumbnailPath}`);
    return { imagePath, thumbnailPath, providerRecorded: visit.provider_name !== null };
  }

  // Marks the row done and, on the visit's first completion, records the
  // provider on the visit. A row deleted or settled meanwhile is dropped: its
  // objects are removed again.
  private async complete(row: PreviewRow, stored: StoredPreview): Promise<PreviewOutcome> {
    const { imagePath, thumbnailPath } = stored;
    const done = check(
      await this.db
        .rpc('complete_preview', { id: row.id, storage_path: imagePath, thumbnail_path: thumbnailPath })
        .maybeSingle(),
      'complete_preview',
    );
    if (!done) {
      await this.db.storage.from(STORAGE_BUCKETS.previews).remove([imagePath, thumbnailPath]);
      return 'dropped';
    }
    if (!stored.providerRecorded) {
      check(
        await this.db
          .from('visits')
          .update({ provider_name: this.provider.name })
          .eq('id', row.visit_id)
          .is('provider_name', null),
        'record provider',
      );
    }
    return 'done';
  }
}
