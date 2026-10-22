import {
  previewImagePath,
  previewThumbnailPath,
  STORAGE_BUCKETS,
  type StorageBucket,
  type Tables,
  type Visit,
  type VisitStatus,
} from '@barber/shared';
import { supabase } from './supabase';

export interface NewVisit {
  // Generated on the device, so a visit started on bad wifi is one row once online.
  id: string;
  clientId: string;
  consentGiven: true;
}

// The hair and beard styles the client chose, keep included, and the preview
// they were chosen from: null for hair keep with beard keep, whose image is
// the front photo itself.
export interface Look {
  hairStyleId: string;
  beardStyleId: string;
  previewId: string | null;
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

type VisitRow = Tables<'visits'>;

function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    shopId: row.shop_id,
    clientId: row.client_id,
    barberId: row.barber_id,
    consentGiven: row.consent_given,
    consentAt: row.consent_at,
    status: row.status,
    chosenHairStyleId: row.chosen_hair_style_id,
    chosenBeardStyleId: row.chosen_beard_style_id,
    chosenPreviewId: row.chosen_preview_id,
    afterPhotoPath: row.after_photo_path,
    shareToken: row.share_token,
    shareExpiresAt: row.share_expires_at,
    providerName: row.provider_name,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

// Opens a visit for the client, run by the signed-in barber, with consent
// recorded now. Starting the same id again returns the visit already there,
// so a retry after a lost response is still one visit.
export async function startVisit(input: NewVisit): Promise<Visit> {
  const [session, shop] = await Promise.all([supabase().auth.getSession(), supabase().rpc('current_shop_id')]);
  if (session.error) throw session.error;
  if (shop.error) throw shop.error;
  const barberId = session.data.session?.user.id;
  if (!barberId || !shop.data) throw new Error('the signed-in user is not a barber of any shop');

  const { error } = await supabase()
    .from('visits')
    .upsert(
      {
        id: input.id,
        shop_id: shop.data,
        client_id: input.clientId,
        barber_id: barberId,
        consent_given: input.consentGiven,
        consent_at: new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw error;
  const { data, error: readError } = await supabase().from('visits').select('*').eq('id', input.id).single();
  if (readError) throw readError;
  return toVisit(data);
}

export async function getVisit(visitId: string): Promise<Visit> {
  const { data, error } = await supabase().from('visits').select('*').eq('id', visitId).single();
  if (error) throw error;
  return toVisit(data);
}

// Records the look on the visit, replacing one chosen before.
export async function chooseLook(visitId: string, look: Look): Promise<Visit> {
  const { data, error } = await supabase()
    .from('visits')
    .update({
      chosen_hair_style_id: look.hairStyleId,
      chosen_beard_style_id: look.beardStyleId,
      chosen_preview_id: look.previewId,
    })
    .eq('id', visitId)
    .select('*')
    .single();
  if (error) throw error;
  return toVisit(data);
}

// A visit as the finish screen shows it, with signed URLs of the chosen
// look's image (the front photo for keep with keep, null before a choice)
// and of the after photo.
export interface VisitDetail {
  visit: Visit;
  lookImageUrl: string | null;
  afterPhotoUrl: string | null;
}

// The chosen look's object: the preview's image, or the front photo for keep
// with keep. A chosen preview is never purged, so its image sits at the fixed path.
async function lookObject(visit: Visit): Promise<{ bucket: StorageBucket; path: string } | null> {
  if (visit.chosenPreviewId) {
    return { bucket: STORAGE_BUCKETS.previews, path: previewImagePath(visit.shopId, visit.id, visit.chosenPreviewId) };
  }
  if (!visit.chosenHairStyleId || !visit.chosenBeardStyleId) return null;
  const { data, error } = await supabase()
    .from('photos')
    .select('storage_path')
    .eq('visit_id', visit.id)
    .eq('slot', 'front')
    .maybeSingle();
  if (error) throw error;
  return data ? { bucket: STORAGE_BUCKETS.originals, path: data.storage_path } : null;
}

export async function getVisitDetail(visitId: string): Promise<VisitDetail> {
  const visit = await getVisit(visitId);
  const look = await lookObject(visit);
  const [looks, afters] = await Promise.all([
    look ? signPaths(look.bucket, [look.path]) : new Map<string, string>(),
    signPaths(STORAGE_BUCKETS.originals, visit.afterPhotoPath ? [visit.afterPhotoPath] : []),
  ]);
  return {
    visit,
    lookImageUrl: look ? (looks.get(look.path) ?? null) : null,
    afterPhotoUrl: visit.afterPhotoPath ? (afters.get(visit.afterPhotoPath) ?? null) : null,
  };
}

// Closes the visit now, with or without an after photo.
export async function closeVisit(visitId: string): Promise<Visit> {
  const { data, error } = await supabase()
    .from('visits')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', visitId)
    .select('*')
    .single();
  if (error) throw error;
  return toVisit(data);
}
