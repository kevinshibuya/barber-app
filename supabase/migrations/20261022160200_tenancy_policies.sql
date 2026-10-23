-- Row-level security: a signed-in barber reads and writes only their own
-- shop's rows, found through the barbers table. The service role (the worker,
-- provisioning) bypasses RLS. The catalog is readable by any signed-in barber
-- and writable by the service role only.

-- The caller's shop, or null for a caller with no barber row. Security definer
-- so the policies below can read barbers without recursing into its own
-- policy.
create function public.current_shop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select shop_id from public.barbers where id = auth.uid()
$$;

-- Whether the caller is their shop's owner.
create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.barbers where id = auth.uid() and role = 'owner')
$$;

revoke execute on function public.current_shop_id() from public, anon;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.current_shop_id() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;

create policy "barbers read the catalog"
on public.styles for select
to authenticated
using (true);

-- Shops and barbers are provisioned with the service role; barbers only read
-- their own shop and its barbers.
create policy "barbers read their shop"
on public.shops for select
to authenticated
using (id = public.current_shop_id());

create policy "barbers read their shop's barbers"
on public.barbers for select
to authenticated
using (shop_id = public.current_shop_id());

create policy "barbers manage their shop's clients"
on public.clients for all
to authenticated
using (shop_id = public.current_shop_id())
with check (shop_id = public.current_shop_id());

-- The composite foreign keys keep a visit's client and barber in its shop.
create policy "barbers manage their shop's visits"
on public.visits for all
to authenticated
using (shop_id = public.current_shop_id())
with check (shop_id = public.current_shop_id());

create policy "barbers manage their shop's photos"
on public.photos for all
to authenticated
using (
  exists (
    select 1 from public.visits
    where visits.id = photos.visit_id and visits.shop_id = public.current_shop_id()
  )
)
with check (
  exists (
    select 1 from public.visits
    where visits.id = photos.visit_id and visits.shop_id = public.current_shop_id()
  )
);
