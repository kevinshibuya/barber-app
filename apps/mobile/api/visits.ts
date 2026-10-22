import {
  previewThumbnailPath,
  STORAGE_BUCKETS,
  type StorageBucket,
  type Visit,
  type VisitStatus,
} from '@barber/shared';
import { notImplemented } from './not-implemented';
import { supabase } from './supabase';

export interface NewVisit {
  // Generated on the device, so a visit started on bad wifi is one row once online.
  id: string;
  clientId: string;
  consentGiven: true;
}

export interface Look {
  hairStyleId: string;
  beardStyleId: string;
  previewId: string;
}

// A visit as home and the client screen list it: who, by whom, when, and
// signed URLs of the chosen look's thumbnail and the after photo.
export interface VisitSummary {
  id: string;
  clientId: string;
  clientName: string;
  barberName: string;
  status: VisitStatus;
  createdAt: string;
  lookThumbnailUrl: string | null;
  afterPhotoUrl: string | null;
}

const RECENT_VISITS_LIMIT = 20;
// Long enough for a screen to stay open through a cut.
const SIGNED_URL_SECONDS = 60 * 60;

const SUMMARY_COLUMNS =
  'id, shop_id, client_id, status, created_at, chosen_preview_id, after_photo_path, client:clients(name), barber:barbers(display_name)';

function summaryQuery() {
  return supabase().from('visits').select(SUMMARY_COLUMNS).order('created_at', { ascending: false });
}

type SummaryRow = NonNullable<Awaited<ReturnType<typeof summaryQuery>>['data']>[number];

// Signs every path of one bucket in one request; a path whose object is
// missing maps to nothing.
async function signPaths(bucket: StorageBucket, paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const { data, error } = await supabase().storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) throw error;
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
  }
  return signed;
}

// A chosen preview is never purged, so its thumbnail sits at the fixed path.
function lookThumbnailPath(row: SummaryRow): string | null {
  return row.chosen_preview_id ? previewThumbnailPath(row.shop_id, row.id, row.chosen_preview_id) : null;
}

async function toSummaries(rows: SummaryRow[]): Promise<VisitSummary[]> {
  const lookPaths = rows.map(lookThumbnailPath).filter((path) => path !== null);
  const afterPaths = rows.map((row) => row.after_photo_path).filter((path) => path !== null);
  const [looks, afters] = await Promise.all([
    signPaths(STORAGE_BUCKETS.previews, lookPaths),
    signPaths(STORAGE_BUCKETS.originals, afterPaths),
  ]);
  return rows.map((row) => {
    const lookPath = lookThumbnailPath(row);
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.client?.name ?? '',
      barberName: row.barber?.display_name ?? '',
      status: row.status,
      createdAt: row.created_at,
      lookThumbnailUrl: lookPath ? (looks.get(lookPath) ?? null) : null,
      afterPhotoUrl: row.after_photo_path ? (afters.get(row.after_photo_path) ?? null) : null,
    };
  });
}

// The shop's latest visits, newest first.
export async function listRecentVisits(): Promise<VisitSummary[]> {
  const { data, error } = await summaryQuery().limit(RECENT_VISITS_LIMIT);
  if (error) throw error;
  return toSummaries(data);
}

// The shop's visits still open that started since midnight on this device.
export async function listOpenVisitsToday(): Promise<VisitSummary[]> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const { data, error } = await summaryQuery().eq('status', 'open').gte('created_at', midnight.toISOString());
  if (error) throw error;
  return toSummaries(data);
}

// A client's visits, newest first.
export async function listClientVisits(clientId: string): Promise<VisitSummary[]> {
  const { data, error } = await summaryQuery().eq('client_id', clientId);
  if (error) throw error;
  return toSummaries(data);
}

export async function startVisit(input: NewVisit): Promise<Visit> {
  return notImplemented('startVisit');
}

export async function chooseLook(visitId: string, look: Look): Promise<Visit> {
  return notImplemented('chooseLook');
}

export async function closeVisit(visitId: string): Promise<Visit> {
  return notImplemented('closeVisit');
}
