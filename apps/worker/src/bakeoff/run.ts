// `pnpm --filter @barber/worker run bakeoff`: the bake-off on real photos with
// the active catalog of the configured Supabase project. Without --yes it only
// prints what it would render and what that would cost.
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  IMAGE_PROVIDERS,
  type ImageProviderName,
  KEEP_STYLE_SLUG,
  STORAGE_BUCKETS,
  STYLE_DIMENSIONS,
  type StyleDimension,
  WORKER_ENV,
} from '@barber/shared';
import { createImageProvider } from '../previews/providers';
import { createServiceClient } from '../service-client';
import { type BakeoffInput, type BakeoffStyle, planBakeoff, runBakeoff } from './bakeoff';

const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const USAGE = `Usage: pnpm --filter @barber/worker run bakeoff -- --input <folder> --providers <names> [options]

Renders every photo in <folder> with every style of the catalog through each
provider, and writes to the output folder:
  results.csv               one row per image: latency, outcome, cost
  contact-<provider>.jpg    rows are photos, columns are styles
  renders/                  each render, so a second run pays only for the rest

Without --yes nothing is spent: it prints the renders still missing and their
estimated cost.

Options:
  --input <folder>      the photos (${PHOTO_EXTENSIONS.join(', ')}), named by file
  --providers <names>   comma-separated, of ${IMAGE_PROVIDERS.join(', ')}
  --out <folder>        where results go (default: bakeoff-results)
  --dimension <name>    ${STYLE_DIMENSIONS.join(' or ')} (default: hair)
  --sample              only the first photo with the first style, per provider
  --concurrency <n>     renders in flight per provider (default: 4)
  --yes                 render, spending on the providers' accounts

Reads ${WORKER_ENV.supabaseUrl} and ${WORKER_ENV.supabaseServiceRoleKey} for the catalog, and
${WORKER_ENV.geminiApiKey} or ${WORKER_ENV.falKey} for the providers named, from the
environment or apps/worker/.env.`;

interface Args {
  input?: string;
  providers: ImageProviderName[];
  out: string;
  dimension: StyleDimension;
  sample: boolean;
  concurrency: number;
  yes: boolean;
}

function parseArgs(argv: string[]): Args | 'help' {
  const args: Args = { providers: [], out: 'bakeoff-results', dimension: 'hair', sample: false, concurrency: 4, yes: false };
  const rest = argv[0] === '--' ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => {
      const next = rest[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case '-h':
      case '--help':
        return 'help';
      case '--input':
        args.input = value();
        break;
      case '--out':
        args.out = value();
        break;
      case '--providers':
        args.providers = value()
          .split(',')
          .map((name) => name.trim())
          .map((name) => {
            if (!IMAGE_PROVIDERS.some((known) => known === name)) {
              throw new Error(`unknown provider ${name}: expected ${IMAGE_PROVIDERS.join(', ')}`);
            }
            return name as ImageProviderName;
          });
        break;
      case '--dimension': {
        const dimension = value();
        if (!STYLE_DIMENSIONS.some((known) => known === dimension)) {
          throw new Error(`unknown dimension ${dimension}: expected ${STYLE_DIMENSIONS.join(' or ')}`);
        }
        args.dimension = dimension as StyleDimension;
        break;
      }
      case '--sample':
        args.sample = true;
        break;
      case '--concurrency':
        args.concurrency = Number(value());
        if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
          throw new Error('--concurrency needs a positive whole number');
        }
        break;
      case '--yes':
        args.yes = true;
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  if (!args.input) throw new Error('--input is required');
  if (args.providers.length === 0) throw new Error('--providers is required');
  return args;
}

function readInputs(folder: string): BakeoffInput[] {
  const files = readdirSync(folder)
    .filter((file) => PHOTO_EXTENSIONS.includes(extname(file).toLowerCase()))
    .sort();
  if (files.length === 0) throw new Error(`${folder} has no photos`);
  return files.map((file) => ({
    name: file.slice(0, -extname(file).length),
    image: readFileSync(join(folder, file)),
  }));
}

async function loadCatalog(dimension: StyleDimension): Promise<BakeoffStyle[]> {
  const db = createServiceClient(process.env);
  const { data, error } = await db
    .from('styles')
    .select('*')
    .eq('active', true)
    .eq('dimension', dimension)
    .neq('slug', KEEP_STYLE_SLUG)
    .order('sort_order');
  if (error) throw new Error(`styles: ${error.message}`);
  return Promise.all(
    data.map(async (style) => {
      if (!style.prompt || !style.reference_image_path) {
        throw new Error(`style ${style.dimension}/${style.slug} has no prompt or reference image`);
      }
      const download = await db.storage.from(STORAGE_BUCKETS.styles).download(style.reference_image_path);
      if (download.error) throw new Error(`${style.reference_image_path}: ${download.error.message}`);
      const reference = Buffer.from(await download.data.arrayBuffer());
      return { slug: style.slug, name: style.name, prompt: style.prompt, reference };
    }),
  );
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const outDir = resolve(args.out);
  let inputs = readInputs(resolve(args.input!));
  let styles = await loadCatalog(args.dimension);
  if (args.sample) {
    inputs = inputs.slice(0, 1);
    styles = styles.slice(0, 1);
  }

  const plan = planBakeoff({
    providers: args.providers,
    inputs: inputs.map((input) => input.name),
    styles: styles.map((style) => style.slug),
    outDir,
  });
  process.stdout.write(`${inputs.length} photos x ${styles.length} ${args.dimension} styles, into ${outDir}\n`);
  for (const line of plan) {
    process.stdout.write(`  ${line.provider}: ${line.renders} renders to do, about $${line.estimatedUsd.toFixed(2)}\n`);
  }
  const total = plan.reduce((sum, line) => sum + line.estimatedUsd, 0);
  process.stdout.write(`  total: about $${total.toFixed(2)}\n`);
  if (!args.yes) {
    process.stdout.write('Nothing spent. Run again with --yes to render.\n');
    return;
  }

  const providers = args.providers.map((name) => createImageProvider(name, process.env));
  const rows = await runBakeoff({
    providers,
    inputs,
    styles,
    outDir,
    concurrency: args.concurrency,
    onRow: (row, cached) => {
      const note = cached ? 'saved' : `${row.latencyMs} ms`;
      process.stdout.write(`  ${row.provider} ${row.input} ${row.style}: ${row.outcome} (${note})\n`);
    },
  });
  const failed = rows.filter((row) => row.outcome === 'failed').length;
  process.stdout.write(`Wrote ${join(outDir, 'results.csv')} and ${args.providers.length} contact sheets.\n`);
  if (failed > 0) {
    process.stdout.write(`${failed} renders failed; run again to retry only those.\n`);
    process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`bakeoff: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
