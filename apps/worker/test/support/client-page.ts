// A visit as the app and the worker leave it, seeded through the service role
// for the client page's tests and smoke: an uploaded front photo (whose trigger
// enqueues the front previews) and any other slots, some of those previews
// settled as done with their image stored, and the look and after photo when
// asked for.
import sharp from 'sharp';
import {
  afterPhotoPath,
  KEEP_STYLE_SLUG,
  originalPhotoPath,
  type PhotoSlot,
  previewImagePath,
  previewThumbnailPath,
  type PreviewRow,
  STORAGE_BUCKETS,
  type StyleDimension,
  type Tables,
} from '@barber/shared';
import { type Db, must, type TestShop } from './supabase';

// A hair and a beard slug; `keep` for the dimension left as is.
export interface Pairing {
  hair: string;
  beard: string;
  slot?: PhotoSlot;
}

export interface ClientPageVisitOptions {
  // Slots photographed besides the front.
  slots?: PhotoSlot[];
  // Previews settled as done. A front pairing with one keep is one of the
  // trigger's rows; any other pairing is added as a done row.
  done?: Pairing[];
  // The look: one of the done pairings, or keep plus keep, which has no
  // preview.
  chosen?: Pairing;
  after?: boolean;
}

export interface ClientPageVisit {
  visit: Tables<'visits'>;
  token: string;
  // The done previews, in the order `done` gave them.
  done: PreviewRow[];
}

async function jpeg(background: string): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 80, channels: 3, background } }).jpeg().toBuffer();
}

export async function catalog(service: Db): Promise<Tables<'styles'>[]> {
  return must(await service.from('styles').select('*').order('sort_order'));
}

export function styleId(styles: Tables<'styles'>[], dimension: StyleDimension, slug: string): string {
  const found = styles.find((s) => s.dimension === dimension && s.slug === slug);
  if (!found) throw new Error(`no ${dimension} style ${slug}`);
  return found.id;
}

export function styleName(styles: Tables<'styles'>[], dimension: StyleDimension, slug: string): string {
  const id = styleId(styles, dimension, slug);
  return styles.find((s) => s.id === id)!.name;
}

async function upload(service: Db, bucket: string, path: string, image: Buffer): Promise<void> {
  must(await service.storage.from(bucket).upload(path, image, { contentType: 'image/jpeg', upsert: true }));
}

export async function seedClientPageVisit(
  service: Db,
  shop: TestShop,
  options: ClientPageVisitOptions = {},
): Promise<ClientPageVisit> {
  const styles = await catalog(service);
  const client = must(
    await service.from('clients').insert({ shop_id: shop.id, name: 'Page client' }).select().single(),
  );
  let visit = must(
    await service
      .from('visits')
      .insert({ shop_id: shop.id, client_id: client.id, barber_id: shop.barberId })
      .select()
      .single(),
  );

  for (const slot of ['front', ...(options.slots ?? [])] as PhotoSlot[]) {
    const path = originalPhotoPath(shop.id, visit.id, slot);
    await upload(service, STORAGE_BUCKETS.originals, path, await jpeg('#c33'));
    must(
      await service
        .from('photos')
        .insert({ visit_id: visit.id, slot, storage_path: path, width: 60, height: 80, upload_status: 'uploaded' })
        .select()
        .single(),
    );
  }

  const done: PreviewRow[] = [];
  for (const pairing of options.done ?? []) {
    const hairId = styleId(styles, 'hair', pairing.hair);
    const beardId = styleId(styles, 'beard', pairing.beard);
    const slot = pairing.slot ?? 'front';
    const row = must(
      await service
        .from('previews')
        .upsert(
          { visit_id: visit.id, hair_style_id: hairId, beard_style_id: beardId, slot },
          { onConflict: 'visit_id,hair_style_id,beard_style_id,slot' },
        )
        .select()
        .single(),
    );
    const imagePath = previewImagePath(shop.id, visit.id, row.id);
    const thumbnailPath = previewThumbnailPath(shop.id, visit.id, row.id);
    await upload(service, STORAGE_BUCKETS.previews, imagePath, await jpeg('#777'));
    await upload(service, STORAGE_BUCKETS.previews, thumbnailPath, await jpeg('#777'));
    done.push(
      must(
        await service
          .from('previews')
          .update({
            status: 'done',
            attempt_count: 1,
            storage_path: imagePath,
            thumbnail_path: thumbnailPath,
            completed_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .select()
          .single(),
      ),
    );
  }

  const update: Partial<Tables<'visits'>> = {};
  if (options.chosen) {
    const { hair, beard } = options.chosen;
    update.chosen_hair_style_id = styleId(styles, 'hair', hair);
    update.chosen_beard_style_id = styleId(styles, 'beard', beard);
    if (hair !== KEEP_STYLE_SLUG || beard !== KEEP_STYLE_SLUG) {
      const preview = done.find(
        (p) =>
          p.hair_style_id === update.chosen_hair_style_id &&
          p.beard_style_id === update.chosen_beard_style_id &&
          p.slot === (options.chosen!.slot ?? 'front'),
      );
      if (!preview) throw new Error(`the chosen look ${hair} + ${beard} is not among the done previews`);
      update.chosen_preview_id = preview.id;
    }
  }
  if (options.after) {
    const path = afterPhotoPath(shop.id, visit.id);
    await upload(service, STORAGE_BUCKETS.originals, path, await jpeg('#36c'));
    update.after_photo_path = path;
    update.status = 'closed';
    update.closed_at = new Date().toISOString();
  }
  if (Object.keys(update).length > 0) {
    visit = must(await service.from('visits').update(update).eq('id', visit.id).select().single());
  }

  if (!visit.share_token) throw new Error('the visit has no share token');
  return { visit, token: visit.share_token, done };
}
