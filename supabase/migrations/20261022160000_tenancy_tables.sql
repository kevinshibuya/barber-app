-- The tenancy half of the schema: shops, their barbers and clients, the
-- global style catalog, visits and their photos. Every table is created with
-- row-level security on and no policy, so nothing is readable through the API
-- until the policies migration grants it; the previews table is the queue
-- migration's.

create extension if not exists pgcrypto with schema extensions;

create type public.barber_role as enum ('owner', 'barber');
create type public.style_dimension as enum ('hair', 'beard');
create type public.visit_status as enum ('open', 'closed');
create type public.photo_slot as enum ('front', 'left', 'right', 'back');
create type public.upload_status as enum ('uploading', 'uploaded');

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

-- A barber is an auth user of one shop.
create table public.barbers (
  id uuid primary key references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  display_name text not null,
  role public.barber_role not null default 'barber',
  created_at timestamptz not null default now(),
  -- Lets a visit require that its barber belongs to the visit's shop.
  unique (id, shop_id)
);

create index barbers_shop_id_idx on public.barbers (shop_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  phone text,
  created_at timestamptz not null default now(),
  unique (id, shop_id)
);

create index clients_shop_id_name_idx on public.clients (shop_id, lower(name));

-- The global catalog. Each dimension has one `keep` style, which has no
-- prompt and no reference image and is never generated; every other style has
-- both. Reference images live in the public `styles` bucket at
-- `<dimension>/<slug>.png`.
create table public.styles (
  id uuid primary key default gen_random_uuid(),
  dimension public.style_dimension not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  reference_image_path text,
  prompt text,
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (dimension, slug),
  check (
    case
      when slug = 'keep' then prompt is null and reference_image_path is null
      else prompt is not null and reference_image_path is not null
    end
  )
);

-- A share token is 32 random bytes as unpadded base64url: 43 characters.
create function public.new_share_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

-- The visit id is supplied by the app, so a visit started on bad wifi and its
-- online copy are one row.
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_id uuid not null,
  barber_id uuid not null,
  consent_given boolean not null default false,
  consent_at timestamptz,
  status public.visit_status not null default 'open',
  chosen_hair_style_id uuid references public.styles (id),
  chosen_beard_style_id uuid references public.styles (id),
  -- References previews once the queue migration creates that table.
  chosen_preview_id uuid,
  after_photo_path text,
  -- The client page is `/v/<share_token>` on the worker. Nullable so the
  -- nightly cleanup can clear an expired one.
  share_token text unique default public.new_share_token(),
  share_expires_at timestamptz default now() + interval '30 days',
  provider_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (client_id, shop_id) references public.clients (id, shop_id) on delete cascade,
  foreign key (barber_id, shop_id) references public.barbers (id, shop_id),
  check (not consent_given or consent_at is not null)
);

create index visits_shop_id_created_at_idx on public.visits (shop_id, created_at desc);
create index visits_client_id_created_at_idx on public.visits (client_id, created_at desc);

-- The share link is the server's to mint: an app-supplied token or expiry is
-- replaced on insert and ignored on update. Only the service role (the worker
-- and its cleanup) sets them by hand.
create function public.guard_visit_share_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.share_token := public.new_share_token();
      new.share_expires_at := now() + interval '30 days';
    else
      new.share_token := old.share_token;
      new.share_expires_at := old.share_expires_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger visits_guard_share_link
before insert or update on public.visits
for each row execute function public.guard_visit_share_link();

-- One row per visit and slot: a retake upserts in place.
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  slot public.photo_slot not null,
  storage_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  upload_status public.upload_status not null default 'uploading',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (visit_id, slot)
);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger photos_touch_updated_at
before update on public.photos
for each row execute function public.touch_updated_at();

alter table public.shops enable row level security;
alter table public.barbers enable row level security;
alter table public.clients enable row level security;
alter table public.styles enable row level security;
alter table public.visits enable row level security;
alter table public.photos enable row level security;
