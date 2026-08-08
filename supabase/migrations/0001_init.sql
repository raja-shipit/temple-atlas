-- Temple Atlas — initial schema
-- Matches temple-atlas-spec.md v3. See that doc for the "why" behind each choice.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- categories: dynamic taxonomy, populated by the pipeline itself (Section 4)
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  color text, -- hex code for map marker / badge color
  first_seen_video_id text,
  temple_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- temples: one row per distinct physical temple (see 5b — entity resolution
-- happens in application code before insert, not enforced by a DB constraint,
-- since "same temple" is a fuzzy match on name/state/coordinates, not exact).
-- ---------------------------------------------------------------------------
create type temple_status as enum ('pending', 'published', 'rejected');
create type temple_source as enum ('auto', 'manual');

create table if not exists temples (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  deity text,
  state text,
  district text,
  lat numeric(9,6),
  lng numeric(9,6),

  -- Denormalized on purpose (resolved decision, spec 4b) — favors admin
  -- simplicity over normalization. Any merge/rename in `categories` MUST
  -- cascade-rewrite this column on every affected row in the same
  -- transaction (see update_category_name_cascade below).
  categories text[] not null default '{}',

  -- Primary source video
  video_url text,
  video_title text,
  video_id text unique, -- unique per *video*, not per temple — see 5b

  -- Other videos covering this same temple (5b)
  additional_sources jsonb not null default '[]',

  description text,

  -- YouTube thumbnail caching — subject to the 30-day refresh/delete rule
  -- in YouTube's Developer Policies (spec 5c).
  thumbnail_url text,
  thumbnail_cached_at timestamptz,

  -- Manual-only, populated via /admin (spec 4a) — never touched by the pipeline.
  instagram_urls text[] not null default '{}',

  status temple_status not null default 'pending',
  needs_review boolean not null default false,
  source temple_source not null default 'auto',

  -- Set on approve/re-approve in /admin (spec 6, 7). Shown publicly on the
  -- temple card as "Last verified: <date>".
  last_verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_temples_status on temples (status);
create index if not exists idx_temples_needs_review on temples (needs_review) where needs_review = true;
create index if not exists idx_temples_categories on temples using gin (categories);
create index if not exists idx_temples_thumbnail_cached_at on temples (thumbnail_cached_at);

-- ---------------------------------------------------------------------------
-- sync_log: one row per cron ingestion run (spec Section 4)
-- ---------------------------------------------------------------------------
create table if not exists sync_log (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  videos_checked integer not null default 0,
  temples_added_pending integer not null default 0,
  videos_skipped_non_temple integer not null default 0,
  videos_with_multiple_temples integer not null default 0, -- spec 5a
  thumbnails_refreshed integer not null default 0,          -- spec 5c
  thumbnails_expired_removed integer not null default 0,    -- spec 5c
  errors jsonb not null default '[]',
  notes text
);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_temples_updated_at on temples;
create trigger trg_temples_updated_at
  before update on temples
  for each row execute function set_updated_at();

drop trigger if exists trg_categories_updated_at on categories;
create trigger trg_categories_updated_at
  before update on categories
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Category rename/merge cascade (spec 4b) — the whole point of this function
-- is that a rename in `categories` is never allowed to drift out of sync
-- with the denormalized text[] on `temples`. Call this from the admin
-- category-rename/merge action instead of updating `categories` directly.
-- ---------------------------------------------------------------------------
create or replace function rename_category_cascade(old_name text, new_name text)
returns void as $$
begin
  update categories set name = new_name where name = old_name;

  update temples
  set categories = array_replace(categories, old_name, new_name)
  where old_name = any(categories);
end;
$$ language plpgsql;

-- Merge: fold `from_name` into `to_name` everywhere, then retire `from_name`.
create or replace function merge_category_cascade(from_name text, to_name text)
returns void as $$
begin
  update temples
  set categories = (
    select array_agg(distinct c)
    from unnest(
      array_replace(categories, from_name, to_name)
    ) as c
  )
  where from_name = any(categories);

  delete from categories where name = from_name;
end;
$$ language plpgsql;
