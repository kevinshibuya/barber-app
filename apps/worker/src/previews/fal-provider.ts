// FLUX.2 Pro Edit and Seedream 4.5 Edit, both on fal.ai's synchronous
// endpoint. The images go as data URIs, the base first, and `sync_mode` brings
// the render back as a data URI too; an http URL is downloaded instead. fal
// answers a moderation rejection with HTTP 422 and a `content_policy_violation`
// detail, which is the model's refusal.
import sharp from 'sharp';
import type { ImageProviderName } from '@barber/shared';
import type { ImageProvider, RenderRequest, RenderResult } from './image-provider';
import {
  editInstruction,
  type Failed,
  type HttpProviderOptions,
  httpFailure,
  isRecord,
  mimeType,
  OUTPUT_LONG_EDGE,
  postJson,
  refused,
  retryable,
} from './provider-http';

const FAL_RUN = 'https://fal.run';

function dataUri(image: Buffer): string {
  return `data:${mimeType(image)};base64,${image.toString('base64')}`;
}

function isContentPolicyViolation(body: unknown): boolean {
  return (
    isRecord(body) &&
    Array.isArray(body.detail) &&
    body.detail.some((d) => isRecord(d) && d.type === 'content_policy_violation')
  );
}

async function download(options: HttpProviderOptions, url: string): Promise<Buffer | Failed> {
  const dataPrefix = /^data:[^;,]*;base64,/.exec(url);
  if (dataPrefix) return Buffer.from(url.slice(dataPrefix[0].length), 'base64');
  try {
    const response = await (options.fetch ?? fetch)(url);
    if (!response.ok) return httpFailure(response.status, `download of ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return retryable(`download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// One call to a fal model: its input is the shared images and prompt plus the
// model's own fields.
async function renderOnFal(
  options: HttpProviderOptions,
  name: ImageProviderName,
  model: string,
  request: RenderRequest,
  input: Record<string, unknown>,
): Promise<Buffer | Failed> {
  const answer = await postJson(
    options,
    `${FAL_RUN}/${model}`,
    { authorization: `Key ${options.apiKey}` },
    {
      prompt: editInstruction(request),
      image_urls: [request.base, ...request.references].map(dataUri),
      sync_mode: true,
      ...input,
    },
  );
  if (!answer.ok) return answer;
  const { status, body } = answer;
  if (status === 422 && isContentPolicyViolation(body)) return refused(`${name}: refused by content policy`);
  if (status < 200 || status >= 300) return httpFailure(status, body);
  if (!isRecord(body)) return retryable(`${name}: empty answer`);
  if (Array.isArray(body.has_nsfw_concepts) && body.has_nsfw_concepts.includes(true)) {
    return refused(`${name}: the render was flagged by the safety checker`);
  }
  const image = Array.isArray(body.images) ? body.images[0] : undefined;
  const url = isRecord(image) ? image.url : undefined;
  if (typeof url !== 'string' || url === '') return retryable(`${name}: no image in the answer`);
  return download(options, url);
}

// The base's size scaled to OUTPUT_LONG_EDGE on its long edge, in the
// multiples of 16 FLUX renders at.
async function oneK(base: Buffer): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(base).rotate().metadata();
  if (!width || !height) throw new Error('the base image has no size');
  const scale = OUTPUT_LONG_EDGE / Math.max(width, height);
  const round = (n: number) => Math.max(16, Math.round((n * scale) / 16) * 16);
  return { width: round(width), height: round(height) };
}

export class FluxImageProvider implements ImageProvider {
  readonly name = 'flux';

  constructor(private readonly options: HttpProviderOptions) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const image = await renderOnFal(this.options, this.name, 'fal-ai/flux-2-pro/edit', request, {
      image_size: await oneK(request.base),
      output_format: 'jpeg',
    });
    return Buffer.isBuffer(image) ? { ok: true, image } : image;
  }
}

// FLUX.2 [klein] 4B, the small open-weight FLUX.2, on the same request as Pro.
export class FluxKleinImageProvider implements ImageProvider {
  readonly name = 'flux-klein';

  constructor(private readonly options: HttpProviderOptions) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const image = await renderOnFal(this.options, this.name, 'fal-ai/flux-2/klein/4b/edit', request, {
      image_size: await oneK(request.base),
      output_format: 'jpeg',
    });
    return Buffer.isBuffer(image) ? { ok: true, image } : image;
  }
}

// Seedream 4.5 renders no smaller than about 3.7 megapixels, so it is asked
// for its smallest preset, 2K at the base's aspect ratio, and the render is
// scaled down to 1K here.
export class SeedreamImageProvider implements ImageProvider {
  readonly name = 'seedream';

  constructor(private readonly options: HttpProviderOptions) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    const image = await renderOnFal(this.options, this.name, 'fal-ai/bytedance/seedream/v4.5/edit', request, {
      image_size: 'auto_2K',
      num_images: 1,
      max_images: 1,
    });
    if (!Buffer.isBuffer(image)) return image;
    const scaled = await sharp(image)
      .rotate()
      .resize(OUTPUT_LONG_EDGE, OUTPUT_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
    return { ok: true, image: scaled };
  }
}
