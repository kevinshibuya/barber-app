// The real image providers, driven through the ImageProvider interface with
// HTTP faked at the transport: each test hands the provider a `fetch` that
// records what was sent and answers with a scripted response. No test calls a
// vendor.
import sharp from 'sharp';
import { readPreviewWorkerConfig } from '../src/previews/config';
import type { ImageProvider, RenderRequest } from '../src/previews/image-provider';
import { FluxImageProvider, FluxKleinImageProvider, SeedreamImageProvider } from '../src/previews/fal-provider';
import { GeminiImageProvider } from '../src/previews/gemini-provider';
import { createImageProvider } from '../src/previews/providers';

interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

// A `fetch` that answers each call with the next scripted response.
function transport(...responses: Response[]): { fetch: typeof fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  };
  return { fetch: fake as typeof fetch, sent };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROMPT = 'Give the person a low fade.';
let request: RenderRequest;
let rendered: Buffer;

beforeAll(async () => {
  const [base, reference] = await Promise.all([
    sharp({ create: { width: 768, height: 1024, channels: 3, background: '#a33' } }).jpeg().toBuffer(),
    sharp({ create: { width: 64, height: 64, channels: 3, background: '#2a6' } }).png().toBuffer(),
  ]);
  request = { base, references: [reference], prompt: PROMPT };
  rendered = await sharp({ create: { width: 768, height: 1024, channels: 3, background: '#36c' } })
    .png()
    .toBuffer();
});

function geminiImage(image: Buffer): Response {
  return json(200, {
    candidates: [
      {
        content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] },
        finishReason: 'STOP',
      },
    ],
  });
}

describe('the Gemini provider', () => {
  it('sends the base photo, the reference image and the prompt for a 1K image, and returns its bytes', async () => {
    const http = transport(geminiImage(rendered));
    const provider: ImageProvider = new GeminiImageProvider({ apiKey: 'gemini-key', fetch: http.fetch });

    const result = await provider.render(request);

    expect(result).toEqual({ ok: true, image: rendered });
    expect(provider.name).toBe('gemini');
    expect(http.sent).toHaveLength(1);
    const [sent] = http.sent;
    expect(sent!.method).toBe('POST');
    expect(sent!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    );
    expect(sent!.headers.get('x-goog-api-key')).toBe('gemini-key');
    expect(sent!.body).toMatchObject({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: request.base.toString('base64') } },
            { inlineData: { mimeType: 'image/png', data: request.references[0]!.toString('base64') } },
            { text: expect.stringContaining(PROMPT) },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '1K' } },
    });
  });

  it.each([
    ['a rate limit', json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } })],
    ['a server error', json(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded' } })],
    ['an answer with no image', json(200, { candidates: [{ content: { parts: [{ text: 'Sure!' }] }, finishReason: 'STOP' }] })],
  ])('maps %s to a retryable failure', async (_case, response) => {
    const http = transport(response);
    const result = await new GeminiImageProvider({ apiKey: 'k', fetch: http.fetch }).render(request);
    expect(result).toMatchObject({ ok: false, failure: 'retryable' });
  });

  it.each([
    ['a blocked prompt', json(200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })],
    ['an image stopped on safety', json(200, { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] })],
  ])('maps %s to a refusal', async (_case, response) => {
    const http = transport(response);
    const result = await new GeminiImageProvider({ apiKey: 'k', fetch: http.fetch }).render(request);
    expect(result).toMatchObject({ ok: false, failure: 'refused' });
  });

  it('maps a transport error to a retryable failure', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const result = await new GeminiImageProvider({ apiKey: 'k', fetch: failing }).render(request);
    expect(result).toEqual({ ok: false, failure: 'retryable', message: 'request failed: fetch failed' });
  });
});

function dataUri(image: Buffer, type: string): string {
  return `data:${type};base64,${image.toString('base64')}`;
}

function falImage(url: string, extra: Record<string, unknown> = {}): Response {
  return json(200, { images: [{ url, content_type: 'image/jpeg' }], seed: 7, ...extra });
}

describe('the Nano Banana 2.1 provider', () => {
  it('is the Gemini provider on the Nano Banana 2.1 model', async () => {
    const http = transport(geminiImage(rendered));
    const provider: ImageProvider = new GeminiImageProvider(
      { apiKey: 'gemini-key', fetch: http.fetch },
      'nano-banana-2.1',
    );

    const result = await provider.render(request);

    expect(result).toEqual({ ok: true, image: rendered });
    expect(provider.name).toBe('nano-banana-2.1');
    const [sent] = http.sent;
    expect(sent!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent',
    );
    expect(sent!.body).toMatchObject({
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '1K' } },
    });
  });
});

describe('the FLUX.2 Pro Edit provider', () => {
  it('sends the base photo, the reference image and the prompt to fal.ai for a 1K image, and returns its bytes', async () => {
    const large = await sharp({ create: { width: 1536, height: 2048, channels: 3, background: '#a33' } })
      .jpeg()
      .toBuffer();
    const http = transport(falImage(dataUri(rendered, 'image/png')));
    const provider: ImageProvider = new FluxImageProvider({ apiKey: 'fal-key', fetch: http.fetch });

    const result = await provider.render({ ...request, base: large });

    expect(result).toEqual({ ok: true, image: rendered });
    expect(provider.name).toBe('flux');
    expect(http.sent).toHaveLength(1);
    const [sent] = http.sent;
    expect(sent!.method).toBe('POST');
    expect(sent!.url).toBe('https://fal.run/fal-ai/flux-2-pro/edit');
    expect(sent!.headers.get('authorization')).toBe('Key fal-key');
    expect(sent!.body).toMatchObject({
      prompt: expect.stringContaining(PROMPT),
      image_urls: [dataUri(large, 'image/jpeg'), dataUri(request.references[0]!, 'image/png')],
      image_size: { width: 768, height: 1024 },
      sync_mode: true,
    });
  });
});

describe('the FLUX.2 [klein] 4B Edit provider', () => {
  it('sends the base photo, the reference image and the prompt to fal.ai for a 1K JPEG, and returns its bytes', async () => {
    const http = transport(falImage(dataUri(rendered, 'image/png')));
    const provider: ImageProvider = new FluxKleinImageProvider({ apiKey: 'fal-key', fetch: http.fetch });

    const result = await provider.render(request);

    expect(result).toEqual({ ok: true, image: rendered });
    expect(provider.name).toBe('flux-klein');
    const [sent] = http.sent;
    expect(sent!.url).toBe('https://fal.run/fal-ai/flux-2/klein/4b/edit');
    expect(sent!.headers.get('authorization')).toBe('Key fal-key');
    expect(sent!.body).toMatchObject({
      prompt: expect.stringContaining(PROMPT),
      image_urls: [dataUri(request.base, 'image/jpeg'), dataUri(request.references[0]!, 'image/png')],
      output_format: 'jpeg',
      sync_mode: true,
    });
  });
});

describe('the Seedream 4.5 Edit provider', () => {
  it('sends the base photo, the reference image and the prompt to fal.ai, and returns the render scaled to 1K', async () => {
    const twoK = await sharp({ create: { width: 1536, height: 2048, channels: 3, background: '#36c' } })
      .png()
      .toBuffer();
    const http = transport(falImage(dataUri(twoK, 'image/png')));
    const provider: ImageProvider = new SeedreamImageProvider({ apiKey: 'fal-key', fetch: http.fetch });

    const result = await provider.render(request);

    expect(provider.name).toBe('seedream');
    expect(result.ok).toBe(true);
    const image = result.ok ? result.image : Buffer.alloc(0);
    expect(await sharp(image).metadata()).toMatchObject({ format: 'jpeg', width: 768, height: 1024 });
    expect(http.sent).toHaveLength(1);
    const [sent] = http.sent;
    expect(sent!.method).toBe('POST');
    expect(sent!.url).toBe('https://fal.run/fal-ai/bytedance/seedream/v4.5/edit');
    expect(sent!.headers.get('authorization')).toBe('Key fal-key');
    expect(sent!.body).toMatchObject({
      prompt: expect.stringContaining(PROMPT),
      image_urls: [dataUri(request.base, 'image/jpeg'), dataUri(request.references[0]!, 'image/png')],
      image_size: 'auto_2K',
      num_images: 1,
      sync_mode: true,
    });
  });

  it('downloads a render fal.ai answers with as a URL', async () => {
    const url = 'https://v3.fal.media/files/render.png';
    const http = transport(falImage(url), new Response(new Uint8Array(rendered), { status: 200 }));

    const result = await new SeedreamImageProvider({ apiKey: 'k', fetch: http.fetch }).render(request);

    expect(result.ok).toBe(true);
    expect(http.sent.map((s) => [s.method, s.url])).toEqual([
      ['POST', 'https://fal.run/fal-ai/bytedance/seedream/v4.5/edit'],
      ['GET', url],
    ]);
  });
});

describe.each([
  ['FLUX.2 Pro Edit', FluxImageProvider],
  ['Seedream 4.5 Edit', SeedreamImageProvider],
])('the %s provider', (_name, Provider) => {
  it.each([
    ['a rate limit', json(429, { detail: 'Too many requests' })],
    ['a server error', json(500, { detail: 'Internal server error' })],
    ['an answer with no image', json(200, { images: [] })],
  ])('maps %s to a retryable failure', async (_case, response) => {
    const http = transport(response);
    const result = await new Provider({ apiKey: 'k', fetch: http.fetch }).render(request);
    expect(result).toMatchObject({ ok: false, failure: 'retryable' });
  });

  it.each([
    [
      'a content policy violation',
      json(422, {
        detail: [
          {
            loc: ['body', 'prompt'],
            msg: 'The content could not be processed because it contained material flagged by a content checker.',
            type: 'content_policy_violation',
            categories: ['model_moderated'],
          },
        ],
      }),
    ],
    ['a render flagged by the safety checker', falImage('data:image/png;base64,AAAA', { has_nsfw_concepts: [true] })],
  ])('maps %s to a refusal', async (_case, response) => {
    const http = transport(response);
    const result = await new Provider({ apiKey: 'k', fetch: http.fetch }).render(request);
    expect(result).toMatchObject({ ok: false, failure: 'refused' });
  });

  it('maps a validation error to a retryable failure, not a refusal', async () => {
    const http = transport(
      json(422, { detail: [{ loc: ['body', 'image_urls'], msg: 'Invalid image', type: 'image_load_error' }] }),
    );
    const result = await new Provider({ apiKey: 'k', fetch: http.fetch }).render(request);
    expect(result).toMatchObject({ ok: false, failure: 'retryable' });
  });
});

describe('choosing the provider at boot', () => {
  // What main.ts does with the environment before anything listens.
  function boot(env: NodeJS.ProcessEnv): ImageProvider {
    return createImageProvider(readPreviewWorkerConfig(env).provider, env);
  }

  // The bake-off's pick (#18).
  it('runs Nano Banana 2.1 when no provider is configured, on the Gemini key', () => {
    const provider = boot({ GEMINI_API_KEY: 'g' });
    expect(provider).toBeInstanceOf(GeminiImageProvider);
    expect(provider.name).toBe('nano-banana-2.1');
  });

  it('runs FLUX.2, FLUX.2 [klein] or Seedream by their configured names, on the fal.ai key', () => {
    expect(boot({ IMAGE_PROVIDER: 'flux', FAL_KEY: 'f' })).toBeInstanceOf(FluxImageProvider);
    expect(boot({ IMAGE_PROVIDER: 'flux-klein', FAL_KEY: 'f' })).toBeInstanceOf(FluxKleinImageProvider);
    expect(boot({ IMAGE_PROVIDER: 'seedream', FAL_KEY: 'f' })).toBeInstanceOf(SeedreamImageProvider);
  });

  it('runs Nano Banana 2.1 by its configured name, on the Gemini key', () => {
    const provider = boot({ IMAGE_PROVIDER: 'nano-banana-2.1', GEMINI_API_KEY: 'g' });
    expect(provider).toBeInstanceOf(GeminiImageProvider);
    expect(provider.name).toBe('nano-banana-2.1');
  });

  it('fails on an unknown provider name with the names it knows', () => {
    expect(() => boot({ IMAGE_PROVIDER: 'midjourney', FAL_KEY: 'f', GEMINI_API_KEY: 'g' })).toThrow(
      'IMAGE_PROVIDER is midjourney: expected one of gemini, nano-banana-2.1, flux, flux-klein, seedream, fake',
    );
  });

  it('fails when the configured provider has no key', () => {
    expect(() => boot({ GEMINI_API_KEY: '' })).toThrow(
      'GEMINI_API_KEY is not set: the nano-banana-2.1 image provider needs it',
    );
    expect(() => boot({ IMAGE_PROVIDER: 'seedream', GEMINI_API_KEY: 'g' })).toThrow(
      'FAL_KEY is not set: the seedream image provider needs it',
    );
  });
});
