import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { KEEP_STYLE_SLUG, STORAGE_BUCKETS, STYLE_DIMENSIONS } from '../src';
import { must, serviceClient } from './support/supabase';

const run = promisify(execFile);
const service = serviceClient();
const packageDir = join(__dirname, '..');
const seedDir = join(packageDir, 'seed', 'styles');

function uploadStyles() {
  return run('pnpm', ['run', '--silent', 'upload-styles'], { cwd: packageDir, env: process.env });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height from the IHDR chunk, which a PNG always carries first.
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function activeStyles() {
  return must(
    await service
      .from('styles')
      .select('dimension, slug, reference_image_path')
      .eq('active', true)
      .neq('slug', KEEP_STYLE_SLUG)
      .order('dimension')
      .order('sort_order'),
  );
}

describe('style reference images', () => {
  it('has a square PNG of at least 512 px at every active style reference path', async () => {
    const styles = await activeStyles();
    expect(styles).toHaveLength(17);
    for (const style of styles) {
      expect(style.reference_image_path).toBe(`${style.dimension}/${style.slug}.png`);
      const { width, height } = pngSize(readFileSync(join(seedDir, style.reference_image_path!)));
      expect({ path: style.reference_image_path, square: width === height, atLeast512: width >= 512 }).toEqual({
        path: style.reference_image_path,
        square: true,
        atLeast512: true,
      });
    }
  });

  it('uploads one object per style to the styles bucket, and a second run adds none', async () => {
    const styles = await activeStyles();
    const paths = styles.map((s) => s.reference_image_path!);
    const bucket = service.storage.from(STORAGE_BUCKETS.styles);
    await bucket.remove(paths);

    await uploadStyles();
    await uploadStyles();

    for (const dimension of STYLE_DIMENSIONS) {
      const { data, error } = await bucket.list(dimension, { limit: 1000 });
      expect(error).toBeNull();
      const expected = paths.filter((p) => p.startsWith(`${dimension}/`)).map((p) => p.slice(dimension.length + 1));
      expect(data!.map((o) => o.name).sort()).toEqual(expected.sort());
    }
    for (const path of paths) {
      const { data, error } = await bucket.download(path);
      expect(error).toBeNull();
      expect(Buffer.from(await data!.arrayBuffer()).equals(readFileSync(join(seedDir, path)))).toBe(true);
    }
  });
});
