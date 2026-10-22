// What the picker shows, derived from the catalog and the visit's previews.
// Pure, with no network, so the screen stays a layout over it.
import { KEEP_STYLE_SLUG, type StyleDimension } from '@barber/shared';
import type { CatalogStyle, VisitPreview } from '@/api';

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

// The front-photo preview of a pair of styles, if the visit has one.
export function previewFor(
  previews: VisitPreview[],
  hairStyleId: string,
  beardStyleId: string,
): VisitPreview | null {
  return (
    previews.find(
      (preview) =>
        preview.slot === 'front' && preview.hairStyleId === hairStyleId && preview.beardStyleId === beardStyleId,
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

// What the large preview shows for the selected pair, and what choosing it
// records. Hair keep with beard keep is the front photo, with no preview.
// Otherwise it is the selected hair's preview, or the beard's when hair is
// kept; a hair and a beard together show the hair until combinations render.
export interface LookPreview {
  imageUrl: string | null;
  ready: boolean;
  previewId: string | null;
}

export function lookFor(
  selection: Selection,
  catalog: Catalog,
  previews: VisitPreview[],
  frontPhotoUrl: string | null,
): LookPreview {
  const hairKept = selection.hair === catalog.keep.hair.id;
  const beardKept = selection.beard === catalog.keep.beard.id;
  if (hairKept && beardKept) return { imageUrl: frontPhotoUrl, ready: true, previewId: null };

  const dimension: StyleDimension = hairKept ? 'beard' : 'hair';
  const tile = tilesFor(dimension, catalog, previews, frontPhotoUrl).find(
    (candidate) => candidate.style.id === selection[dimension],
  );
  if (!tile) return { imageUrl: null, ready: false, previewId: null };
  if (tile.status === 'done' && tile.preview) {
    return { imageUrl: tile.preview.imageUrl ?? tile.imageUrl, ready: true, previewId: tile.preview.id };
  }
  return { imageUrl: tile.style.referenceImageUrl, ready: false, previewId: null };
}

// Whether a tap on the tile selects it: a failed tile retries instead, and a
// refused one does nothing.
export function selectable(tile: Tile): boolean {
  return tile.status !== 'failed' && tile.status !== 'refused';
}
