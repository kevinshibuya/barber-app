import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WORKER_ENV } from '@barber/shared';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env[WORKER_ENV.port] ?? 3000));
}

void bootstrap();
