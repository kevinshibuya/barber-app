// The client page in a headless Chromium at phone width: a visit seeded
// through the service role, the worker's HTTP app on a free local port, and
// the page loaded the way a client's phone opens the WhatsApp link. Any
// console error, page error or failed request fails it.
//
// Chromium is Playwright's, pinned by the exact `playwright-core` version;
// when it is missing: `pnpm --filter @barber/worker exec playwright-core
// install chromium-headless-shell`. Set CLIENT_PAGE_SMOKE_SCREENSHOT to a
// path to keep a full-page screenshot.
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type Browser, chromium } from 'playwright-core';
import { clientPagePath, STORAGE_BUCKETS } from '@barber/shared';
import { AppModule } from '../../src/app.module';
import { seedClientPageVisit } from '../support/client-page';
import { createTestShop, deleteTestShop, must, serviceClient, type TestShop } from '../support/supabase';

jest.setTimeout(60_000);

const service = serviceClient();
let shop: TestShop | undefined;
let app: INestApplication | undefined;
let browser: Browser | undefined;

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await deleteTestShop(service, shop, [STORAGE_BUCKETS.originals, STORAGE_BUCKETS.previews]);
});

it("renders a seeded visit's page at phone width with no console errors", async () => {
  shop = await createTestShop(service);
  const { token } = await seedClientPageVisit(service, shop, {
    slots: ['left', 'right'],
    done: [
      { hair: 'low-fade', beard: 'keep' },
      { hair: 'quiff', beard: 'keep' },
      { hair: 'keep', beard: 'full-beard' },
      { hair: 'keep', beard: 'goatee' },
      { hair: 'low-fade', beard: 'full-beard' },
      { hair: 'low-fade', beard: 'keep', slot: 'left' },
    ],
    chosen: { hair: 'low-fade', beard: 'full-beard' },
    after: true,
  });
  const shopName = must(await service.from('shops').select('name').eq('id', shop.id).single()).name;

  app = await NestFactory.create(AppModule.forRoot({ db: service }), { logger: false });
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}${clientPagePath(token)}`;

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
  );

  const response = await page.goto(url, { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('main h1').textContent()).resolves.toBe(shopName);

  // Swipe to the strip's last tile so its lazy images load too.
  await page.locator('.strip li').last().scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');

  const images = await page
    .locator('img')
    .evaluateAll((imgs) => imgs.map((img) => ({ complete: (img as HTMLImageElement).complete, width: (img as HTMLImageElement).naturalWidth })));
  expect(images.length).toBeGreaterThanOrEqual(10);
  expect(images.filter((img) => !img.complete || img.width === 0)).toEqual([]);
  // Nothing wider than the phone: the page itself never scrolls sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const screenshot = process.env.CLIENT_PAGE_SMOKE_SCREENSHOT;
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });

  expect(problems).toEqual([]);
});
