// What the real providers share: the HTTP call, the mapping of a vendor's
// failed answer to a RenderFailure, and the instruction that tells a model
// which image it edits. Every provider takes its `fetch`, so tests fake HTTP
// at the transport.
import type { RenderRequest, RenderResult } from './image-provider';

export interface HttpProviderOptions {
  apiKey: string;
  fetch?: typeof fetch;
  // A call still unanswered after this is a retryable failure.
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 120_000;

// The output size every provider asks for, on the long edge.
export const OUTPUT_LONG_EDGE = 1024;

export type Failed = Extract<RenderResult, { ok: false }>;

export function retryable(message: string): Failed {
  return { ok: false, failure: 'retryable', message };
}

export function refused(message: string): Failed {
  return { ok: false, failure: 'refused', message };
}

// The image's MIME type from its first bytes; the worker hands providers JPEG
// photos and previews and PNG references.
export function mimeType(image: Buffer): string {
  if (image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (image.subarray(0, 4).toString('latin1') === 'RIFF' && image.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

// The catalog's prompts speak of "the person"; this says which image that is.
export function editInstruction(request: RenderRequest): string {
  const references = request.references.length === 1 ? 'The second image shows' : 'The other images show';
  return (
    `Edit the first image, a photo of a person. ${references} the style to give them, ` +
    `as a reference only: do not copy anything else from it. ${request.prompt}`
  );
}

export type HttpAnswer = { ok: true; status: number; body: unknown } | Failed;

// POSTs JSON and reads the JSON answer. A transport error, a timeout or an
// answer that is not JSON is retryable; the status is the caller's to judge.
export async function postJson(
  options: HttpProviderOptions,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<HttpAnswer> {
  const send = options.fetch ?? fetch;
  let response: Response;
  let text: string;
  try {
    response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    return retryable(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { ok: true, status: response.status, body: text === '' ? null : JSON.parse(text) };
  } catch {
    return retryable(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

// An answer whose status is not 2xx and is not a refusal the provider already
// recognised. A rate limit and a server error are worth another attempt, and
// so is anything else: the worker fails the row after its last attempt.
export function httpFailure(status: number, body: unknown): Failed {
  const detail = JSON.stringify(body)?.slice(0, 300) ?? '';
  if (status === 429) return retryable(`rate limited (HTTP 429): ${detail}`);
  if (status >= 500) return retryable(`server error (HTTP ${status}): ${detail}`);
  return retryable(`HTTP ${status}: ${detail}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
