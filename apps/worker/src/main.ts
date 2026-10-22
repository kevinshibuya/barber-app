import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WORKER_ENV } from '@barber/shared';
import { AppModule } from './app.module';
import { NightlyCleanup } from './cleanup/cleanup';
import { readPreviewWorkerConfig } from './previews/config';
import { PreviewWorker } from './previews/preview-worker';
import { createImageProvider } from './previews/providers';
import { createServiceClient } from './service-client';

async function bootstrap(): Promise<void> {
  const config = readPreviewWorkerConfig(process.env);
  const db = createServiceClient(process.env);
  const previews = new PreviewWorker({
    db,
    provider: createImageProvider(config.provider, process.env),
    concurrency: config.concurrency,
    staleAfterSeconds: config.staleAfterSeconds,
  });

  const app = await NestFactory.create(AppModule.forRoot({ db }));
  await app.listen(Number(process.env[WORKER_ENV.port] ?? 3000));
  const cleanup = new NightlyCleanup({ db });
  previews.start();
  cleanup.start();

  // Rows in flight are settled before the process exits.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void Promise.all([previews.stop(), cleanup.stop()]).then(() => app.close());
    });
  }
}

void bootstrap();
