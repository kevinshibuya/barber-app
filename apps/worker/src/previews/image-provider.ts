// The seam every image model sits behind. The worker hands a provider the
// image to edit, the style's reference images and the style's prompt, and gets
// back image bytes or a typed failure. A provider never throws for a vendor's
// answer; the worker treats a throw as a retryable failure all the same.
import type { ImageProviderName } from '@barber/shared';

export interface RenderRequest {
  // The image to edit: the client's photo of the slot, or for a combination
  // the done hair-only preview of the slot.
  base: Buffer;
  // The style's reference images, one or more.
  references: Buffer[];
  prompt: string;
}

// `retryable` is worth another attempt (a rate limit, a server error);
// `refused` is the model's safety refusal and is never retried.
export type RenderFailure = 'retryable' | 'refused';

export type RenderResult =
  | { ok: true; image: Buffer }
  | { ok: false; failure: RenderFailure; message: string };

export interface ImageProvider {
  // Recorded on the visit when its first preview completes.
  readonly name: ImageProviderName;
  render(request: RenderRequest): Promise<RenderResult>;
}
