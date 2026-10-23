// The preview queue's database functions, as the app and the worker call them
// through `rpc`. `request_preview`, `complete_preview` and `fail_preview`
// return zero or one row, so a caller reads them with `.maybeSingle()`; the
// signatures here give each result as the caller then holds it.
import type { Database, Tables } from './database';
import type { PreviewStatus } from './domain';

export type PreviewRow = Tables<'previews'>;

type QueueFunctions = Database['public']['Functions'];

// Claim order, higher first, as the database's `preview_priority` assigns it:
// on-demand requests, then the front photo's hair styles, then its beard
// styles.
export const PREVIEW_PRIORITY = {
  request: 30,
  hair: 20,
  beard: 10,
} as const;

// The statuses `fail_preview` accepts: `pending` is a retryable failure.
export type PreviewFailure = Extract<PreviewStatus, 'pending' | 'failed' | 'refused'>;

export interface PreviewQueueSignatures {
  // Worker. `stale_after` is a Postgres interval such as '5 minutes'.
  claim_previews: {
    args: QueueFunctions['claim_previews']['Args'];
    returns: PreviewRow[];
  };
  // Worker. Null when the row is no longer running (a retake deleted it).
  complete_preview: {
    args: QueueFunctions['complete_preview']['Args'];
    returns: PreviewRow | null;
  };
  // Worker. `retry_at` (ISO timestamp) applies to `pending`; null when the
  // row is no longer running.
  fail_preview: {
    args: Omit<QueueFunctions['fail_preview']['Args'], 'status'> & { status: PreviewFailure };
    returns: PreviewRow | null;
  };
  // Barber. Null for hair keep with beard keep: the original photo is the
  // result.
  request_preview: {
    args: QueueFunctions['request_preview']['Args'];
    returns: PreviewRow | null;
  };
  // Barber. Returns the row, reset when it had failed.
  retry_preview: {
    args: QueueFunctions['retry_preview']['Args'];
    returns: PreviewRow;
  };
}

export type PreviewQueueFunction = keyof PreviewQueueSignatures;
export type PreviewQueueArgs<F extends PreviewQueueFunction> = PreviewQueueSignatures[F]['args'];
export type PreviewQueueResult<F extends PreviewQueueFunction> = PreviewQueueSignatures[F]['returns'];
