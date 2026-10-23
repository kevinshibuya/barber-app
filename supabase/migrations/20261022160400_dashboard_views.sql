-- The owner dashboard: six views, one per number. Each is security_invoker,
-- so the caller's row-level security scopes it to their shop, and each
-- returns rows only when the caller is their shop's owner. Weeks start on
-- Monday and both weeks and months are counted in São Paulo time.

-- The start of the current week or month in São Paulo time.
create function public.local_period_start(unit text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc(unit, now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
$$;

create view public.dashboard_visit_counts
with (security_invoker = true)
as
select
  count(*) filter (where created_at >= public.local_period_start('week')) as visits_this_week,
  count(*) filter (where created_at >= public.local_period_start('month')) as visits_this_month
from public.visits
having public.is_owner();

-- Every barber of the shop, busiest first, including those with no visits.
create view public.dashboard_visits_per_barber
with (security_invoker = true)
as
select barbers.id as barber_id, barbers.display_name, count(visits.id) as visits
from public.barbers
left join public.visits
  on visits.barber_id = barbers.id
  and visits.created_at >= public.local_period_start('month')
where public.is_owner()
group by barbers.id, barbers.display_name
order by visits desc, barbers.display_name;

-- "Keep as is" is not a style the shop cut, so it is left out of both tops.
create view public.dashboard_top_hair_styles
with (security_invoker = true)
as
select styles.id as style_id, styles.slug, styles.name, count(*) as visits
from public.visits
join public.styles on styles.id = visits.chosen_hair_style_id
where public.is_owner()
  and visits.created_at >= public.local_period_start('month')
  and styles.slug <> 'keep'
group by styles.id, styles.slug, styles.name, styles.sort_order
order by visits desc, styles.sort_order
limit 5;

create view public.dashboard_top_beard_styles
with (security_invoker = true)
as
select styles.id as style_id, styles.slug, styles.name, count(*) as visits
from public.visits
join public.styles on styles.id = visits.chosen_beard_style_id
where public.is_owner()
  and visits.created_at >= public.local_period_start('month')
  and styles.slug <> 'keep'
group by styles.id, styles.slug, styles.name, styles.sort_order
order by visits desc, styles.sort_order
limit 3;

-- Clients with two or more visits ever, over all the shop's clients.
create view public.dashboard_returning_clients
with (security_invoker = true)
as
select
  count(*) filter (where visit_count >= 2) as returning_clients,
  count(*) as total_clients,
  coalesce((count(*) filter (where visit_count >= 2))::float8 / nullif(count(*), 0), 0) as returning_share
from (
  select clients.id, count(visits.id) as visit_count
  from public.clients
  left join public.visits on visits.client_id = clients.id
  group by clients.id
) as per_client
having public.is_owner();

create view public.dashboard_total_clients
with (security_invoker = true)
as
select count(*) as total_clients
from public.clients
having public.is_owner();

-- For us, in the SQL editor: usage per shop across every shop. The schema is
-- not in the API's exposed schemas and grants nothing to API roles.
create schema internal;
revoke all on schema internal from public, anon, authenticated;

-- Visits per shop and provider. Per-preview attempt counts join in once the
-- queue migration creates the previews table.
create view internal.generation_attempts as
select
  shops.id as shop_id,
  shops.name as shop_name,
  visits.provider_name,
  count(visits.id) as visits
from public.shops
left join public.visits on visits.shop_id = shops.id
group by shops.id, shops.name, visits.provider_name;

revoke all on internal.generation_attempts from public, anon, authenticated;
