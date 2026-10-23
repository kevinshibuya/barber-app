import {
  anonKey,
  barber,
  createTestShop,
  deleteTestShop,
  must,
  serviceClient,
  supabaseUrl,
  type TestShop,
} from './support/supabase';

const service = serviceClient();
let shop: TestShop;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Brazil has kept UTC-3 all year since 2019; the views count weeks (from
// Monday) and months in São Paulo time.
const SAO_PAULO_OFFSET = -3 * HOUR;

function saoPauloStarts(now: Date) {
  const local = new Date(now.getTime() + SAO_PAULO_OFFSET);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const week = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday);
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return { week: week - SAO_PAULO_OFFSET, month: month - SAO_PAULO_OFFSET };
}

// Which side of the week and month boundaries the one boundary visit lands
// on, today: inside the month but before this week, inside this week but
// before the month (a week that began last month), or neither exists.
type Boundary = 'month-only' | 'week-only' | 'none';

let boundary: Boundary;

beforeAll(async () => {
  shop = await createTestShop(service, ['owner', 'barber']);
  const owner = barber(shop, 'owner').id;
  const plainBarber = barber(shop, 'barber').id;

  const styles = must(await service.from('styles').select('id, dimension, slug'));
  const style = (dimension: string, slug: string) => {
    const found = styles.find((s) => s.dimension === dimension && s.slug === slug);
    if (!found) throw new Error(`no ${dimension} style ${slug}`);
    return found.id;
  };

  // Four clients; the fourth never had a visit.
  const clients = must(
    await service
      .from('clients')
      .insert(['c1', 'c2', 'c3', 'c4'].map((name) => ({ shop_id: shop.id, name })))
      .select('id, name'),
  );
  const client = (name: string) => clients.find((c) => c.name === name)!.id;
  const [c1, c2, c3] = [client('c1'), client('c2'), client('c3')];

  const now = new Date(Date.now() - 1000);
  const recent = now.toISOString();
  const old = new Date(now.getTime() - 400 * DAY).toISOString();

  // This month's chosen looks: hair 6, 5, 4, 3, 2, 1 across six styles, and
  // seven more visits that kept the hair; beards 4, 3, 2, 1, the rest kept.
  const hairCounts: [string, number][] = [
    ['buzz-cut', 6],
    ['crew-cut', 5],
    ['low-fade', 4],
    ['mid-fade', 3],
    ['high-skin-fade', 2],
    ['taper', 1],
    ['keep', 7],
  ];
  const beards = [
    ...Array<string>(4).fill('clean-shaven'),
    ...Array<string>(3).fill('stubble'),
    ...Array<string>(2).fill('short-boxed'),
    'full-beard',
  ];
  const hairs = hairCounts.flatMap(([slug, count]) => Array<string>(count).fill(slug));
  const thisMonth = hairs.map((hair, index) => ({
    shop_id: shop.id,
    // c2 has one visit now and one a year ago; c1 has the rest.
    client_id: index === 0 ? c2 : c1,
    // The owner runs 16 of these 28 visits, the barber 12.
    barber_id: index < 16 ? owner : plainBarber,
    chosen_hair_style_id: style('hair', hair),
    chosen_beard_style_id: style('beard', beards[index] ?? 'keep'),
    created_at: recent,
  }));

  // A year ago: goatees and buzz cuts that must not count this month.
  const lastYear = [c1, c2, c3].map((client_id) => ({
    shop_id: shop.id,
    client_id,
    barber_id: plainBarber,
    chosen_hair_style_id: style('hair', 'taper'),
    chosen_beard_style_id: style('beard', 'goatee'),
    created_at: old,
  }));

  const starts = saoPauloStarts(now);
  const iso = (time: number) => new Date(time).toISOString();
  const boundaryVisits = [];
  if (starts.week - starts.month > 2 * HOUR) {
    boundary = 'month-only';
    boundaryVisits.push({ shop_id: shop.id, client_id: c1, barber_id: owner, created_at: iso(starts.month + HOUR) });
  } else if (starts.month - starts.week > 2 * HOUR) {
    boundary = 'week-only';
    boundaryVisits.push({ shop_id: shop.id, client_id: c1, barber_id: owner, created_at: iso(starts.week + HOUR) });
  } else {
    boundary = 'none';
  }

  must(await service.from('visits').insert([...thisMonth, ...lastYear, ...boundaryVisits]).select('id'));
});

afterAll(async () => {
  await deleteTestShop(service, shop);
});

describe('the owner dashboard views', () => {
  it('counts visits this week and this month', async () => {
    const rows = must(await barber(shop, 'owner').db.from('dashboard_visit_counts').select('*'));
    const expected = {
      'month-only': { visits_this_week: 28, visits_this_month: 29 },
      'week-only': { visits_this_week: 29, visits_this_month: 28 },
      none: { visits_this_week: 28, visits_this_month: 28 },
    }[boundary];
    expect(rows).toEqual([expected]);
  });

  it('counts visits per barber this month', async () => {
    const rows = must(await barber(shop, 'owner').db.from('dashboard_visits_per_barber').select('*'));
    const ownerVisits = boundary === 'month-only' ? 17 : 16;
    expect(rows).toEqual([
      { barber_id: barber(shop, 'owner').id, display_name: 'owner 0', visits: ownerVisits },
      { barber_id: barber(shop, 'barber').id, display_name: 'barber 1', visits: 12 },
    ]);
  });

  it('lists the top five hair styles this month, keep left out', async () => {
    const rows = must(await barber(shop, 'owner').db.from('dashboard_top_hair_styles').select('slug, name, visits'));
    expect(rows).toEqual([
      { slug: 'buzz-cut', name: 'Raspado na máquina', visits: 6 },
      { slug: 'crew-cut', name: 'Corte social', visits: 5 },
      { slug: 'low-fade', name: 'Degradê baixo', visits: 4 },
      { slug: 'mid-fade', name: 'Degradê médio', visits: 3 },
      { slug: 'high-skin-fade', name: 'Degradê navalhado alto', visits: 2 },
    ]);
  });

  it('lists the top three beards this month, keep left out', async () => {
    const rows = must(await barber(shop, 'owner').db.from('dashboard_top_beard_styles').select('slug, visits'));
    expect(rows).toEqual([
      { slug: 'clean-shaven', visits: 4 },
      { slug: 'stubble', visits: 3 },
      { slug: 'short-boxed', visits: 2 },
    ]);
  });

  it('gives the share of clients with two or more visits', async () => {
    const rows = must(await barber(shop, 'owner').db.from('dashboard_returning_clients').select('*'));
    expect(rows).toEqual([{ returning_clients: 2, total_clients: 4, returning_share: 0.5 }]);
  });

  it('counts the shop\'s clients', async () => {
    const rows = must(await barber(shop, 'owner').db.from('dashboard_total_clients').select('*'));
    expect(rows).toEqual([{ total_clients: 4 }]);
  });

  it('returns no rows to a barber who is not the owner', async () => {
    const { db } = barber(shop, 'barber');
    for (const view of [
      'dashboard_visit_counts',
      'dashboard_visits_per_barber',
      'dashboard_top_hair_styles',
      'dashboard_top_beard_styles',
      'dashboard_returning_clients',
      'dashboard_total_clients',
    ] as const) {
      expect([view, must(await db.from(view).select('*'))]).toEqual([view, []]);
    }
  });

  it('keeps the generation view out of the API', async () => {
    for (const role of ['owner', 'barber'] as const) {
      const { data } = await barber(shop, role).db.auth.getSession();
      const headers = {
        apikey: anonKey(),
        Authorization: `Bearer ${data.session!.access_token}`,
      };
      const internal = await fetch(`${supabaseUrl()}/rest/v1/generation_attempts`, {
        headers: { ...headers, 'Accept-Profile': 'internal' },
      });
      const body = (await internal.json()) as { code?: string };
      expect([role, internal.ok, body.code]).toEqual([role, false, 'PGRST106']);

      const asPublic = await fetch(`${supabaseUrl()}/rest/v1/generation_attempts`, { headers });
      expect([role, asPublic.ok]).toEqual([role, false]);
    }
  });
});
