import type { Photo, PhotoSlot, UploadStatus, Visit } from '@barber/shared';
import {
  type AfterPhotoTransport,
  afterPhotoUploader,
  type ImageTool,
  type LocalImage,
  type PhotoTransport,
  type PhotoUpload,
  photoUploader,
} from '@/api/photos';
import { openVisit } from './support/fixtures';

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

  it('writes a take to its own path once, however often it is sent', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());

    await upload(shot(), 'take1');
    // The response was lost and the queue sends the same take again.
    const again = await upload(shot(), 'take1');

    expect(again).toMatchObject({ storagePath: 's1/v1/front.take1.jpg', uploadStatus: 'uploaded' });
    expect(network.statuses).toEqual(['uploading', 'uploaded']);
    expect([...network.objects.keys()]).toEqual(['s1/v1/front.take1.jpg']);
  });

  it('puts a new take in place of an earlier one the network never finished', async () => {
    const network = fakeNetwork();
    const upload = photoUploader(network.transport, fakeImages());
    network.failNextPut();
    await expect(upload(shot(), 'take1')).rejects.toThrow('network down');

    await upload(shot({ uri: 'file:///camera/retake.heic' }), 'take2');

    expect(network.rows.get('v1/front')).toMatchObject({ storagePath: 's1/v1/front.take2.jpg', uploadStatus: 'uploaded' });
    expect([...network.objects.keys()]).toEqual(['s1/v1/front.take2.jpg']);
  });
});

// One visit of shop s1 and the originals bucket. The visit records an after
// photo only when its object is already there.
function fakeAfterNetwork() {
  let visit: Visit = openVisit();
  const objects = new Map<string, LocalImage>();
  let failNextPut = false;

  const transport: AfterPhotoTransport = {
    async visitOf() {
      return visit;
    },
    async putOriginal(path, image) {
      if (failNextPut) {
        failNextPut = false;
        throw new Error('network down');
      }
      objects.set(path, image);
    },
    async recordAfterPhoto(_visitId, path) {
      if (!objects.has(path)) throw new Error(`no object at ${path}`);
      visit = { ...visit, afterPhotoPath: path };
      return visit;
    },
  };

  return {
    transport,
    objects,
    visit: () => visit,
    failNextPut: () => {
      failNextPut = true;
    },
  };
}

describe('after photo upload', () => {
  const after: LocalImage = { uri: 'file:///camera/after.heic', width: 3024, height: 4032 };

  it('downscales the photo to the after path of the visit and records it there', async () => {
    const network = fakeAfterNetwork();
    const upload = afterPhotoUploader(network.transport, fakeImages());

    const visit = await upload('v1', after);

    expect([...network.objects.keys()]).toEqual(['s1/v1/after.jpg']);
    expect(network.objects.get('s1/v1/after.jpg')).toMatchObject({ width: 768, height: 1024 });
    expect(visit.afterPhotoPath).toBe('s1/v1/after.jpg');
  });

  it('leaves the visit without an after photo when the upload fails', async () => {
    const network = fakeAfterNetwork();
    const upload = afterPhotoUploader(network.transport, fakeImages());
    network.failNextPut();

    await expect(upload('v1', after)).rejects.toThrow('network down');

    expect(network.visit().afterPhotoPath).toBeNull();
  });
});
