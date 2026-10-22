import { type PhotoSlot, type Preview, type PreviewRow, STORAGE_BUCKETS } from '@barber/shared';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface PreviewRequest {
  visitId: string;
  hairStyleId: string;
  beardStyleId: string;
  slot: PhotoSlot;
}

// A preview as the picker shows it: signed URLs of its thumbnail and its
// image once it is done.
export interface VisitPreview extends Preview {
  thumbnailUrl: string | null;
  imageUrl: string | null;
}

export type Unsubscribe = () => void;

// While Realtime is down, the picker reads the visit's previews this often.
export const PREVIEW_POLL_MS = 5000;
// Long enough for the picker to stay open through a cut.
const SIGNED_URL_SECONDS = 60 * 60;

// Everything the previews feed sends over the network.
export interface PreviewsTransport {
  // Every preview row of the visit.
  list(visitId: string): Promise<Preview[]>;
  // Signed URLs in the previews bucket, by path; a missing object maps to nothing.
  sign(paths: string[]): Promise<Map<string, string>>;
  // Listens for changes to the visit's previews. `onHealth` reports whether
  // the channel is subscribed (true) or has errored, timed out or closed (false).
  listen(visitId: string, onChange: () => void, onHealth: (healthy: boolean) => void): Unsubscribe;
}

// The visit's previews, read again on every change Realtime reports. While
// the channel is unhealthy they are polled instead, and a channel that
// recovers reads once to catch what it missed. Each done row's paths are
// signed once per subscription.
export function previewFeed(transport: PreviewsTransport, pollMs = PREVIEW_POLL_MS) {
  return function subscribe(visitId: string, onChange: (previews: VisitPreview[]) => void): Unsubscribe {
    const urls = new Map<string, string>();
    let closed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let latest = 0;

    async function read() {
      const ticket = ++latest;
      try {
        const previews = await transport.list(visitId);
        const unsigned = previews
          .filter((preview) => preview.status === 'done' && !preview.purgedAt)
          .flatMap((preview) => [preview.thumbnailPath, preview.storagePath])
          .filter((path): path is string => path !== null && !urls.has(path));
        if (unsigned.length > 0) {
          for (const [path, url] of await transport.sign(unsigned)) urls.set(path, url);
        }
        // A slower read that started earlier never overwrites a newer one.
        if (closed || ticket !== latest) return;
        onChange(
          previews.map((preview) => ({
            ...preview,
            thumbnailUrl: preview.thumbnailPath ? (urls.get(preview.thumbnailPath) ?? null) : null,
            imageUrl: preview.storagePath ? (urls.get(preview.storagePath) ?? null) : null,
          })),
        );
      } catch {
        // The next change or poll reads again.
      }
    }

    function stopPolling() {
      if (poll) clearInterval(poll);
      poll = null;
    }

    const stopListening = transport.listen(
      visitId,
      () => void read(),
      (healthy) => {
        if (closed) return;
        if (healthy) {
          stopPolling();
          void read();
        } else if (!poll) {
          poll = setInterval(() => void read(), pollMs);
        }
      },
    );
    void read();

    return () => {
      closed = true;
      stopPolling();
      stopListening();
    };
  };
}

export function toPreview(row: PreviewRow): Preview {
  return {
    id: row.id,
    visitId: row.visit_id,
    hairStyleId: row.hair_style_id,
    beardStyleId: row.beard_style_id,
    slot: row.slot,
    status: row.status,
    attemptCount: row.attempt_count,
    priority: row.priority,
    notBefore: row.not_before,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    error: row.error,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    purgedAt: row.purged_at,
    createdAt: row.created_at,
  };
}

const UNHEALTHY_STATES: string[] = [
  REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
  REALTIME_SUBSCRIBE_STATES.TIMED_OUT,
  REALTIME_SUBSCRIBE_STATES.CLOSED,
];

const supabaseTransport: PreviewsTransport = {
  async list(visitId) {
    const { data, error } = await supabase().from('previews').select('*').eq('visit_id', visitId);
    if (error) throw error;
    return data.map(toPreview);
  },

  async sign(paths) {
    const { data, error } = await supabase()
      .storage.from(STORAGE_BUCKETS.previews)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) throw error;
    const signed = new Map<string, string>();
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) signed.set(item.path, item.signedUrl);
    }
    return signed;
  },

  listen(visitId, onChange, onHealth) {
    const channel = supabase()
      .channel(`previews:${visitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'previews', filter: `visit_id=eq.${visitId}` },
        () => onChange(),
      )
      .subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) onHealth(true);
        else if (UNHEALTHY_STATES.includes(status)) onHealth(false);
      });
    return () => void supabase().removeChannel(channel);
  },
};

const subscribeWithSupabase = previewFeed(supabaseTransport);

// Calls `onChange` with every preview of the visit, now and each time one
// changes, until unsubscribed.
export function subscribeToPreviews(visitId: string, onChange: (previews: VisitPreview[]) => void): Unsubscribe {
  return subscribeWithSupabase(visitId, onChange);
}

// The visit's preview of the pair on the slot, added at request priority when
// missing; a repeat request returns the same row. Keep with keep renders
// nothing and comes back null.
export async function requestPreview(request: PreviewRequest): Promise<Preview | null> {
  const { data, error } = await supabase()
    .rpc('request_preview', {
      visit_id: request.visitId,
      hair_style_id: request.hairStyleId,
      beard_style_id: request.beardStyleId,
      slot: request.slot,
    })
    .maybeSingle();
  if (error) throw error;
  return data ? toPreview(data) : null;
}

// Resets a failed preview to pending; any other preview comes back as it is.
export async function retryPreview(previewId: string): Promise<Preview> {
  const { data, error } = await supabase().rpc('retry_preview', { id: previewId }).single();
  if (error) throw error;
  return toPreview(data);
}
