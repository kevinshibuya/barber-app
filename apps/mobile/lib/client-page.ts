import { clientPagePath, MOBILE_ENV } from '@barber/shared';

// The client page link of a visit: the configured base URL, the worker's
// origin, followed by `/v/<share token>`.
export function clientPageUrl(shareToken: string): string {
  const base = process.env.EXPO_PUBLIC_CLIENT_PAGE_BASE_URL;
  if (!base) throw new Error(`${MOBILE_ENV.clientPageBaseUrl} must be set`);
  return `${base.replace(/\/+$/, '')}${clientPagePath(shareToken)}`;
}
