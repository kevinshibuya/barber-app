import type { Photo, PhotoSlot, UploadStatus } from '@barber/shared';
import { type ImageTool, type LocalImage, type PhotoTransport, type PhotoUpload, photoUploader } from '@/api/photos';

// A device that re-encodes exactly as asked, to a new file each time.
function fakeImages(): ImageTool {
  let files = 0;
  return {
    async toJpeg(image, size) {
      files += 1;
      return { uri: `file:///cache/${files}.jpg`, ...(size ?? { width: image.width, height: image.height }) };
    },
  };
}

// The network of one shop: photo rows by visit and slot, objects by path.
// Each object remembers the status its row had while it was uploading.
function fakeNetwork(shopId = 's1') {
  const rows = new Map<string, Photo>();
  const objects = new Map<string, LocalImage & { rowStatus: UploadStatus | undefined }>();
  const statuses: UploadStatus[] = [];
  let failNextPut = false;
  const key = (visitId: string, slot: PhotoSlot) => `${visitId}/${slot}`;

  const transport: PhotoTransport = {
    async slotOf(visitId, slot) {
      return { shopId, photo: rows.get(key(visitId, slot)) ?? null };
    },
    async savePhoto(photo) {
      const existing = rows.get(key(photo.visitId, photo.slot));
      const saved = { id: existing?.id ?? `p${rows.size + 1}`, ...photo };
      rows.set(key(photo.visitId, photo.slot), saved);
      statuses.push(photo.uploadStatus);
      return saved;
    },
    async putOriginal(path, image) {
      if (failNextPut) {
        failNextPut = false;
        throw new Error('network down');
      }
      const visitId = path.split('/')[1]!;
      const slot = path.split('/')[2]!.split('.')[0] as PhotoSlot;
      objects.set(path, { ...image, rowStatus: rows.get(key(visitId, slot))?.uploadStatus });
    },
    async removeOriginal(path) {
      objects.delete(path);
    },
  };

  return {
    transport,
    rows,
    objects,
    statuses,
    failNextPut: () => {
      failNextPut = true;
    },
  };
}

function shot(overrides: Partial<PhotoUpload> = {}): PhotoUpload {
  return { visitId: 'v1', slot: 'front', uri: 'file:///camera/shot.heic', width: 3024, height: 4032, ...overrides };
}

describe('photo upload', () => {
  it('downscales a portrait photo to 1024 px on its long edge before it reaches the network', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());

    const photo = await upload(shot({ width: 3024, height: 4032 }));

    expect([...network.objects.keys()]).toEqual(['s1/v1/front.jpg']);
    expect(network.objects.get('s1/v1/front.jpg')).toMatchObject({ width: 768, height: 1024 });
    expect(photo).toMatchObject({
      visitId: 'v1',
      slot: 'front',
      storagePath: 's1/v1/front.jpg',
      width: 768,
      height: 1024,
      uploadStatus: 'uploaded',
    });
  });

  it('downscales a landscape photo on its width, to the slot path', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());

    await upload(shot({ slot: 'left', width: 4000, height: 3000 }));

    expect(network.objects.get('s1/v1/left.jpg')).toMatchObject({ width: 1024, height: 768 });
  });

  it('re-encodes a photo already within 1024 px at its own size', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());

    await upload(shot({ slot: 'back', width: 600, height: 800 }));

    expect(network.objects.get('s1/v1/back.jpg')).toMatchObject({ width: 600, height: 800, uri: 'file:///cache/1.jpg' });
  });

  it('writes the photo row as uploading while the object uploads, then flips it to uploaded', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());

    await upload(shot());

    expect(network.objects.get('s1/v1/front.jpg')?.rowStatus).toBe('uploading');
    expect(network.statuses).toEqual(['uploading', 'uploaded']);
    expect(network.rows.get('v1/front')?.uploadStatus).toBe('uploaded');
  });

  it('leaves the row uploading when the object upload fails, and a retry reuses its path', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());
    network.failNextPut();

    await expect(upload(shot())).rejects.toThrow('network down');
    expect(network.rows.get('v1/front')).toMatchObject({ storagePath: 's1/v1/front.jpg', uploadStatus: 'uploading' });

    await upload(shot());

    expect([...network.objects.keys()]).toEqual(['s1/v1/front.jpg']);
    expect(network.rows.get('v1/front')).toMatchObject({ storagePath: 's1/v1/front.jpg', uploadStatus: 'uploaded' });
  });

  it('moves a retake of an uploaded photo to a new path in the slot, in place of the old object', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());
    const first = await upload(shot());

    const retake = await upload(shot({ uri: 'file:///camera/retake.heic' }));

    expect(retake.id).toBe(first.id);
    expect(retake.storagePath).toMatch(/^s1\/v1\/front\.[a-z0-9]+\.jpg$/);
    expect([...network.objects.keys()]).toEqual([retake.storagePath]);
    expect(network.rows.get('v1/front')).toMatchObject({ storagePath: retake.storagePath, uploadStatus: 'uploaded' });
  });
});
