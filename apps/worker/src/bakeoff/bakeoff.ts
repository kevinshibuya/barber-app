// The bake-off: every input photo with every style through each provider,
// written as a CSV of per-image latency and outcome and one contact sheet per
// provider (rows are inputs, columns are styles). Each render is saved under
// the output folder, so a second run renders only what is still missing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageProviderName } from '@barber/shared';
import sharp from 'sharp';
import type { ImageProvider } from '../previews/image-provider';
import { contactSheet } from './contact-sheet';

export interface BakeoffInput {
  // The photo's file name without its extension; it names the CSV rows.
  name: string;
  image: Buffer;
}

export interface BakeoffStyle {
  slug: string;
  name: string;
  prompt: string;
  reference: Buffer;
}

export type BakeoffOutcome = 'done' | 'failed' | 'refused';

export interface BakeoffRow {
  provider: ImageProviderName;
  input: string;
  style: string;
  outcome: BakeoffOutcome;
  latencyMs: number;
  costUsd: number;
  message: string;
}

export interface BakeoffOptions {
  providers: ImageProvider[];
  inputs: BakeoffInput[];
  styles: BakeoffStyle[];
  outDir: string;
  // Renders in flight per provider.
  concurrency?: number;
  onRow?: (row: BakeoffRow, cached: boolean) => void;
}

// What one render costs, in US dollars, from each vendor's price page on
// 2026-10-22, at the 1K output and the two input images the worker sends.
// Gemini (Nano Banana 2): $0.067 per 1K image plus ~$0.001 of input.
// Nano Banana 2.1: $0.0336 per 1K image plus ~$0.003 of input at $1.50 per
// million tokens.
// FLUX.2 Pro Edit: $0.03 for the first megapixel and $0.015 for each further
// one, input and output counted, rounded up; the upper of the two roundings.
// FLUX.2 [klein] 4B Edit: $0.01 per megapixel; ~2.6 megapixels if fal counts
// the inputs as it does for Pro, rounded up to 3.
// Seedream 4.5 Edit: a flat $0.04.
export const PRICE_PER_RENDER_USD: Record<ImageProviderName, number> = {
  gemini: 0.068,
  'nano-banana-2.1': 0.037,
  flux: 0.075,
  'flux-klein': 0.03,
  seedream: 0.04,
  fake: 0,
};

// The long edge the app uploads a photo at (PHOTO_LONG_EDGE in
// apps/mobile/api/photos.ts), so a provider sees what it sees in production
// and FLUX is not billed for a phone camera's twelve megapixels.
export const INPUT_LONG_EDGE = 1024;

const CSV_HEADER = ['provider', 'input', 'style', 'outcome', 'latency_ms', 'cost_usd', 'message'];

interface SavedRender {
  outcome: Exclude<BakeoffOutcome, 'failed'>;
  latencyMs: number;
  message: string;
}

function renderPaths(outDir: string, provider: string, input: string, style: string) {
  const dir = join(outDir, 'renders', provider, input);
  return { dir, image: join(dir, `${style}.jpg`), record: join(dir, `${style}.json`) };
}

// A render already on disk: done with its image, or refused. A failed render
// is never saved, so the next run tries it again.
function savedRender(outDir: string, provider: string, input: string, style: string): SavedRender | undefined {
  const paths = renderPaths(outDir, provider, input, style);
  if (!existsSync(paths.record)) return undefined;
  const saved = JSON.parse(readFileSync(paths.record, 'utf8')) as SavedRender;
  if (saved.outcome === 'done' && !existsSync(paths.image)) return undefined;
  return saved;
}

export function prepareInput(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize(INPUT_LONG_EDGE, INPUT_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function renderOne(
  provider: ImageProvider,
  input: BakeoffInput,
  style: BakeoffStyle,
  outDir: string,
): Promise<{ row: BakeoffRow; cached: boolean }> {
  const row = (saved: Omit<SavedRender, 'outcome'> & { outcome: BakeoffOutcome }): BakeoffRow => ({
    provider: provider.name,
    input: input.name,
    style: style.slug,
    ...saved,
    costUsd: saved.outcome === 'done' ? PRICE_PER_RENDER_USD[provider.name] : 0,
  });

  const saved = savedRender(outDir, provider.name, input.name, style.slug);
  if (saved) return { row: row(saved), cached: true };

  const paths = renderPaths(outDir, provider.name, input.name, style.slug);
  const started = Date.now();
  let result;
  try {
    result = await provider.render({ base: input.image, references: [style.reference], prompt: style.prompt });
  } catch (error) {
    result = { ok: false as const, failure: 'retryable' as const, message: String(error) };
  }
  const latencyMs = Date.now() - started;

  if (!result.ok && result.failure === 'retryable') {
    return { row: row({ outcome: 'failed', latencyMs, message: result.message }), cached: false };
  }
  const record: SavedRender = result.ok
    ? { outcome: 'done', latencyMs, message: '' }
    : { outcome: 'refused', latencyMs, message: result.message };
  mkdirSync(paths.dir, { recursive: true });
  if (result.ok) writeFileSync(paths.image, result.image);
  writeFileSync(paths.record, JSON.stringify(record));
  return { row: row(record), cached: false };
}

export interface BakeoffPlanOptions {
  providers: ImageProviderName[];
  inputs: string[];
  styles: string[];
  outDir: string;
}

export interface BakeoffPlan {
  provider: ImageProviderName;
  // Renders not yet on disk, which a run would pay for.
  renders: number;
  estimatedUsd: number;
}

// What a run would render and what it would cost, before anything is spent.
export function planBakeoff(options: BakeoffPlanOptions): BakeoffPlan[] {
  return options.providers.map((provider) => {
    let renders = 0;
    for (const input of options.inputs) {
      for (const style of options.styles) {
        if (!savedRender(options.outDir, provider, input, style)) renders += 1;
      }
    }
    const estimatedUsd = Math.round(renders * PRICE_PER_RENDER_USD[provider] * 1000) / 1000;
    return { provider, renders, estimatedUsd };
  });
}

// Runs `task` over `items` with at most `limit` in flight, keeping order.
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = [...items.entries()];
  const lane = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const [index, item] = entry;
      results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function runBakeoff(options: BakeoffOptions): Promise<BakeoffRow[]> {
  const { providers, styles, outDir } = options;
  const inputs = await Promise.all(
    options.inputs.map(async (input) => ({ name: input.name, image: await prepareInput(input.image) })),
  );
  mkdirSync(outDir, { recursive: true });

  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      const jobs = inputs.flatMap((input) => styles.map((style) => ({ input, style })));
      const rows = await pool(jobs, options.concurrency ?? 4, async ({ input, style }) => {
        const { row, cached } = await renderOne(provider, input, style, outDir);
        options.onRow?.(row, cached);
        return row;
      });
      const sheet = await contactSheet({
        title: provider.name,
        inputs,
        styles,
        render: (input, style) => {
          const { image } = renderPaths(outDir, provider.name, input, style);
          return existsSync(image) ? readFileSync(image) : undefined;
        },
        outcome: (input, style) =>
          rows.find((row) => row.input === input && row.style === style)?.outcome ?? 'failed',
      });
      writeFileSync(join(outDir, `contact-${provider.name}.jpg`), sheet);
      return rows;
    }),
  );

  const rows = perProvider.flat();
  const lines = [
    CSV_HEADER.join(','),
    ...rows.map((row) =>
      [row.provider, row.input, row.style, row.outcome, row.latencyMs, row.costUsd.toFixed(3), row.message]
        .map(csvField)
        .join(','),
    ),
  ];
  writeFileSync(join(outDir, 'results.csv'), `${lines.join('\n')}\n`);
  return rows;
}
