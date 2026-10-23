// The worker's preview settings, read from the environment by the names in
// `@barber/shared`'s WORKER_ENV.
import { IMAGE_PROVIDERS, type ImageProviderName, WORKER_ENV } from '@barber/shared';
import { PREVIEW_WORKER_DEFAULTS } from './preview-worker';

export interface PreviewWorkerConfig {
  provider: ImageProviderName;
  concurrency: number;
  staleAfterSeconds: number;
}

// The bake-off's pick (#18): it kept the client in every render, at about
// $0.037 a render. docs/bakeoff/ has the results.
export const DEFAULT_IMAGE_PROVIDER: ImageProviderName = 'nano-banana-2.1';

function isProviderName(value: string): value is ImageProviderName {
  return IMAGE_PROVIDERS.some((name) => name === value);
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} is ${raw}: expected a positive whole number`);
  }
  return value;
}

export function readPreviewWorkerConfig(env: NodeJS.ProcessEnv): PreviewWorkerConfig {
  const provider = env[WORKER_ENV.imageProvider] || DEFAULT_IMAGE_PROVIDER;
  if (!isProviderName(provider)) {
    throw new Error(
      `${WORKER_ENV.imageProvider} is ${provider}: expected one of ${IMAGE_PROVIDERS.join(', ')}`,
    );
  }
  return {
    provider,
    concurrency: positiveInteger(env, WORKER_ENV.previewConcurrency, PREVIEW_WORKER_DEFAULTS.concurrency),
    staleAfterSeconds: positiveInteger(
      env,
      WORKER_ENV.previewStaleTimeoutSeconds,
      PREVIEW_WORKER_DEFAULTS.staleAfterSeconds,
    ),
  };
}
