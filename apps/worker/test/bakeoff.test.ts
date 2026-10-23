// The bake-off, run with the fake provider on generated photos and the real
// hair reference images: what lands on disk is what a reader of the issue
// sees, a CSV and one contact sheet per provider. No test calls a vendor.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { type BakeoffInput, type BakeoffStyle, planBakeoff, runBakeoff } from '../src/bakeoff/bakeoff';
import { FakeImageProvider } from '../src/previews/fake-provider';

const HAIR_SEED = join(__dirname, '..', '..', '..', 'packages', 'shared', 'seed', 'styles', 'hair');

// The hair catalog as the seed folder has it: twelve styles, each prompted by
// its own name so the fake provider can be scripted per style.
function hairCatalog(): BakeoffStyle[] {
  return readdirSync(HAIR_SEED)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => {
      const slug = basename(file, '.png');
      return { slug, name: slug, prompt: slug, reference: readFileSync(join(HAIR_SEED, file)) };
    });
}

async function photo(name: string, width: number, height: number): Promise<BakeoffInput> {
  const image = await sharp({ create: { width, height, channels: 3, background: '#c08060' } })
    .jpeg()
    .toBuffer();
  return { name, image };
}

function csvRows(outDir: string): string[][] {
  const lines = readFileSync(join(outDir, 'results.csv'), 'utf8').trim().split('\n');
  return lines.map((line) => line.split(','));
}

async function pixel(file: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(at, at + 3));
}

describe('the bake-off', () => {
  it('writes one CSV row per image and a contact sheet with a row per input and a column per style', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bakeoff-'));
    const styles = hairCatalog();
    expect(styles).toHaveLength(12);
    const provider = new FakeImageProvider();
    provider.script('pompadour', 'refused');

    await runBakeoff({
      providers: [provider],
      inputs: [await photo('ana', 1200, 1600), await photo('bruno', 1600, 1200)],
      styles,
      outDir,
    });

    const [header, ...rows] = csvRows(outDir);
    expect(header).toEqual(['provider', 'input', 'style', 'outcome', 'latency_ms', 'cost_usd', 'message']);
    expect(rows).toHaveLength(24);
    expect(rows.filter((row) => row[3] === 'done')).toHaveLength(22);
    expect(rows.filter((row) => row[3] === 'refused').map((row) => [row[1], row[2]])).toEqual([
      ['ana', 'pompadour'],
      ['bruno', 'pompadour'],
    ]);

    // 192 by 256 cells under a 40-pixel header: the input's column and twelve
    // style columns across, two input rows down.
    const sheet = join(outDir, 'contact-fake.jpg');
    const { width, height } = await sharp(sheet).metadata();
    expect([width, height]).toEqual([13 * 192, 40 + 2 * 256]);

    // The fake answers grey; the refused pompadour cell is not a render.
    const column = (slug: string) => 1 + styles.findIndex((s) => s.slug === slug);
    const centre = (row: number, col: number) => pixel(sheet, col * 192 + 96, 40 + row * 256 + 128);
    for (const value of await centre(1, column('low-fade'))) expect(Math.abs(value - 0x77)).toBeLessThan(8);
    for (const value of await centre(1, column('pompadour'))) expect(Math.abs(value - 0x77)).toBeGreaterThan(24);
  });

  it('sends each provider the photo at the long edge the app uploads, never larger', async () => {
    const provider = new FakeImageProvider();
    await runBakeoff({
      providers: [provider],
      inputs: [await photo('ana', 3024, 4032), await photo('bruno', 600, 800)],
      styles: hairCatalog().slice(0, 1),
      outDir: mkdtempSync(join(tmpdir(), 'bakeoff-')),
    });

    const sizes = await Promise.all(
      provider.calls.map(async (call) => {
        const { width, height } = await sharp(call.base).metadata();
        return [width, height];
      }),
    );
    expect(sizes.sort()).toEqual([
      [600, 800],
      [768, 1024],
    ]);
  });

  it('renders again only what failed, and plans the cost of what is still missing', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'bakeoff-'));
    const styles = hairCatalog().slice(0, 3);
    const inputs = [await photo('ana', 1200, 1600), await photo('bruno', 1200, 1600)];
    const [refusedStyle, failedStyle] = styles.map((style) => style.slug);
    if (!refusedStyle || !failedStyle) throw new Error('the seed has fewer than three hair styles');
    const first = new FakeImageProvider();
    first.script(refusedStyle, 'refused');
    first.script(failedStyle, 'retryable');

    const plan = (name: 'fake' | 'gemini') =>
      planBakeoff({ providers: [name], inputs: ['ana', 'bruno'], styles: styles.map((s) => s.slug), outDir });
    expect(plan('gemini')).toEqual([{ provider: 'gemini', renders: 6, estimatedUsd: 0.408 }]);

    await runBakeoff({ providers: [first], inputs, styles, outDir });
    // Done and refused renders are on disk; the two failed ones are not.
    expect(plan('fake')).toEqual([{ provider: 'fake', renders: 2, estimatedUsd: 0 }]);

    const second = new FakeImageProvider();
    const rows = await runBakeoff({ providers: [second], inputs, styles, outDir });
    expect(second.calls.map((call) => call.prompt)).toEqual([failedStyle, failedStyle]);
    expect(rows.map((row) => row.outcome)).toEqual(['refused', 'done', 'done', 'refused', 'done', 'done']);
    expect(plan('fake')).toEqual([{ provider: 'fake', renders: 0, estimatedUsd: 0 }]);
  });
});
