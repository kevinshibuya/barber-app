// How the upload queue tells a send no retry can fix from one the network
// failed. Pure, so tests import it directly.

// A queued shot whose file is gone from the device: no retry can send it.
export class MissingShotError extends Error {}

// Whether a failed send can never succeed: the database or storage refused
// the upload itself (a policy, a constraint, a row it cannot see), or its
// shot is gone. Network failures, timeouts and server errors are retried.
export function isPermanentUploadError(error: unknown): boolean {
  if (error instanceof MissingShotError) return true;
  if (!error || typeof error !== 'object') return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (typeof status === 'number' && status > 0) {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }
  if (typeof code !== 'string') return false;
  // Postgres refusals: bad data, a constraint, access, a locked look, a raise.
  if (/^(22|23|42|55|P0)/.test(code)) return true;
  // `.single()` found no row the barber may see.
  return code === 'PGRST116';
}
