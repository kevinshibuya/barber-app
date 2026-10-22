// Uploads the style reference images under seed/styles to the styles bucket of
// any Supabase project, with the service role. Each `seed/styles/<dimension>/
// <slug>.png` goes to `<dimension>/<slug>.png`, the style row's
// reference_image_path. Idempotent: an object that exists is overwritten, so
// a second run leaves one object per style.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type Database, STORAGE_BUCKETS, STYLE_DIMENSIONS, styleReferencePath, WORKER_ENV } from '../src';

const SEED_DIR = join(__dirname, '..', 'seed', 'styles');

const USAGE = `Usage: pnpm --filter @barber/shared run upload-styles

Uploads every seed/styles/<dimension>/<slug>.png to <dimension>/<slug>.png in
the ${STORAGE_BUCKETS.styles} bucket, overwriting what is there.

Runs against ${WORKER_ENV.supabaseUrl} with ${WORKER_ENV.supabaseServiceRoleKey}.`;

export async function uploadStyles(service: SupabaseClient<Database>, seedDir = SEED_DIR): Promise<string[]> {
  const bucket = service.storage.from(STORAGE_BUCKETS.styles);
  const uploaded: string[] = [];
  for (const dimension of STYLE_DIMENSIONS) {
    const files = readdirSync(join(seedDir, dimension)).filter((f) => f.endsWith('.png')).sort();
    for (const file of files) {
      const path = styleReferencePath(dimension, file.slice(0, -'.png'.length));
      const { error } = await bucket.upload(path, readFileSync(join(seedDir, dimension, file)), {
        contentType: 'image/png',
        upsert: true,
      });
      if (error) throw new Error(`${path}: ${error.message}`);
      uploaded.push(path);
    }
  }
  return uploaded;
}

async function main(argv: string[]): Promise<void> {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.includes('-h') || args.includes('--help')) {
    console.log(USAGE);
    return;
  }
  if (args.length > 0) {
    console.error(`unexpected arguments: ${args.join(' ')}\n\n${USAGE}`);
    process.exitCode = 64;
    return;
  }

  const url = process.env[WORKER_ENV.supabaseUrl];
  const key = process.env[WORKER_ENV.supabaseServiceRoleKey];
  if (!url || !key) {
    console.error(`${WORKER_ENV.supabaseUrl} and ${WORKER_ENV.supabaseServiceRoleKey} must be set.`);
    process.exitCode = 64;
    return;
  }
  const service = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const path of await uploadStyles(service)) console.log(`uploaded ${STORAGE_BUCKETS.styles}/${path}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
