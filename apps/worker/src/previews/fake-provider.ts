// The provider for tests and local runs: no network, a fixed image back. It
// can be scripted to fail or refuse every render of a style, which it knows by
// the style's prompt, and it keeps the requests it was given.
import sharp from 'sharp';
import type { ImageProvider, RenderFailure, RenderRequest, RenderResult } from './image-provider';

export interface FakeRenderCall extends RenderRequest {
  // Epoch milliseconds when the render was asked for.
  at: number;
}

export interface FakeImageProviderOptions {
  // The image every render returns; a 768 by 1024 grey JPEG when not given.
  image?: Buffer;
  // Runs before each render answers, such as to change the queue under it.
  beforeAnswer?: (request: RenderRequest) => Promise<void>;
}

let defaultImage: Promise<Buffer> | undefined;

function fixedImage(): Promise<Buffer> {
  defaultImage ??= sharp({ create: { width: 768, height: 1024, channels: 3, background: '#777' } })
    .jpeg()
    .toBuffer();
  return defaultImage;
}

export class FakeImageProvider implements ImageProvider {
  readonly name = 'fake';
  readonly calls: FakeRenderCall[] = [];
  private readonly scripted = new Map<string, RenderFailure>();

  constructor(private readonly options: FakeImageProviderOptions = {}) {}

  // Every later render with this prompt fails this way.
  script(prompt: string, failure: RenderFailure): void {
    this.scripted.set(prompt, failure);
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    this.calls.push({ ...request, at: Date.now() });
    await this.options.beforeAnswer?.(request);
    const failure = this.scripted.get(request.prompt);
    if (failure === 'refused') {
      return { ok: false, failure, message: 'fake provider: refused on safety grounds' };
    }
    if (failure === 'retryable') {
      return { ok: false, failure, message: 'fake provider: scripted retryable failure' };
    }
    return { ok: true, image: this.options.image ?? (await fixedImage()) };
  }
}
