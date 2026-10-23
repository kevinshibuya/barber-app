// Google Gemini image, the Nano Banana 2 line, through generateContent. The
// base image, the references and the instruction go in one user turn; the
// answer's first inline image is the render. A prompt blocked, a candidate
// stopped on safety grounds, or an answer in text only is the model's refusal.
import type { ImageProvider, RenderRequest, RenderResult } from './image-provider';
import {
  editInstruction,
  type HttpProviderOptions,
  httpFailure,
  isRecord,
  mimeType,
  postJson,
  refused,
  retryable,
} from './provider-http';

// The Gemini model each provider name runs: `gemini` is Nano Banana 2.
export const GEMINI_IMAGE_MODELS = {
  gemini: 'gemini-3.1-flash-image',
  'nano-banana-2.1': 'gemini-nano-banana-2.1',
} as const;

export type GeminiProviderName = keyof typeof GEMINI_IMAGE_MODELS;

// Finish reasons that mean the model would not draw this, as opposed to a
// render that came back empty for no stated reason.
const SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);

function inlineImage(parts: unknown): Buffer | undefined {
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    const data = isRecord(part) && isRecord(part.inlineData) ? part.inlineData.data : undefined;
    if (typeof data === 'string' && data !== '') return Buffer.from(data, 'base64');
  }
  return undefined;
}

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join(' ')
    .trim();
}

export class GeminiImageProvider implements ImageProvider {
  private readonly endpoint: string;

  constructor(
    private readonly options: HttpProviderOptions,
    readonly name: GeminiProviderName = 'gemini',
  ) {
    this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODELS[name]}:generateContent`;
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const images = [request.base, ...request.references].map((image) => ({
      inlineData: { mimeType: mimeType(image), data: image.toString('base64') },
    }));
    const answer = await postJson(
      this.options,
      this.endpoint,
      { 'x-goog-api-key': this.options.apiKey },
      {
        contents: [{ role: 'user', parts: [...images, { text: editInstruction(request) }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '1K' } },
      },
    );
    if (!answer.ok) return answer;
    const { status, body } = answer;
    if (status < 200 || status >= 300) return httpFailure(status, body);
    if (!isRecord(body)) return retryable('gemini: empty answer');

    const blockReason = isRecord(body.promptFeedback) ? body.promptFeedback.blockReason : undefined;
    if (typeof blockReason === 'string' && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
      return refused(`gemini: prompt blocked (${blockReason})`);
    }
    const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
    if (!isRecord(candidate)) return retryable('gemini: no candidate in the answer');
    const parts = isRecord(candidate.content) ? candidate.content.parts : undefined;
    const image = inlineImage(parts);
    if (image) return { ok: true, image };
    const finishReason = typeof candidate.finishReason === 'string' ? candidate.finishReason : 'none';
    if (SAFETY_FINISH_REASONS.has(finishReason)) return refused(`gemini: refused (${finishReason})`);
    // Asked for an image only, the model answering in words is a decline.
    const text = textOf(parts);
    if (text !== '') return refused(`gemini: declined in text: ${text.slice(0, 200)}`);
    return retryable(`gemini: no image in the answer (finish reason ${finishReason})`);
  }
}
