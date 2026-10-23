import { randomUUID } from 'node:crypto';
import { afterPhotoPath, KEEP_STYLE_SLUG, originalPhotoPath, SHARE_LINK_DAYS, SHARE_TOKEN_LENGTH, styleReferencePath } from '../src';
import { barber, createTestShop, deleteTestShop, must, serviceClient, type TestShop } from './support/supabase';

const service = serviceClient();
let shop: TestShop;
let otherShop: TestShop;

beforeAll(async () => {
  shop = await createTestShop(service, ['owner', 'barber']);
  otherShop = await createTestShop(service, ['owner']);
});

afterAll(async () => {
  await deleteTestShop(service, shop);
  await deleteTestShop(service, otherShop);
});

// A client, a visit and a front photo in a shop, written with the service role.
async function seedVisit(target: TestShop) {
  const client = must(
    await service.from('clients').insert({ shop_id: target.id, name: 'Seeded client' }).select().single(),
  );
  const visit = must(
    await service
      .from('visits')
      .insert({ shop_id: target.id, client_id: client.id, barber_id: target.barbers[0]!.id })
      .select()
      .single(),
  );
  const photo = must(
    await service
      .from('photos')
      .insert({
        visit_id: visit.id,
        slot: 'front',
        storage_path: originalPhotoPath(target.id, visit.id, 'front'),
        width: 768,
        height: 1024,
      })
      .select()
      .single(),
  );
  return { client, visit, photo };
}

describe('the style catalog', () => {
  it('seeds twelve hair styles, five beard styles and one keep per dimension', async () => {
    const styles = must(
      await barber(shop, 'barber').db.from('styles').select('*').eq('active', true).order('sort_order'),
    );
    const byDimension = (dimension: string) => styles.filter((s) => s.dimension === dimension);

    for (const [dimension, count] of [
      ['hair', 12],
      ['beard', 5],
    ] as const) {
      const rows = byDimension(dimension);
      const keeps = rows.filter((s) => s.slug === KEEP_STYLE_SLUG);
      const others = rows.filter((s) => s.slug !== KEEP_STYLE_SLUG);

      expect(keeps).toHaveLength(1);
      expect(keeps[0]).toMatchObject({ prompt: null, reference_image_path: null });
      expect(others).toHaveLength(count);
      for (const style of others) {
        expect(style.reference_image_path).toBe(`${dimension}/${style.slug}.png`);
        expect(style.reference_image_path).toBe(styleReferencePath(dimension, style.slug));
        expect(style.prompt).toMatch(/natural hair texture/i);
      }
    }

    expect(byDimension('hair').map((s) => s.slug)).toEqual([
      'keep',
      'buzz-cut',
      'crew-cut',
      'low-fade',
      'mid-fade',
      'high-skin-fade',
      'taper',
      'textured-crop',
      'french-crop-fringe',
      'quiff',
      'pompadour',
      'side-part',
      'slick-back',
    ]);
    expect(byDimension('beard').map((s) => s.slug)).toEqual([
      'keep',
      'clean-shaven',
      'stubble',
      'short-boxed',
      'full-beard',
      'goatee',
    ]);
  });
});

describe('shop isolation', () => {
  it('lets a barber read and write their own shop\'s clients, visits and photos', async () => {
    const { db, id: barberId } = barber(shop, 'barber');
    const visitId = randomUUID();

    const client = must(await db.from('clients').insert({ shop_id: shop.id, name: 'Ana' }).select().single());
    must(
      await db
        .from('visits')
        .insert({ id: visitId, shop_id: shop.id, client_id: client.id, barber_id: barberId })
        .select()
        .single(),
    );
    must(
      await db
        .from('photos')
        .insert({
          visit_id: visitId,
          slot: 'front',
          storage_path: originalPhotoPath(shop.id, visitId, 'front'),
          width: 768,
          height: 1024,
        })
        .select()
        .single(),
    );
    must(await db.from('clients').update({ phone: '+55 11 99999-0000' }).eq('id', client.id).select().single());

    const visits = must(await db.from('visits').select('id, client_id, photos(slot)').eq('id', visitId));
    expect(visits).toEqual([{ id: visitId, client_id: client.id, photos: [{ slot: 'front' }] }]);
    expect(must(await db.from('shops').select('id'))).toEqual([{ id: shop.id }]);
    expect(must(await db.from('barbers').select('id')).map((b) => b.id).sort()).toEqual(
      shop.barbers.map((b) => b.id).sort(),
    );
  });

  it('hides another shop\'s clients, visits and photos from a barber', async () => {
    const theirs = await seedVisit(otherShop);
    const { db } = barber(shop, 'barber');

    expect(must(await db.from('clients').select('id').eq('id', theirs.client.id))).toEqual([]);
    expect(must(await db.from('visits').select('id').eq('id', theirs.visit.id))).toEqual([]);
    expect(must(await db.from('photos').select('id').eq('id', theirs.photo.id))).toEqual([]);
    expect(must(await db.from('shops').select('id').eq('id', otherShop.id))).toEqual([]);
    expect(must(await db.from('barbers').select('id').eq('shop_id', otherShop.id))).toEqual([]);
  });

  it('refuses a barber\'s writes into another shop', async () => {
    const theirs = await seedVisit(otherShop);
    const { db, id: barberId } = barber(shop, 'barber');
    const ownClient = must(await db.from('clients').insert({ shop_id: shop.id, name: 'Bia' }).select().single());

    const clientInsert = await db.from('clients').insert({ shop_id: otherShop.id, name: 'Intruder' });
    expect(clientInsert.error).not.toBeNull();

    const visitInsert = await db
      .from('visits')
      .insert({ shop_id: otherShop.id, client_id: theirs.client.id, barber_id: barberId });
    expect(visitInsert.error).not.toBeNull();

    // Their client under our shop id: the visit must stay inside one shop.
    const crossVisit = await db
      .from('visits')
      .insert({ shop_id: shop.id, client_id: theirs.client.id, barber_id: barberId });
    expect(crossVisit.error).not.toBeNull();

    const photoInsert = await db.from('photos').insert({
      visit_id: theirs.visit.id,
      slot: 'left',
      storage_path: originalPhotoPath(otherShop.id, theirs.visit.id, 'left'),
      width: 1,
      height: 1,
    });
    expect(photoInsert.error).not.toBeNull();

    expect(must(await db.from('clients').update({ name: 'Renamed' }).eq('id', theirs.client.id).select())).toEqual([]);
    expect(must(await db.from('visits').update({ status: 'closed' }).eq('id', theirs.visit.id).select())).toEqual([]);
    expect(
      must(await db.from('photos').update({ storage_path: 'x' }).eq('id', theirs.photo.id).select()),
    ).toEqual([]);
    expect(must(await db.from('clients').delete().eq('id', theirs.client.id).select())).toEqual([]);

    // Moving our own client into their shop is a write into their shop too.
    const move = await db.from('clients').update({ shop_id: otherShop.id }).eq('id', ownClient.id).select();
    expect(move.error).not.toBeNull();

    const after = must(
      await service
        .from('visits')
        .select('status, clients(name), photos(storage_path, slot)')
        .eq('id', theirs.visit.id)
        .single(),
    );
    expect(after).toEqual({
      status: 'open',
      clients: { name: 'Seeded client' },
      photos: [{ storage_path: theirs.photo.storage_path, slot: 'front' }],
    });
    const intruders = await service.from('clients').select('id').eq('shop_id', otherShop.id).eq('name', 'Intruder');
    expect(must(intruders)).toEqual([]);
  });

  // The worker and the client page read these paths with the service role, so
  // a path into another shop would hand its photos over.
  it('refuses a photo or after photo path outside the barber\'s own visit', async () => {
    const theirs = await seedVisit(otherShop);
    const ours = await seedVisit(shop);
    const { db } = barber(shop, 'barber');

    const forgedPhoto = await db
      .from('photos')
      .upsert(
        {
          visit_id: ours.visit.id,
          slot: 'front',
          storage_path: theirs.photo.storage_path,
          width: 1,
          height: 1,
          upload_status: 'uploaded',
        },
        { onConflict: 'visit_id,slot' },
      );
    expect(forgedPhoto.error?.code).toBe('23514');
    const otherSlot = await db
      .from('photos')
      .update({ storage_path: originalPhotoPath(shop.id, ours.visit.id, 'back') })
      .eq('id', ours.photo.id);
    expect(otherSlot.error?.code).toBe('23514');
    const forgedAfter = await db
      .from('visits')
      .update({ after_photo_path: afterPhotoPath(otherShop.id, theirs.visit.id) })
      .eq('id', ours.visit.id);
    expect(forgedAfter.error?.code).toBe('23514');

    const retake = originalPhotoPath(shop.id, ours.visit.id, 'front', 'k3x');
    const after = afterPhotoPath(shop.id, ours.visit.id, 'k3x');
    must(await db.from('photos').update({ storage_path: retake }).eq('id', ours.photo.id).select().single());
    must(await db.from('visits').update({ after_photo_path: after }).eq('id', ours.visit.id).select().single());
  });

  it('refuses a barber\'s writes to the catalog', async () => {
    const { db } = barber(shop, 'owner');
    const before = must(
      await service.from('styles').select('*').eq('dimension', 'hair').eq('slug', 'quiff').single(),
    );

    const update = await db.from('styles').update({ name: 'Hacked', active: false }).eq('id', before.id).select();
    expect(must(update)).toEqual([]);
    const insert = await db.from('styles').insert({
      dimension: 'hair',
      slug: 'mullet',
      name: 'Mullet',
      sort_order: 99,
      prompt: 'p',
      reference_image_path: 'hair/mullet.png',
    });
    expect(insert.error).not.toBeNull();
    expect(must(await db.from('styles').delete().eq('id', before.id).select())).toEqual([]);

    expect(must(await service.from('styles').select('*').eq('id', before.id).single())).toEqual(before);
  });
});

describe('a new visit', () => {
  async function startVisit(extra: { share_token?: string; share_expires_at?: string } = {}) {
    const { db, id: barberId } = barber(shop, 'barber');
    const client = must(await db.from('clients').insert({ shop_id: shop.id, name: 'Caio' }).select().single());
    return must(
      await db
        .from('visits')
        .insert({
          id: randomUUID(),
          shop_id: shop.id,
          client_id: client.id,
          barber_id: barberId,
          consent_given: true,
          consent_at: new Date().toISOString(),
          ...extra,
        })
        .select()
        .single(),
    );
  }

  it('gets a 43-character base64url share token that expires in thirty days', async () => {
    const visit = await startVisit();

    expect(SHARE_TOKEN_LENGTH).toBe(43);
    expect(visit.share_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(visit.status).toBe('open');
    const daysOut = (Date.parse(visit.share_expires_at!) - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(SHARE_LINK_DAYS - 0.01);
    expect(daysOut).toBeLessThan(SHARE_LINK_DAYS + 0.01);

    const other = await startVisit();
    expect(other.share_token).not.toBe(visit.share_token);
  });

  it('ignores a share token or expiry the app tries to set', async () => {
    const visit = await startVisit({ share_token: 'guessable', share_expires_at: '2099-01-01T00:00:00Z' });
    expect(visit.share_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(visit.share_expires_at!)).toBeLessThan(Date.parse('2099-01-01T00:00:00Z'));

    const { db } = barber(shop, 'barber');
    const updated = must(
      await db
        .from('visits')
        .update({ share_token: 'guessable', share_expires_at: '2099-01-01T00:00:00Z', status: 'closed' })
        .eq('id', visit.id)
        .select()
        .single(),
    );
    expect(updated).toMatchObject({
      status: 'closed',
      share_token: visit.share_token,
      share_expires_at: visit.share_expires_at,
    });
  });

  it('keeps one photo row per slot: a retake upserts in place with the latest path', async () => {
    const visit = await startVisit();
    const { db } = barber(shop, 'barber');
    const path = originalPhotoPath(shop.id, visit.id, 'front');

    const first = must(
      await db
        .from('photos')
        .upsert(
          {
            visit_id: visit.id,
            slot: 'front',
            storage_path: originalPhotoPath(shop.id, visit.id, 'front', '1'),
            width: 768,
            height: 1024,
          },
          { onConflict: 'visit_id,slot' },
        )
        .select()
        .single(),
    );
    const second = must(
      await db
        .from('photos')
        .upsert(
          {
            visit_id: visit.id,
            slot: 'front',
            storage_path: path,
            width: 1024,
            height: 768,
            upload_status: 'uploaded',
          },
          { onConflict: 'visit_id,slot' },
        )
        .select()
        .single(),
    );

    const rows = must(await db.from('photos').select('*').eq('visit_id', visit.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      slot: 'front',
      storage_path: path,
      width: 1024,
      height: 768,
      upload_status: 'uploaded',
    });
    expect(second.id).toBe(first.id);
    expect(first.upload_status).toBe('uploading');

    const plain = await db
      .from('photos')
      .insert({ visit_id: visit.id, slot: 'front', storage_path: path, width: 1, height: 1 });
    expect(plain.error?.code).toBe('23505');
  });
});
