-- The queue half of the schema: the previews table is the generation queue.
-- A front photo marked uploaded enqueues every active hair style (beard keep)
-- and every active beard style (hair keep). The worker claims rows with
-- `claim_previews` and settles them with `complete_preview` or `fail_preview`;
-- barbers add rows with `request_preview` and reset failed ones with
-- `retry_preview`. Nobody writes the table directly but those functions.
--
-- A preview pairing two generated styles is a combination. It is rendered on
-- the hair-only preview of its slot, its base, so it is never claimed before
-- its base is done and fails with its base.

create type public.preview_status as enum ('pending', 'running', 'done', 'failed', 'refused');

-- Higher is claimed first; `@barber/shared` mirrors these as PREVIEW_PRIORITY.
create function public.preview_priority(kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case kind when 'request' then 30 when 'hair' then 20 when 'beard' then 10 end
$$;

create table public.previews (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  hair_style_id uuid not null references public.styles (id),
  beard_style_id uuid not null references public.styles (id),
  slot public.photo_slot not null,
  status public.preview_status not null default 'pending',
  -- Claims so far; the worker fails a row for good after its third.
  attempt_count integer not null default 0 check (attempt_count >= 0),
  priority integer not null default public.preview_priority('request'),
  -- A pending row is not claimed before this: the worker's retry backoff.
  not_before timestamptz not null default now(),
  -- `<shop id>/<visit id>/<preview id>.jpg` and `.thumb.jpg` in previews.
  storage_path text,
  thumbnail_path text,
  error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  -- Set by the nightly cleanup when it deletes the objects; the row stays so
  -- generation counts survive.
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  -- What makes "never rendered twice" true.
  unique (visit_id, hair_style_id, beard_style_id, slot),
  -- Lets a visit require that its chosen preview is one of its own.
  unique (id, visit_id)
);

create index previews_claim_idx on public.previews (priority desc, created_at, id)
where status in ('pending', 'running');

alter table public.visits
  add constraint visits_chosen_preview_fkey
  foreign key (chosen_preview_id, id) references public.previews (id, visit_id)
  on delete set null (chosen_preview_id);

alter table public.previews enable row level security;

create policy "barbers read their shop's previews"
on public.previews for select
to authenticated
using (
  exists (
    select 1 from public.visits
    where visits.id = previews.visit_id and visits.shop_id = public.current_shop_id()
  )
);

-- Row-level security alone would let a direct write silently match nothing;
-- revoking the privileges makes it an error.
revoke all on public.previews from anon;
revoke insert, update, delete, truncate on public.previews from authenticated;

alter publication supabase_realtime add table public.previews;

-- Whether a style is the dimension's keep.
create function public.is_keep_style(style_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.styles where id = style_id and slug = 'keep')
$$;

-- Inserts the visit's front previews that are missing: one per active hair
-- style with beard keep and one per active beard style with hair keep.
create function public.enqueue_front_previews(visit_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.previews (visit_id, hair_style_id, beard_style_id, slot, priority)
  select enqueue_front_previews.visit_id, hair.id, beard.id, 'front'::public.photo_slot, public.preview_priority('hair')
  from public.styles as hair
  cross join public.styles as beard
  where hair.dimension = 'hair' and hair.active and hair.slug <> 'keep'
    and beard.dimension = 'beard' and beard.slug = 'keep'
  union all
  select enqueue_front_previews.visit_id, hair.id, beard.id, 'front'::public.photo_slot, public.preview_priority('beard')
  from public.styles as hair
  cross join public.styles as beard
  where beard.dimension = 'beard' and beard.active and beard.slug <> 'keep'
    and hair.dimension = 'hair' and hair.slug = 'keep'
  on conflict (visit_id, hair_style_id, beard_style_id, slot) do nothing
$$;

-- A retake (a new path on an uploaded photo) deletes the slot's previews; a
-- worker still rendering one of them completes nothing. An uploaded front
-- photo then enqueues its previews, which re-firing never duplicates.
create function public.enqueue_photo_previews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.upload_status = 'uploaded'
    and new.storage_path is distinct from old.storage_path then
    delete from public.previews where visit_id = new.visit_id and slot = new.slot;
  end if;
  if new.slot = 'front' and new.upload_status = 'uploaded' then
    perform public.enqueue_front_previews(new.visit_id);
  end if;
  return null;
end;
$$;

create trigger photos_enqueue_previews
after insert or update on public.photos
for each row execute function public.enqueue_photo_previews();

-- Marks up to n claimable rows running and returns them, highest priority
-- first. A row is claimable when it is pending and its not-before has passed,
-- or running but claimed longer ago than stale_after (its worker died). A
-- combination is claimable only once its base is done. Skip-locked, so
-- concurrent callers never receive the same row.
create function public.claim_previews(n integer, stale_after interval)
returns setof public.previews
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimable as (
    select candidate.id
    from public.previews as candidate
    where (
        (candidate.status = 'pending' and candidate.not_before <= now())
        or (candidate.status = 'running' and candidate.claimed_at < now() - claim_previews.stale_after)
      )
      and (
        public.is_keep_style(candidate.hair_style_id)
        or public.is_keep_style(candidate.beard_style_id)
        or exists (
          select 1
          from public.previews as base
          join public.styles as keep on keep.id = base.beard_style_id and keep.slug = 'keep'
          where base.visit_id = candidate.visit_id
            and base.slot = candidate.slot
            and base.hair_style_id = candidate.hair_style_id
            and base.status = 'done'
        )
      )
    order by candidate.priority desc, candidate.created_at, candidate.id
    limit claim_previews.n
    for update of candidate skip locked
  ),
  claimed as (
    update public.previews
    set status = 'running', claimed_at = now(), attempt_count = previews.attempt_count + 1
    from claimable
    where previews.id = claimable.id
    returning previews.*
  )
  select * from claimed
  order by claimed.priority desc, claimed.created_at, claimed.id;
end;
$$;

-- Returns the visit's preview of this pairing and slot, adding it as pending
-- at request priority when missing. A combination also adds its base, and
-- starts failed or refused when its base already is. Keep with keep is the
-- original photo: nothing is added and no row is returned.
--
-- This and the worker's two functions below return zero or one row, called
-- with `.maybeSingle()`: PostgREST renders a null composite as an object of
-- nulls, never as null.
create function public.request_preview(
  visit_id uuid,
  hair_style_id uuid,
  beard_style_id uuid,
  slot public.photo_slot
)
returns setof public.previews
rows 1
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  hair_keep boolean;
  beard_keep boolean;
  base public.previews;
  result public.previews;
begin
  if not exists (
    select 1 from public.visits
    where visits.id = request_preview.visit_id and visits.shop_id = public.current_shop_id()
  ) then
    raise exception 'visit % is not in your shop', request_preview.visit_id using errcode = '42501';
  end if;

  select styles.slug = 'keep' into hair_keep
  from public.styles where styles.id = request_preview.hair_style_id and styles.dimension = 'hair';
  select styles.slug = 'keep' into beard_keep
  from public.styles where styles.id = request_preview.beard_style_id and styles.dimension = 'beard';
  if hair_keep is null or beard_keep is null then
    raise exception 'not a hair style and a beard style' using errcode = '22023';
  end if;
  if hair_keep and beard_keep then
    return;
  end if;

  if not hair_keep and not beard_keep then
    insert into public.previews (visit_id, hair_style_id, beard_style_id, slot, priority)
    select request_preview.visit_id, request_preview.hair_style_id, keep.id, request_preview.slot,
      public.preview_priority('request')
    from public.styles as keep
    where keep.dimension = 'beard' and keep.slug = 'keep'
    on conflict (visit_id, hair_style_id, beard_style_id, slot) do nothing;

    select previews.* into base
    from public.previews
    join public.styles as keep on keep.id = previews.beard_style_id and keep.slug = 'keep'
    where previews.visit_id = request_preview.visit_id
      and previews.slot = request_preview.slot
      and previews.hair_style_id = request_preview.hair_style_id;
  end if;

  insert into public.previews (visit_id, hair_style_id, beard_style_id, slot, priority, status, error)
  values (
    request_preview.visit_id,
    request_preview.hair_style_id,
    request_preview.beard_style_id,
    request_preview.slot,
    public.preview_priority('request'),
    case when base.status in ('failed', 'refused') then base.status else 'pending' end,
    case when base.status in ('failed', 'refused') then 'base preview ' || base.status end
  )
  on conflict (visit_id, hair_style_id, beard_style_id, slot) do nothing
  returning * into result;

  if result.id is null then
    select previews.* into result
    from public.previews
    where previews.visit_id = request_preview.visit_id
      and previews.hair_style_id = request_preview.hair_style_id
      and previews.beard_style_id = request_preview.beard_style_id
      and previews.slot = request_preview.slot;
  end if;
  return next result;
end;
$$;

-- Resets a failed row of the caller's shop to pending, to be claimed now with
-- a fresh attempt count. A combination's failed base is reset with it, since
-- the combination waits for it. Any other row is returned as it is.
create function public.retry_preview(id uuid)
returns public.previews
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target public.previews;
  result public.previews;
begin
  select previews.* into target
  from public.previews
  join public.visits on visits.id = previews.visit_id
  where previews.id = retry_preview.id and visits.shop_id = public.current_shop_id();
  if target.id is null then
    raise exception 'preview % is not in your shop', retry_preview.id using errcode = '42501';
  end if;

  update public.previews
  set status = 'pending', attempt_count = 0, not_before = now(), error = null, claimed_at = null
  where previews.id in (
    select candidate.id
    from public.previews as candidate
    where candidate.status = 'failed'
      and (
        candidate.id = target.id
        or (
          not public.is_keep_style(target.hair_style_id)
          and not public.is_keep_style(target.beard_style_id)
          and candidate.visit_id = target.visit_id
          and candidate.slot = target.slot
          and candidate.hair_style_id = target.hair_style_id
          and public.is_keep_style(candidate.beard_style_id)
        )
      )
  );

  select previews.* into result from public.previews where previews.id = target.id;
  return result;
end;
$$;

-- The worker settles a running row it claimed. `pending` is a retryable
-- failure, claimable again at retry_at (now when null); `failed` and
-- `refused` are final and cascade to the pending combinations waiting on the
-- row. Returns no row when the row is no longer running, such as one deleted
-- by a retake.
create function public.fail_preview(
  id uuid,
  status public.preview_status,
  error text,
  retry_at timestamptz default null
)
returns setof public.previews
rows 1
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  result public.previews;
begin
  if fail_preview.status not in ('pending', 'failed', 'refused') then
    raise exception 'a preview fails as pending, failed or refused, not %', fail_preview.status
      using errcode = '22023';
  end if;

  update public.previews
  set status = fail_preview.status,
    error = fail_preview.error,
    not_before = case when fail_preview.status = 'pending' then coalesce(fail_preview.retry_at, now())
      else previews.not_before end,
    completed_at = case when fail_preview.status = 'pending' then null else now() end
  where previews.id = fail_preview.id and previews.status = 'running'
  returning * into result;
  if result.id is null then
    return;
  end if;

  if result.status in ('failed', 'refused')
    and public.is_keep_style(result.beard_style_id)
    and not public.is_keep_style(result.hair_style_id) then
    update public.previews
    set status = result.status, error = 'base preview ' || result.status, completed_at = now()
    where previews.visit_id = result.visit_id
      and previews.slot = result.slot
      and previews.hair_style_id = result.hair_style_id
      and previews.status = 'pending'
      and not public.is_keep_style(previews.beard_style_id);
  end if;
  return next result;
end;
$$;

-- The worker marks a running row done with its image and thumbnail paths.
-- Returns no row when the row is no longer running, such as one deleted by a
-- retake: the worker's objects are then orphans, harmlessly.
create function public.complete_preview(id uuid, storage_path text, thumbnail_path text)
returns setof public.previews
rows 1
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  update public.previews
  set status = 'done',
    storage_path = complete_preview.storage_path,
    thumbnail_path = complete_preview.thumbnail_path,
    error = null,
    completed_at = now()
  where previews.id = complete_preview.id and previews.status = 'running'
  returning *;
end;
$$;

revoke execute on function public.preview_priority(text) from public, anon;
revoke execute on function public.is_keep_style(uuid) from public, anon;
revoke execute on function public.enqueue_front_previews(uuid) from public, anon, authenticated;
revoke execute on function public.enqueue_photo_previews() from public, anon, authenticated;
revoke execute on function public.claim_previews(integer, interval) from public, anon, authenticated;
revoke execute on function public.request_preview(uuid, uuid, uuid, public.photo_slot) from public, anon;
revoke execute on function public.retry_preview(uuid) from public, anon;
revoke execute on function public.fail_preview(uuid, public.preview_status, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.complete_preview(uuid, text, text) from public, anon, authenticated;

grant execute on function public.preview_priority(text) to authenticated, service_role;
grant execute on function public.is_keep_style(uuid) to authenticated, service_role;
grant execute on function public.enqueue_front_previews(uuid) to service_role;
grant execute on function public.claim_previews(integer, interval) to service_role;
grant execute on function public.request_preview(uuid, uuid, uuid, public.photo_slot) to authenticated;
grant execute on function public.retry_preview(uuid) to authenticated;
grant execute on function public.fail_preview(uuid, public.preview_status, text, timestamptz) to service_role;
grant execute on function public.complete_preview(uuid, text, text) to service_role;

-- The internal usage view, now with each shop's previews: generated (done),
-- refused, and claims made, per provider.
create or replace view internal.generation_attempts as
with per_visit as (
  select
    previews.visit_id,
    count(*) filter (where previews.status = 'done') as previews_done,
    count(*) filter (where previews.status = 'refused') as previews_refused,
    coalesce(sum(previews.attempt_count), 0) as attempts
  from public.previews
  group by previews.visit_id
)
select
  shops.id as shop_id,
  shops.name as shop_name,
  visits.provider_name,
  count(visits.id) as visits,
  coalesce(sum(per_visit.previews_done), 0) as previews_done,
  coalesce(sum(per_visit.previews_refused), 0) as previews_refused,
  coalesce(sum(per_visit.attempts), 0) as attempts
from public.shops
left join public.visits on visits.shop_id = shops.id
left join per_visit on per_visit.visit_id = visits.id
group by shops.id, shops.name, visits.provider_name;

revoke all on internal.generation_attempts from public, anon, authenticated;
