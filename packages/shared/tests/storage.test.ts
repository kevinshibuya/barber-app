import { randomUUID } from 'node:crypto';
import { afterPhotoPath, originalPhotoPath, previewImagePath, STORAGE_BUCKETS } from '../src';
import { barber, createTestShop, deleteTestShop, serviceClient, type TestShop } from './support/supabase';

const service = serviceClient();
let shop: TestShop;
let otherShop: TestShop;
const created: { bucket: string; path: string }[] = [];

const jpeg = (label: string) => new Blob([`fake jpeg ${label}`], { type: 'image/jpeg' });

beforeAll(async () => {
  shop = await createTestShop(service, ['barber']);
  otherShop = await createTestShop(service, ['barber']);
});

afterAll(async () => {
  for (const bucket of new Set(created.map((c) => c.bucket))) {
    await service.storage.from(bucket).remove(created.filter((c) => c.bucket === bucket).map((c) => c.path));
  }
  await deleteTestShop(service, shop);
  await deleteTestShop(service, otherShop);
});

function track(bucket: string, path: string): string {
  created.push({ bucket, path });
  return path;
}

describe('storage', () => {
  it('lets a barber upload, overwrite and read photos under their shop prefix in originals', async () => {
    const { db } = barber(shop, 'barber');
    const visitId = randomUUID();
    const front = track(STORAGE_BUCKETS.originals, originalPhotoPath(shop.id, visitId, 'front'));
    const after = track(STORAGE_BUCKETS.originals, afterPhotoPath(shop.id, visitId));
    const originals = db.storage.from(STORAGE_BUCKETS.originals);

    expect((await originals.upload(front, jpeg('take 1'), { contentType: 'image/jpeg' })).error).toBeNull();
    const retake = await originals.upload(front, jpeg('take 2'), { contentType: 'image/jpeg', upsert: true });
    expect(retake.error).toBeNull();
    expect((await originals.upload(after, jpeg('after'), { contentType: 'image/jpeg' })).error).toBeNull();

    const downloaded = await originals.download(front);
    expect(downloaded.error).toBeNull();
    expect(await downloaded.data!.text()).toBe('fake jpeg take 2');

    const signed = await originals.createSignedUrl(after, 60);
    expect(signed.error).toBeNull();
    expect(await (await fetch(signed.data!.signedUrl)).text()).toBe('fake jpeg after');
  });

  it('lets a barber read previews under their shop prefix', async () => {
    const visitId = randomUUID();
    const path = track(STORAGE_BUCKETS.previews, previewImagePath(shop.id, visitId, randomUUID()));
    expect((await service.storage.from(STORAGE_BUCKETS.previews).upload(path, jpeg('preview'))).error).toBeNull();

    const downloaded = await barber(shop, 'barber').db.storage.from(STORAGE_BUCKETS.previews).download(path);
    expect(downloaded.error).toBeNull();
    expect(await downloaded.data!.text()).toBe('fake jpeg preview');
  });

  it('keeps a barber out of another shop\'s prefix', async () => {
    const visitId = randomUUID();
    const theirs = track(STORAGE_BUCKETS.originals, originalPhotoPath(otherShop.id, visitId, 'front'));
    const theirPreview = track(STORAGE_BUCKETS.previews, previewImagePath(otherShop.id, visitId, randomUUID()));
    expect((await service.storage.from(STORAGE_BUCKETS.originals).upload(theirs, jpeg('theirs'))).error).toBeNull();
    const previews = service.storage.from(STORAGE_BUCKETS.previews);
    expect((await previews.upload(theirPreview, jpeg('theirs'))).error).toBeNull();

    const { db } = barber(shop, 'barber');
    const originals = db.storage.from(STORAGE_BUCKETS.originals);

    expect((await originals.download(theirs)).error).not.toBeNull();
    expect((await db.storage.from(STORAGE_BUCKETS.previews).download(theirPreview)).error).not.toBeNull();
    expect((await originals.createSignedUrl(theirs, 60)).error).not.toBeNull();
    expect((await originals.list(`${otherShop.id}/${visitId}`)).data).toEqual([]);

    const intrusion = originalPhotoPath(otherShop.id, visitId, 'left');
    expect((await originals.upload(intrusion, jpeg('intruder'))).error).not.toBeNull();
    expect((await originals.upload(theirs, jpeg('overwrite'), { upsert: true })).error).not.toBeNull();
    await originals.remove([theirs]);

    const still = await service.storage.from(STORAGE_BUCKETS.originals).download(theirs);
    expect(await still.data!.text()).toBe('fake jpeg theirs');
    const missing = await service.storage.from(STORAGE_BUCKETS.originals).download(intrusion);
    expect(missing.error).not.toBeNull();
  });

  it('keeps originals private to anyone without a barber session', async () => {
    const path = track(STORAGE_BUCKETS.originals, originalPhotoPath(shop.id, randomUUID(), 'front'));
    expect((await service.storage.from(STORAGE_BUCKETS.originals).upload(path, jpeg('private'))).error).toBeNull();

    const { data } = service.storage.from(STORAGE_BUCKETS.originals).getPublicUrl(path);
    expect((await fetch(data.publicUrl)).ok).toBe(false);
  });

  it('serves the styles bucket to anyone, and takes writes only from the service role', async () => {
    const path = track(STORAGE_BUCKETS.styles, `test-${randomUUID()}/reference.png`);
    const png = new Blob(['fake png'], { type: 'image/png' });
    expect((await service.storage.from(STORAGE_BUCKETS.styles).upload(path, png)).error).toBeNull();

    const { data } = service.storage.from(STORAGE_BUCKETS.styles).getPublicUrl(path);
    const response = await fetch(data.publicUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('fake png');

    const barberWrite = track(STORAGE_BUCKETS.styles, `test-${randomUUID()}/reference.png`);
    const { error } = await barber(shop, 'barber').db.storage.from(STORAGE_BUCKETS.styles).upload(barberWrite, png);
    expect(error).not.toBeNull();
  });
});
