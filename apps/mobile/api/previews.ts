import type { PhotoSlot, Preview } from '@barber/shared';
import { notImplemented } from './not-implemented';

export interface PreviewRequest {
  visitId: string;
  hairStyleId: string;
  beardStyleId: string;
  slot: PhotoSlot;
}

export type Unsubscribe = () => void;

// Calls `onChange` with every preview of the visit each time one changes.
export function subscribeToPreviews(
  visitId: string,
  onChange: (previews: Preview[]) => void,
): Unsubscribe {
  return notImplemented('subscribeToPreviews');
}

export async function requestPreview(request: PreviewRequest): Promise<Preview> {
  return notImplemented('requestPreview');
}

export async function retryPreview(previewId: string): Promise<Preview> {
  return notImplemented('retryPreview');
}
