// The image provider for a configured name. The real providers arrive behind
// the same interface; until then their names fail at startup.
import type { ImageProviderName } from '@barber/shared';
import { FakeImageProvider } from './fake-provider';
import type { ImageProvider } from './image-provider';

export function createImageProvider(name: ImageProviderName): ImageProvider {
  switch (name) {
    case 'fake':
      return new FakeImageProvider();
    case 'gemini':
    case 'flux':
    case 'seedream':
      throw new Error(`image provider ${name} is not built yet: set IMAGE_PROVIDER=fake`);
  }
}
