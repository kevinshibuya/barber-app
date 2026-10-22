// The image provider for a configured name, on the key its vendor needs. A
// key that is not set fails at startup, before the worker claims anything.
import { type ImageProviderName, WORKER_ENV } from '@barber/shared';
import { FluxImageProvider, SeedreamImageProvider } from './fal-provider';
import { FakeImageProvider } from './fake-provider';
import { GeminiImageProvider } from './gemini-provider';
import type { ImageProvider } from './image-provider';

function key(env: NodeJS.ProcessEnv, variable: string, provider: ImageProviderName): string {
  const value = env[variable];
  if (!value) throw new Error(`${variable} is not set: the ${provider} image provider needs it`);
  return value;
}

export function createImageProvider(name: ImageProviderName, env: NodeJS.ProcessEnv = process.env): ImageProvider {
  switch (name) {
    case 'fake':
      return new FakeImageProvider();
    case 'gemini':
      return new GeminiImageProvider({ apiKey: key(env, WORKER_ENV.geminiApiKey, name) });
    case 'flux':
      return new FluxImageProvider({ apiKey: key(env, WORKER_ENV.falKey, name) });
    case 'seedream':
      return new SeedreamImageProvider({ apiKey: key(env, WORKER_ENV.falKey, name) });
  }
}
