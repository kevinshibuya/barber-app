import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createClient } from '@supabase/supabase-js';
import { type Database, WORKER_ENV } from '@barber/shared';
import { AppModule } from './app.module';
import { readPreviewWorkerConfig } from './previews/config';
import { PreviewWorker } from './previews/preview-worker';
import { createImageProvider } from './previews/providers';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function bootstrap(): Promise<void> {
  const config = readPreviewWorkerConfig(process.env);
  const db = createClient<Database>(
    required(WORKER_ENV.supabaseUrl),
    required(WORKER_ENV.supabaseServiceRoleKey),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const previews = new PreviewWorker({
    db,
    provider: createImageProvider(config.provider, process.env),
    concurrency: config.concurrency,
    staleAfterSeconds: config.staleAfterSeconds,
  });

  const app = await NestFactory.create(AppModule.forRoot({ db }));
  await app.listen(Number(process.env[WORKER_ENV.port] ?? 3000));
  previews.start();

  // Rows in flight are settled before the process exits.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void previews.stop().then(() => app.close());
    });
  }
}

void bootstrap();
