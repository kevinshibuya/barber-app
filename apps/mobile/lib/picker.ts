// What the picker shows, derived from the catalog and the visit's previews.
// Pure, with no network, so the screen stays a layout over it.
import { KEEP_STYLE_SLUG, type PhotoSlot, type StyleDimension } from '@barber/shared';
import type { CatalogStyle, PreviewRequest, VisitPreview } from '@/api';

// A pre-rendered preview fills in until it is done; keep never renders.
export type TileStatus = 'keep' | 'generating' | 'done' | 'failed' | 'refused';

export interface Tile {
  style: CatalogStyle;
  status: TileStatus;
  // The thumbnail once done, the reference image until then; the front photo for keep.
  imageUrl: string | null;
  preview: VisitPreview | null;
}

export interface Catalog {
  hair: CatalogStyle[];
  beard: CatalogStyle[];
  keep: Record<StyleDimension, CatalogStyle>;
}

export type Selection = Record<StyleDimension, string>;

// Each dimension's styles, keep first, then in the catalog's sort order. Null
// when a dimension has no keep style, which the catalog seed rules out.
export function toCatalog(styles: CatalogStyle[]): Catalog | null {
  const sorted = [...styles].sort((a, b) => a.sortOrder - b.sortOrder);
  const of = (dimension: StyleDimension) => {
    const all = sorted.filter((style) => style.dimension === dimension);
    const keep = all.find((style) => style.slug === KEEP_STYLE_SLUG);
    return keep ? { keep, styles: [keep, ...all.filter((style) => style !== keep)] } : null;
  };
  const hair = of('hair');
  const beard = of('beard');
  if (!hair || !beard) return null;
  return { hair: hair.styles, beard: beard.styles, keep: { hair: hair.keep, beard: beard.keep } };
}

// The visit's preview of a pair of styles on one slot, if it has one.
export function previewFor(
  previews: VisitPreview[],
  hairStyleId: string,
  beardStyleId: string,
  slot: PhotoSlot = 'front',
): VisitPreview | null {
  return (
    previews.find(
      (preview) =>
        preview.slot === slot && preview.hairStyleId === hairStyleId && preview.beardStyleId === beardStyleId,
    ) ?? null
  );
}

function statusOf(preview: VisitPreview | null): TileStatus {
  if (!preview || preview.status === 'pending' || preview.status === 'running') return 'generating';
  return preview.status;
}

// The tiles of one tab: each style rendered with the other dimension kept.
export function tilesFor(
  dimension: StyleDimension,
  catalog: Catalog,
  previews: VisitPreview[],
  frontPhotoUrl: string | null,
): Tile[] {
  return catalog[dimension].map((style) => {
    if (style === catalog.keep[dimension]) return { style, status: 'keep', imageUrl: frontPhotoUrl, preview: null };
    const preview =
      dimension === 'hair'
        ? previewFor(previews, style.id, catalog.keep.beard.id)
        : previewFor(previews, catalog.keep.hair.id, style.id);
    const status = statusOf(preview);
    const imageUrl = status === 'done' ? (preview?.thumbnailUrl ?? style.referenceImageUrl) : style.referenceImageUrl;
    return { style, status, imageUrl, preview };
  });
}

// The selected pair on one slot, as the large preview and the full-screen
// pages show it, and what choosing it records. Hair keep with beard keep is
// the slot's photo, with no preview. A single style on the front photo is
// pre-rendered; a hair and a beard together, or any style on another slot,
// renders on demand. Until the look is done, a combination shows its hair
// preview underneath, and anything else shows the style's reference image on
// the front and the slot's photo elsewhere.
export type LookStatus = 'done' | 'generating' | 'combining' | 'failed' | 'refused';

export type PairRequest = Omit<PreviewRequest, 'visitId'>;

export interface LookPreview {
  slot: PhotoSlot;
  status: LookStatus;
  combination: boolean;
  imageUrl: string | null;
  // What choosing records: the done preview, or null for keep with keep.
  previewId: string | null;
  // The row the look waits on, once it exists.
  preview: VisitPreview | null;
  // The pair to ask the database for while its row is missing.
  request: PairRequest | null;
}

export function lookFor(
  selection: Selection,
  catalog: Catalog,
  previews: VisitPreview[],
  slot: PhotoSlot,
  photoUrl: string | null,
): LookPreview {
  const hairKept = selection.hair === catalog.keep.hair.id;
  const beardKept = selection.beard === catalog.keep.beard.id;
  const combination = !hairKept && !beardKept;
  const look = { slot, combination, preview: null, request: null };
  if (hairKept && beardKept) return { ...look, status: 'done', imageUrl: photoUrl, previewId: null };

  const preview = previewFor(previews, selection.hair, selection.beard, slot);
  if (preview?.status === 'done') {
    return {
      ...look,
      status: 'done',
      imageUrl: preview.imageUrl ?? preview.thumbnailUrl,
      previewId: preview.id,
      preview,
    };
  }

  const ended = preview?.status === 'failed' || preview?.status === 'refused' ? preview.status : null;
  const shown: StyleDimension = hairKept ? 'beard' : 'hair';
  const reference = catalog[shown].find((style) => style.id === selection[shown])?.referenceImageUrl ?? null;
  let imageUrl = slot === 'front' ? reference : photoUrl;
  if (combination) {
    const base = previewFor(previews, selection.hair, catalog.keep.beard.id, slot);
    if (base?.status === 'done') imageUrl = base.imageUrl ?? base.thumbnailUrl;
  }
  const onDemand = combination || slot !== 'front';
  return {
    ...look,
    status: ended ?? (combination ? 'combining' : 'generating'),
    imageUrl,
    previewId: null,
    preview,
    request: onDemand && !preview ? { hairStyleId: selection.hair, beardStyleId: selection.beard, slot } : null,
  };
}

// One key per pair and slot.
export function requestKey(request: PairRequest): string {
  return `${request.hairStyleId}|${request.beardStyleId}|${request.slot}`;
}

// Whether a tap on the tile selects it: a failed tile retries instead, and a
// refused one does nothing.
export function selectable(tile: Tile): boolean {
  return tile.status !== 'failed' && tile.status !== 'refused';
}
