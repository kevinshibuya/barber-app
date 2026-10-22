// The nightly cleanup, two sweeps over every shop. A done preview created
// more than seven days ago that no visit chose loses its image and thumbnail:
// the objects are removed, then the row is marked purged with its paths
// cleared. The row stays, so generation counts survive. Objects go before the
// row is marked, so a run cut short leaves rows the next run finds again.
// Originals and after photos live in another bucket and are never touched. A
// visit whose share link has expired loses its token, so the link stops naming
// it even before the page checks the expiry. The worker runs it once a night;
// `pnpm --filter @barber/worker run cleanup` runs it once by hand.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Database, STORAGE_BUCKETS } from '@barber/shared';

export const PREVIEW_RETENTION_DAYS = 7;

// Rows per round trip: their ids go in the update's URL.
const PURGE_BATCH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

// 03:00 in São Paulo, which keeps UTC-3 all year.
export const CLEANUP_HOUR_UTC = 6;

export interface CleanupCounts {
  previewsPurged: number;
  objectsRemoved: number;
  linksCleared: number;
}

export interface CleanupLine extends CleanupCounts {
  event: 'cleanup';
  ms: number;
}

export interface CleanupOptions {
  // Service role: the cleanup sweeps every shop.
  db: SupabaseClient<Database>;
  log?: (line: CleanupLine) => void;
}

function writeLine(line: CleanupLine): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

type PurgeCounts = Pick<CleanupCounts, 'previewsPurged' | 'objectsRemoved'>;

async function purgePreviews(db: SupabaseClient<Database>): Promise<PurgeCounts> {
  const cutoff = new Date(Date.now() - PREVIEW_RETENTION_DAYS * DAY_MS).toISOString();
  let previewsPurged = 0;
  let objectsRemoved = 0;
  for (;;) {
    const batch = check(
      await db
        .from('previews')
        .select('id, storage_path, thumbnail_path, chosen_by:visits!visits_chosen_preview_fkey(id)')
        .eq('status', 'done')
        .is('purged_at', null)
        .lt('created_at', cutoff)
        .is('chosen_by', null)
        .limit(PURGE_BATCH),
      'purgeable previews',
    );
    if (!batch || batch.length === 0) break;

    const paths = batch.flatMap((p) => [p.storage_path, p.thumbnail_path].filter((path) => path !== null));
    if (paths.length > 0) {
      const removed = check(await db.storage.from(STORAGE_BUCKETS.previews).remove(paths), 'remove previews');
      objectsRemoved += removed?.length ?? 0;
    }
    const marked = check(
      await db
        .from('previews')
        .update({ purged_at: new Date().toISOString(), storage_path: null, thumbnail_path: null })
        .in('id', batch.map((p) => p.id))
        .is('purged_at', null)
        .select('id'),
      'mark previews purged',
    );
    previewsPurged += marked?.length ?? 0;
    // Nothing marked means the batch would come back unchanged.
    if (!marked || marked.length === 0) break;
  }
  return { previewsPurged, objectsRemoved };
}

async function clearExpiredLinks(db: SupabaseClient<Database>): Promise<number> {
  const cleared = check(
    await db
      .from('visits')
      .update({ share_token: null })
      .not('share_token', 'is', null)
      .lte('share_expires_at', new Date().toISOString())
      .select('id'),
    'clear expired links',
  );
  return cleared?.length ?? 0;
}

// One run of the cleanup; logs and returns its counts.
export async function runCleanup(options: CleanupOptions): Promise<CleanupCounts> {
  const startedAt = Date.now();
  const counts = { ...(await purgePreviews(options.db)), linksCleared: await clearExpiredLinks(options.db) };
  (options.log ?? writeLine)({ event: 'cleanup', ...counts, ms: Date.now() - startedAt });
  return counts;
}

// The first CLEANUP_HOUR_UTC strictly after now.
export function nextCleanupAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(CLEANUP_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// Runs the cleanup at each nextCleanupAt while started. A failed run is
// reported and the next night runs again.
export class NightlyCleanup {
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<unknown> | undefined;

  constructor(private readonly options: CleanupOptions) {}

  start(): void {
    if (this.timer) return;
    this.schedule();
  }

  // Lets a run in flight finish, then resolves.
  async stop(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.current;
  }

  private schedule(): void {
    const now = new Date();
    this.timer = setTimeout(() => {
      this.current = runCleanup(this.options)
        .catch((error: unknown) => {
          process.stderr.write(`cleanup: run failed: ${String(error)}\n`);
        })
        .finally(() => {
          this.current = undefined;
          if (this.timer) this.schedule();
        });
    }, nextCleanupAt(now).getTime() - now.getTime());
  }
}
