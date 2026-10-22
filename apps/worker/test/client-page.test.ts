// The client page, `/v/<token>`, as a client's phone asks for it: HTTP
// against the Nest app over the local Supabase, with a visit seeded per test.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { clientPagePath, STORAGE_BUCKETS } from '@barber/shared';
import { AppModule } from '../src/app.module';
import { seedClientPageVisit } from './support/client-page';
import { createTestShop, deleteTestShop, must, serviceClient, type TestShop } from './support/supabase';

jest.setTimeout(30_000);

const service = serviceClient();
let shop: TestShop;
let app: INestApplication<App>;

beforeEach(async () => {
  shop = await createTestShop(service);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ db: service })],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterEach(async () => {
  await app?.close();
  await deleteTestShop(service, shop, [STORAGE_BUCKETS.originals, STORAGE_BUCKETS.previews]);
});

function get(token: string) {
  return request(app.getHttpServer()).get(clientPagePath(token));
}

describe('a live link', () => {
  it("renders the visit's page with the shop's name", async () => {
    const { token } = await seedClientPageVisit(service, shop);
    const shopRow = must(await service.from('shops').select('name').eq('id', shop.id).single());

    const res = await get(token).expect(200).expect('Content-Type', /text\/html/);

    expect(res.text).toContain(shopRow.name);
  });

  it('shows every done preview by its style names, and marks the chosen look', async () => {
    const { token } = await seedClientPageVisit(service, shop, {
      slots: ['left'],
      done: [
        { hair: 'low-fade', beard: 'keep' },
        { hair: 'keep', beard: 'full-beard' },
        { hair: 'low-fade', beard: 'full-beard' },
        { hair: 'low-fade', beard: 'keep', slot: 'left' },
      ],
      chosen: { hair: 'low-fade', beard: 'full-beard' },
    });

    const res = await get(token).expect(200);

    const items = stripItems(res.text);
    expect(items.map(itemText)).toEqual([
      'Degradê baixo',
      'Degradê baixo · Esquerda',
      'Barba cheia',
      'Degradê baixo + Barba cheia Visual escolhido',
    ]);
    const marked = items.filter((item) => item.includes('aria-current="true"'));
    expect(marked.map(itemText)).toEqual(['Degradê baixo + Barba cheia Visual escolhido']);
    // The trigger's other front previews are still pending: not on the page.
    expect(res.text).not.toContain('Degradê médio');
    expect(res.text).not.toContain('Cavanhaque');
  });

  it('serves every image as a signed URL that expires within the hour', async () => {
    const { visit, token, done } = await seedClientPageVisit(service, shop, {
      slots: ['left'],
      done: [
        { hair: 'low-fade', beard: 'keep' },
        { hair: 'keep', beard: 'full-beard' },
      ],
      chosen: { hair: 'low-fade', beard: 'keep' },
      after: true,
    });

    const res = await get(token).expect(200);

    const signed = imageSources(res.text).map(signedObject);
    const base = `${shop.id}/${visit.id}`;
    expect(new Set(signed.map((s) => s.object))).toEqual(
      new Set([
        `originals/${base}/front.jpg`,
        `originals/${base}/left.jpg`,
        `originals/${base}/after.jpg`,
        ...done.map((p) => `previews/${base}/${p.id}.jpg`),
      ]),
    );
    const now = Date.now() / 1000;
    for (const { url, object, claims } of signed) {
      expect(claims.exp).toBeGreaterThan(now);
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
      const image = await fetch(url);
      expect(image.status).toBe(200);
      expect(image.headers.get('content-type')).toBe('image/jpeg');
      // The buckets are private: the same object without the signature is refused.
      const unsigned = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/${object}`);
      expect(unsigned.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('runs no script, swipes on CSS alone, and is neither cached nor referred', async () => {
    const { token } = await seedClientPageVisit(service, shop, {
      done: [
        { hair: 'low-fade', beard: 'keep' },
        { hair: 'keep', beard: 'full-beard' },
      ],
    });

    const res = await get(token).expect(200);

    expect(res.text).not.toMatch(/<script/i);
    expect(res.text).not.toMatch(/\son[a-z]+=/i);
    expect(res.text).toMatch(/scroll-snap-type:\s*x mandatory/);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'none'/);
    expect(res.headers['cache-control']).toBe('no-store');
    // The token is in the URL: it must not travel to the image host.
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('shows the front photo as the look when the client kept hair and beard', async () => {
    const { visit, token } = await seedClientPageVisit(service, shop, {
      done: [{ hair: 'low-fade', beard: 'keep' }],
      chosen: { hair: 'keep', beard: 'keep' },
    });

    const res = await get(token).expect(200);

    const look = /<section class="look"[\s\S]*?<\/section>/.exec(res.text);
    expect(look).not.toBeNull();
    expect(itemText(look![0])).toContain('Visual escolhido');
    expect(imageSources(look![0]).map((src) => signedObject(src).object)).toEqual([
      `originals/${shop.id}/${visit.id}/front.jpg`,
    ]);
    expect(stripItems(res.text).filter((item) => item.includes('aria-current'))).toEqual([]);
  });
});

function imageSources(html: string): string[] {
  return [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
}

// A Supabase signed URL's object (`<bucket>/<path>`) and its token's claims.
function signedObject(url: string): { url: string; object: string; claims: { iat: number; exp: number } } {
  const parsed = new URL(url);
  expect(`${parsed.origin}`).toBe(new URL(process.env.SUPABASE_URL!).origin);
  const match = /^\/storage\/v1\/object\/sign\/(.+)$/.exec(parsed.pathname);
  if (!match?.[1]) throw new Error(`not a signed storage URL: ${url}`);
  const token = parsed.searchParams.get('token');
  if (!token) throw new Error(`no token on ${url}`);
  const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    iat: number;
    exp: number;
  };
  return { url, object: decodeURIComponent(match[1]), claims };
}

// The previews strip's items, as HTML.
function stripItems(html: string): string[] {
  const strip = /<ul class="strip"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  if (!strip?.[1]) throw new Error('the page has no previews strip');
  return [...strip[1].matchAll(/<li[\s\S]*?<\/li>/g)].map((m) => m[0]);
}

// An element's visible text, tags dropped and whitespace collapsed.
function itemText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('a dead link', () => {
  // Says the link is gone and shows nothing of any visit.
  function expectNotFound(res: request.Response, shopName: string) {
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Link não encontrado');
    expect(res.text).not.toContain(shopName);
  }

  async function shopName(): Promise<string> {
    return must(await service.from('shops').select('name').eq('id', shop.id).single()).name;
  }

  it('is 404 for a token past its expiry', async () => {
    const { visit, token } = await seedClientPageVisit(service, shop);
    must(
      await service
        .from('visits')
        .update({ share_expires_at: new Date(Date.now() - 1_000).toISOString() })
        .eq('id', visit.id)
        .select()
        .single(),
    );

    expectNotFound(await get(token), await shopName());
  });

  it('is 404 for a token the cleanup cleared', async () => {
    const { visit, token } = await seedClientPageVisit(service, shop);
    must(
      await service
        .from('visits')
        .update({ share_token: null, share_expires_at: null })
        .eq('id', visit.id)
        .select()
        .single(),
    );

    expectNotFound(await get(token), await shopName());
  });

  it('is 404 for a token no visit has', async () => {
    await seedClientPageVisit(service, shop);

    expectNotFound(await get('Ab3dEf6hIj9kLm2oPq5sTu8wXy1zAb4dEf7hIj0kLm3'), await shopName());
    expectNotFound(await get('not-a-token'), await shopName());
  });
});
