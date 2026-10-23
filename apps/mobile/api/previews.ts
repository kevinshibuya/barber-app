import { type PhotoSlot, type Preview, type PreviewRow, STORAGE_BUCKETS } from '@barber/shared';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { reportLink } from './connectivity';
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
// A channel that errors is subscribed again after this long, doubling up to
// the ceiling while it keeps failing.
export const PREVIEW_RESUBSCRIBE_MS = 1000;
const PREVIEW_RESUBSCRIBE_MAX_MS = 30_000;
// Long enough for the picker to stay open through a cut.
const SIGNED_URL_SECONDS = 60 * 60;
// A signed URL is used until this long before it expires, then signed again.
export const PREVIEW_RESIGN_MS = (SIGNED_URL_SECONDS - 5 * 60) * 1000;

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
// the channel is unhealthy they are polled instead, and the channel is
// dropped and subscribed again, after a delay that doubles from
// `resubscribeMs` up to a ceiling, until one reports healthy and reads once
// to catch what the gap missed. A read that fails is tried again after
// `pollMs` even while the channel is healthy. Each done row's paths are
// signed once and signed again before the URLs expire, which a read every
// PREVIEW_RESIGN_MS sees to on a picker left open. `onLink` hears every
// health report.
export function previewFeed(
  transport: PreviewsTransport,
  {
    pollMs = PREVIEW_POLL_MS,
    resubscribeMs = PREVIEW_RESUBSCRIBE_MS,
    onLink,
  }: { pollMs?: number; resubscribeMs?: number; onLink?: (up: boolean) => void } = {},
) {
  return function subscribe(visitId: string, onChange: (previews: VisitPreview[]) => void): Unsubscribe {
    const urls = new Map<string, { url: string; signedAt: number }>();
    let closed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let resubscribe: ReturnType<typeof setTimeout> | null = null;
    let delay = resubscribeMs;
    let latest = 0;
    // Each channel's callbacks count only while it is the current one.
    let channel = 0;
    let stopListening: Unsubscribe = () => undefined;

    async function read() {
      const ticket = ++latest;
      try {
        const previews = await transport.list(visitId);
        const now = Date.now();
        const unsigned = previews
          .filter((preview) => preview.status === 'done' && !preview.purgedAt)
          .flatMap((preview) => [preview.thumbnailPath, preview.storagePath])
          .filter((path): path is string => {
            const signed = path === null ? undefined : urls.get(path);
            return path !== null && (!signed || now - signed.signedAt >= PREVIEW_RESIGN_MS);
          });
        if (unsigned.length > 0) {
          for (const [path, url] of await transport.sign(unsigned)) urls.set(path, { url, signedAt: now });
        }
        // A slower read that started earlier never overwrites a newer one.
        if (closed || ticket !== latest) return;
        onChange(
          previews.map((preview) => ({
            ...preview,
            thumbnailUrl: preview.thumbnailPath ? (urls.get(preview.thumbnailPath)?.url ?? null) : null,
            imageUrl: preview.storagePath ? (urls.get(preview.storagePath)?.url ?? null) : null,
          })),
        );
      } catch {
        // A poll reads again; with the channel healthy, nothing else may.
        if (!closed && !poll) {
          retry ??= setTimeout(() => {
            retry = null;
            void read();
          }, pollMs);
        }
      }
    }

    function stopPolling() {
      if (poll) clearInterval(poll);
      poll = null;
    }

    function listen() {
      const mine = ++channel;
      stopListening = transport.listen(
        visitId,
        () => {
          if (mine === channel) void read();
        },
        (healthy) => {
          if (closed || mine !== channel) return;
          onLink?.(healthy);
          if (healthy) {
            delay = resubscribeMs;
            stopPolling();
            void read();
          } else {
            lost();
          }
        },
      );
    }

    function lost() {
      poll ??= setInterval(() => void read(), pollMs);
      // Removing the channel reports it closed, which no one hears any more.
      channel += 1;
      stopListening();
      resubscribe = setTimeout(() => {
        resubscribe = null;
        if (!closed) listen();
      }, delay);
      delay = Math.min(delay * 2, PREVIEW_RESUBSCRIBE_MAX_MS);
    }

    listen();
    void read();
    const resign = setInterval(() => void read(), PREVIEW_RESIGN_MS);

    return () => {
      closed = true;
      stopPolling();
      clearInterval(resign);
      if (retry) clearTimeout(retry);
      if (resubscribe) clearTimeout(resubscribe);
      channel += 1;
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

let channels = 0;

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
    // A fresh topic per listen, so a channel still closing never answers for
    // the one that replaces it.
    const channel = supabase()
      .channel(`previews:${visitId}:${++channels}`)
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

const subscribeWithSupabase = previewFeed(supabaseTransport, { onLink: (up) => reportLink('previews', up) });

// Calls `onChange` with every preview of the visit, now and each time one
// changes, until unsubscribed. A dropped connection is subscribed again once
// it returns, and the previews done meanwhile arrive then.
export function subscribeToPreviews(visitId: string, onChange: (previews: VisitPreview[]) => void): Unsubscribe {
  const unsubscribe = subscribeWithSupabase(visitId, onChange);
  return () => {
    unsubscribe();
    // A closed picker no longer knows how the channel is.
    reportLink('previews', true);
  };
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
