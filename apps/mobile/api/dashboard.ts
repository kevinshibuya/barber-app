import { supabase } from './supabase';

export interface Dashboard {
  visitsThisWeek: number;
  visitsThisMonth: number;
  visitsPerBarber: { barberId: string; displayName: string; visits: number }[];
  topHairStyles: { styleId: string; name: string; visits: number }[];
  topBeardStyles: { styleId: string; name: string; visits: number }[];
  returningClientShare: number;
  totalClients: number;
}

interface StyleCountRow {
  style_id: string | null;
  name: string | null;
  visits: number | null;
}

function toStyleCount(row: StyleCountRow) {
  return { styleId: row.style_id ?? '', name: row.name ?? '', visits: row.visits ?? 0 };
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  if (data === null) throw new Error('a dashboard view returned no data');
  return data;
}

// The owner's numbers, one read per dashboard view. Row-level security scopes
// every view to the caller's shop, and the views return no rows to a barber
// who is not its owner, which is an error here: the screen asks only for owners.
export async function getDashboard(): Promise<Dashboard> {
  const db = supabase();
  const [counts, perBarber, topHair, topBeard, returning, total] = await Promise.all([
    db.from('dashboard_visit_counts').select('visits_this_week, visits_this_month').maybeSingle(),
    db.from('dashboard_visits_per_barber').select('barber_id, display_name, visits'),
    db.from('dashboard_top_hair_styles').select('style_id, name, visits'),
    db.from('dashboard_top_beard_styles').select('style_id, name, visits'),
    db.from('dashboard_returning_clients').select('returning_share').maybeSingle(),
    db.from('dashboard_total_clients').select('total_clients').maybeSingle(),
  ]);
  const visitCounts = unwrap(counts);
  const returningClients = unwrap(returning);
  const totalClients = unwrap(total);
  return {
    visitsThisWeek: visitCounts.visits_this_week ?? 0,
    visitsThisMonth: visitCounts.visits_this_month ?? 0,
    visitsPerBarber: unwrap(perBarber).map((row) => ({
      barberId: row.barber_id ?? '',
      displayName: row.display_name ?? '',
      visits: row.visits ?? 0,
    })),
    topHairStyles: unwrap(topHair).map(toStyleCount),
    topBeardStyles: unwrap(topBeard).map(toStyleCount),
    returningClientShare: returningClients.returning_share ?? 0,
    totalClients: totalClients.total_clients ?? 0,
  };
}
