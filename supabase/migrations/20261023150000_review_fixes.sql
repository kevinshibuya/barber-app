-- Fixes from the run-end review of PR #23. Each block names its finding.

-- Finding 1: an object path is the visit's own. Policies check a row's shop,
-- and the worker and the client page read these paths with the service role,
-- so a path that pointed into another shop would hand that shop's photos over.
-- A slot photo sits at `<shop>/<visit>/<slot>[.<take>].jpg` and the after
-- photo at `<shop>/<visit>/after[.<take>].jpg`, as `@barber/shared`'s paths
-- build them.
create function public.visit_object_pattern(shop_id uuid, visit_id uuid, name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '^' || shop_id || '/' || visit_id || '/' || name || '(\.[A-Za-z0-9_-]+)?\.jpg$'
$$;

-- Security definer so the visit's shop is read whatever the caller can see;
-- a caller writing to another shop's visit is still refused by the policies.
create function public.guard_photo_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_shop uuid;
begin
  select visits.shop_id into visit_shop from public.visits where visits.id = new.visit_id;
  if visit_shop is null
    or new.storage_path !~ public.visit_object_pattern(visit_shop, new.visit_id, new.slot::text) then
    raise exception 'photo path % is not one of visit %''s', new.storage_path, new.visit_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger photos_guard_path
before insert or update of storage_path, visit_id, slot on public.photos
for each row execute function public.guard_photo_path();

alter table public.visits
  add constraint visits_after_photo_path_check
  check (after_photo_path is null or after_photo_path ~ public.visit_object_pattern(shop_id, id, 'after'));

-- Findings 7 and 14: the look is the app's to change until the after photo
-- is taken or the visit is closed, and only to a preview that still has its
-- image. The retake trigger below clears a look as the table owner, past this
-- guard.
create function public.guard_visit_look()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if (new.chosen_hair_style_id, new.chosen_beard_style_id, new.chosen_preview_id)
    is not distinct from (old.chosen_hair_style_id, old.chosen_beard_style_id, old.chosen_preview_id) then
    return new;
  end if;
  if old.after_photo_path is not null or old.status = 'closed' then
    raise exception 'the look of visit % is locked', old.id using errcode = '55000';
  end if;
  if new.chosen_preview_id is not null and not exists (
    select 1 from public.previews
    where previews.id = new.chosen_preview_id and previews.status = 'done' and previews.purged_at is null
  ) then
    raise exception 'preview % has no image to choose', new.chosen_preview_id using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger visits_guard_look
before update on public.visits
for each row execute function public.guard_visit_look();

-- Finding 13: objects whose rows a retake deleted. The nightly cleanup
-- removes them from storage and then forgets them. Row-level security with no
-- policy leaves the table to the service role.
create table public.orphaned_objects (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  created_at timestamptz not null default now()
);

alter table public.orphaned_objects enable row level security;
revoke all on public.orphaned_objects from public, anon, authenticated;

-- Findings 6 and 13: a retake (a new path on an uploaded photo) deletes the
-- slot's previews. A look chosen from one of them goes with it, all three
-- columns, and their objects are queued for the cleanup. A worker still
-- rendering one of them completes nothing. An uploaded front photo then
-- enqueues its previews, which re-firing never duplicates.
create or replace function public.enqueue_photo_previews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.upload_status = 'uploaded'
    and new.storage_path is distinct from old.storage_path then
    update public.visits
    set chosen_hair_style_id = null, chosen_beard_style_id = null, chosen_preview_id = null
    where visits.id = new.visit_id
      and visits.chosen_preview_id in (
        select previews.id from public.previews
        where previews.visit_id = new.visit_id and previews.slot = new.slot
      );

    with gone as (
      delete from public.previews
      where previews.visit_id = new.visit_id and previews.slot = new.slot
      returning previews.storage_path, previews.thumbnail_path
    )
    insert into public.orphaned_objects (bucket, path)
    select 'previews', object.path
    from gone, unnest(array[gone.storage_path, gone.thumbnail_path]) as object(path)
    where object.path is not null;
  end if;
  if new.slot = 'front' and new.upload_status = 'uploaded' then
    perform public.enqueue_front_previews(new.visit_id);
  end if;
  return null;
end;
$$;

-- Finding 4: a row whose worker died mid-render is claimed again, but not
-- forever. Once it has been claimed as often as the worker retries (3,
-- `MAX_ATTEMPTS` in the worker), a lost claim fails it like a failed render,
-- with its waiting combinations, and the barber's retry tap starts it over.
create or replace function public.claim_previews(n integer, stale_after interval)
returns setof public.previews
language plpgsql
security definer
set search_path = ''
as $$
begin
  with lost as (
    update public.previews
    set status = 'failed', error = 'the worker stopped during the last attempt', completed_at = now()
    where previews.status = 'running'
      and previews.claimed_at < now() - claim_previews.stale_after
      and previews.attempt_count >= 3
    returning previews.*
  )
  update public.previews
  set status = 'failed', error = 'base preview failed', completed_at = now()
  from lost
  where public.is_keep_style(lost.beard_style_id)
    and not public.is_keep_style(lost.hair_style_id)
    and previews.visit_id = lost.visit_id
    and previews.slot = lost.slot
    and previews.hair_style_id = lost.hair_style_id
    and previews.status = 'pending'
    and not public.is_keep_style(previews.beard_style_id);

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

-- Finding 19: the combination reads its base under a share lock, so a
-- concurrent `fail_preview` either settles the base first (and the
-- combination starts failed with it) or waits until the combination exists
-- (and its cascade reaches it).
create or replace function public.request_preview(
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
      and previews.hair_style_id = request_preview.hair_style_id
    for share of previews;
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

-- Finding 8: the worker settles only its own claim. `attempt` is the
-- attempt_count its claim returned; a row claimed again since then is
-- another worker's and is left alone. Null matches any claim, for a worker
-- deployed before this migration.
drop function public.fail_preview(uuid, public.preview_status, text, timestamptz);
drop function public.complete_preview(uuid, text, text);

create function public.fail_preview(
  id uuid,
  status public.preview_status,
  error text,
  retry_at timestamptz default null,
  attempt integer default null
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
  where previews.id = fail_preview.id
    and previews.status = 'running'
    and (fail_preview.attempt is null or previews.attempt_count = fail_preview.attempt)
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

create function public.complete_preview(
  id uuid,
  storage_path text,
  thumbnail_path text,
  attempt integer default null
)
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
  where previews.id = complete_preview.id
    and previews.status = 'running'
    and (complete_preview.attempt is null or previews.attempt_count = complete_preview.attempt)
  returning *;
end;
$$;

revoke execute on function public.fail_preview(uuid, public.preview_status, text, timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_preview(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.fail_preview(uuid, public.preview_status, text, timestamptz, integer)
  to service_role;
grant execute on function public.complete_preview(uuid, text, text, integer) to service_role;

revoke execute on function public.visit_object_pattern(uuid, uuid, text) from public, anon;
grant execute on function public.visit_object_pattern(uuid, uuid, text) to authenticated, service_role;
revoke execute on function public.guard_photo_path() from public, anon, authenticated;
revoke execute on function public.guard_visit_look() from public, anon;

-- Finding 16: the owner dashboard's numbers for us, per shop, in the SQL
-- editor, where `is_owner()` has no caller and the public views stay empty.
-- Same periods and the same rules as the public views.
create view internal.shop_numbers as
select
  shops.id as shop_id,
  shops.name as shop_name,
  (select count(*) from public.visits
    where visits.shop_id = shops.id and visits.created_at >= public.local_period_start('week'))
    as visits_this_week,
  (select count(*) from public.visits
    where visits.shop_id = shops.id and visits.created_at >= public.local_period_start('month'))
    as visits_this_month,
  (select count(*) from public.clients where clients.shop_id = shops.id) as total_clients,
  (select count(*) from (
      select 1 from public.visits
      where visits.shop_id = shops.id
      group by visits.client_id
      having count(*) >= 2
    ) as regulars) as returning_clients
from public.shops;

create view internal.visits_per_barber as
select barbers.shop_id, barbers.id as barber_id, barbers.display_name, count(visits.id) as visits_this_month
from public.barbers
left join public.visits
  on visits.barber_id = barbers.id
  and visits.created_at >= public.local_period_start('month')
group by barbers.shop_id, barbers.id, barbers.display_name;

-- Every style chosen this month, per shop and dimension, busiest first; the
-- dashboard shows the top five hair and three beard styles of this list.
create view internal.chosen_styles as
select visits.shop_id, styles.dimension, styles.slug, styles.name, count(*) as visits_this_month
from public.visits
join public.styles
  on styles.id in (visits.chosen_hair_style_id, visits.chosen_beard_style_id)
where visits.created_at >= public.local_period_start('month')
  and styles.slug <> 'keep'
group by visits.shop_id, styles.dimension, styles.slug, styles.name, styles.sort_order
order by visits.shop_id, styles.dimension, visits_this_month desc, styles.sort_order;

revoke all on internal.shop_numbers, internal.visits_per_barber, internal.chosen_styles
  from public, anon, authenticated;
