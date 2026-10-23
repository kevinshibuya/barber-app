// What the client page shows for a share token, read through the service role:
// the shop's name, the before photos, the chosen look, every done preview and
// the after photo. Each image is a signed URL minted for this page load.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  KEEP_STYLE_SLUG,
  PHOTO_SLOTS,
  type PhotoSlot,
  SHARE_TOKEN_LENGTH,
  STORAGE_BUCKETS,
  visitObjectPrefix,
} from '@barber/shared';
import { strings } from './strings';

// Long enough to look through the page, short enough that a copied image URL
// dies soon after.
export const IMAGE_URL_TTL_SECONDS = 60 * 60;

const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${SHARE_TOKEN_LENGTH}}$`);

export interface BeforePhoto {
  slot: PhotoSlot;
  label: string;
  url: string;
}

export interface PreviewItem {
  id: string;
  // The generated styles' names, with the angle when it is not the front.
  name: string;
  url: string;
  chosen: boolean;
}

export interface Look {
  name: string;
  url: string;
}

export interface ClientPageView {
  shopName: string;
  before: BeforePhoto[];
  // Null until a look is chosen.
  look: Look | null;
  previews: PreviewItem[];
  afterUrl: string | null;
}

interface StyleRef {
  slug: string;
  name: string;
  sort_order: number;
}

interface PreviewRef {
  id: string;
  slot: PhotoSlot;
  storage_path: string | null;
  hair: StyleRef;
  beard: StyleRef;
}

const isKeep = (style: { slug: string }) => style.slug === KEEP_STYLE_SLUG;

// Hair styles first, then beard styles, then combinations, as the picker's
// tabs order them; within those by the catalog's order, then the angle.
function stripOrder(a: PreviewRef, b: PreviewRef): number {
  const kind = (p: PreviewRef) => (isKeep(p.beard) ? 0 : isKeep(p.hair) ? 1 : 2);
  return (
    kind(a) - kind(b) ||
    a.hair.sort_order - b.hair.sort_order ||
    a.beard.sort_order - b.beard.sort_order ||
    PHOTO_SLOTS.indexOf(a.slot) - PHOTO_SLOTS.indexOf(b.slot)
  );
}

function previewName(p: PreviewRef): string {
  const name = [p.hair, p.beard]
    .filter((s) => !isKeep(s))
    .map((s) => s.name)
    .join(' + ');
  return p.slot === 'front' ? name : `${name} · ${strings.slots[p.slot]}`;
}

export class ClientPage {
  constructor(private readonly db: SupabaseClient<Database>) {}

  // Null when the token names no live link: unknown, cleared or expired.
  async load(token: string): Promise<ClientPageView | null> {
    if (!TOKEN_SHAPE.test(token)) return null;
    const { data: visit, error } = await this.db
      .from('visits')
      .select(
        'id, shop_id, chosen_preview_id, after_photo_path, shop:shops(name), chosen_hair:styles!visits_chosen_hair_style_id_fkey(slug), chosen_beard:styles!visits_chosen_beard_style_id_fkey(slug)',
      )
      .eq('share_token', token)
      .gt('share_expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!visit?.shop) return null;

    const [photos, previews] = await Promise.all([
      this.db.from('photos').select('slot, storage_path').eq('visit_id', visit.id).eq('upload_status', 'uploaded'),
      this.db
        .from('previews')
        .select(
          'id, slot, storage_path, hair:styles!previews_hair_style_id_fkey(slug, name, sort_order), beard:styles!previews_beard_style_id_fkey(slug, name, sort_order)',
        )
        .eq('visit_id', visit.id)
        .eq('status', 'done')
        .is('purged_at', null)
        .not('storage_path', 'is', null),
    ]);
    if (photos.error) throw photos.error;
    if (previews.error) throw previews.error;

    const prefix = visitObjectPrefix(visit.shop_id, visit.id);
    const originals = await this.sign(STORAGE_BUCKETS.originals, prefix, [
      ...photos.data.map((p) => p.storage_path),
      ...(visit.after_photo_path ? [visit.after_photo_path] : []),
    ]);
    const previewUrls = await this.sign(
      STORAGE_BUCKETS.previews,
      prefix,
      previews.data.flatMap((p) => (p.storage_path ? [p.storage_path] : [])),
    );

    // An object missing from storage drops its image rather than break the page.
    const before = photos.data
      .flatMap((p) => {
        const url = originals.get(p.storage_path);
        return url ? [{ slot: p.slot, label: strings.slots[p.slot], url }] : [];
      })
      .sort((a, b) => PHOTO_SLOTS.indexOf(a.slot) - PHOTO_SLOTS.indexOf(b.slot));
    const items = previews.data.sort(stripOrder).flatMap((p) => {
      const url = p.storage_path ? previewUrls.get(p.storage_path) : undefined;
      return url ? [{ id: p.id, name: previewName(p), url, chosen: p.id === visit.chosen_preview_id }] : [];
    });

    let look: Look | null = null;
    const chosen = items.find((item) => item.chosen);
    if (chosen) {
      look = { name: chosen.name, url: chosen.url };
    } else if (visit.chosen_hair && visit.chosen_beard && isKeep(visit.chosen_hair) && isKeep(visit.chosen_beard)) {
      // Keep plus keep has no preview: the look is the client as they came in.
      const front = before.find((p) => p.slot === 'front');
      if (front) look = { name: strings.keep, url: front.url };
    }

    return {
      shopName: visit.shop.name,
      before,
      look,
      previews: items,
      afterUrl: visit.after_photo_path ? (originals.get(visit.after_photo_path) ?? null) : null,
    };
  }

  // Each path's signed URL; a path storage could not sign is left out, and so
  // is a path outside the visit's prefix, which names another visit's object.
  private async sign(bucket: string, prefix: string, paths: string[]): Promise<Map<string, string>> {
    const own = paths.filter((path) => path.startsWith(prefix));
    if (own.length === 0) return new Map();
    const { data, error } = await this.db.storage.from(bucket).createSignedUrls(own, IMAGE_URL_TTL_SECONDS);
    if (error) throw error;
    return new Map(data.flatMap((s) => (s.path && s.signedUrl && !s.error ? [[s.path, s.signedUrl]] : [])));
  }
}
