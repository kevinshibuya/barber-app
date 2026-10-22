import type { PhotoSlot, Preview, PreviewStatus, StyleDimension } from '@barber/shared';
import type { CatalogStyle, VisitPreview } from '@/api';

export function style(dimension: StyleDimension, slug: string, name: string, sortOrder: number): CatalogStyle {
  const keep = slug === 'keep';
  return {
    id: `${dimension}-${slug}`,
    dimension,
    slug,
    name,
    referenceImagePath: keep ? null : `${dimension}/${slug}.png`,
    prompt: keep ? null : `give them a ${name}`,
    sortOrder,
    active: true,
    referenceImageUrl: keep ? null : `https://styles.test/${dimension}/${slug}.png`,
  };
}

// Out of order on purpose: the grid follows the sort order.
export const CATALOG: CatalogStyle[] = [
  style('hair', 'quiff', 'Topete', 3),
  style('hair', 'keep', 'Manter como está', 0),
  style('hair', 'low-fade', 'Degradê baixo', 1),
  style('hair', 'buzz-cut', 'Máquina', 2),
  style('beard', 'keep', 'Manter como está', 0),
  style('beard', 'stubble', 'Barba por fazer', 1),
  style('beard', 'goatee', 'Cavanhaque', 2),
];

// A preview of a hair slug and a beard slug ('keep' for either) on one slot,
// as the subscription delivers it. Its id names the pair and, off the front,
// the slot: `pv-low-fade`, `pv-low-fade+goatee`, `pv-low-fade@left`.
export function pairPreview(
  hair: string,
  beard: string,
  status: PreviewStatus,
  { slot = 'front', ...overrides }: Partial<Preview> & { slot?: PhotoSlot } = {},
): VisitPreview {
  const pair = [hair, beard].filter((slug) => slug !== 'keep').join('+');
  const id = slot === 'front' ? `pv-${pair}` : `pv-${pair}@${slot}`;
  const done = status === 'done';
  return {
    id,
    visitId: 'v1',
    hairStyleId: `hair-${hair}`,
    beardStyleId: `beard-${beard}`,
    slot,
    status,
    attemptCount: status === 'failed' ? 3 : 0,
    priority: beard === 'keep' ? 20 : 10,
    notBefore: '2026-10-22T14:00:00.000Z',
    storagePath: done ? `s1/v1/${id}.jpg` : null,
    thumbnailPath: done ? `s1/v1/${id}.thumb.jpg` : null,
    error: null,
    claimedAt: null,
    completedAt: null,
    purgedAt: null,
    createdAt: '2026-10-22T14:00:00.000Z',
    thumbnailUrl: done ? `https://previews.test/${id}.thumb.jpg` : null,
    imageUrl: done ? `https://previews.test/${id}.jpg` : null,
    ...overrides,
  };
}

// A front-photo preview of one style, the other dimension kept.
export function previewOf(slug: string, status: PreviewStatus, overrides: Partial<Preview> = {}): VisitPreview {
  const dimension = CATALOG.find((entry) => entry.slug === slug && entry.slug !== 'keep')!.dimension;
  return dimension === 'hair'
    ? pairPreview(slug, 'keep', status, overrides)
    : pairPreview('keep', slug, status, overrides);
}
