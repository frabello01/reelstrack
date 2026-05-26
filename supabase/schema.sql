-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Creator Lists
create table lists (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  color text default '#6366f1',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Creators (Instagram accounts)
create table creators (
  id uuid primary key default uuid_generate_v4(),
  username text not null unique,
  display_name text,
  profile_pic_url text,
  follower_count integer,
  avg_views_30d numeric default 0,
  avg_views_all numeric default 0,
  last_fetched_at timestamptz,
  created_at timestamptz default now()
);

-- Many-to-many: creators in lists
create table list_creators (
  list_id uuid references lists(id) on delete cascade,
  creator_id uuid references creators(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (list_id, creator_id)
);

-- Reels
create table reels (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid references creators(id) on delete cascade,
  instagram_id text not null unique,
  url text not null,
  thumbnail_url text,
  caption text,
  views integer not null default 0,
  likes integer default 0,
  comments integer default 0,
  plays integer default 0,
  duration_seconds integer,
  posted_at timestamptz not null,
  fetched_at timestamptz default now()
);

-- Outlier scores (computed and stored per fetch)
create table reel_scores (
  id uuid primary key default uuid_generate_v4(),
  reel_id uuid references reels(id) on delete cascade,
  creator_id uuid references creators(id) on delete cascade,
  outlier_score numeric not null,
  views_at_score integer not null,
  creator_avg_views numeric not null,
  computed_at timestamptz default now()
);

-- Fetch job logs
create table fetch_jobs (
  id uuid primary key default uuid_generate_v4(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text default 'running', -- running | done | failed
  creators_fetched integer default 0,
  reels_found integer default 0,
  error text
);

-- Indexes
create index on reels(creator_id);
create index on reels(posted_at);
create index on reel_scores(outlier_score desc);
create index on reel_scores(computed_at desc);
create index on list_creators(list_id);

-- RLS Policies (team members must be authenticated)
alter table lists enable row level security;
alter table creators enable row level security;
alter table list_creators enable row level security;
alter table reels enable row level security;
alter table reel_scores enable row level security;
alter table fetch_jobs enable row level security;

-- Allow all authenticated users to read/write everything
create policy "Authenticated full access" on lists for all using (auth.role() = 'authenticated');
create policy "Authenticated full access" on creators for all using (auth.role() = 'authenticated');
create policy "Authenticated full access" on list_creators for all using (auth.role() = 'authenticated');
create policy "Authenticated full access" on reels for all using (auth.role() = 'authenticated');
create policy "Authenticated full access" on reel_scores for all using (auth.role() = 'authenticated');
create policy "Authenticated full access" on fetch_jobs for all using (auth.role() = 'authenticated');

-- ============================================================
-- Explore Creators (suggestion-scan feature)
-- ============================================================

-- One row per scan-run for a list. Mirrors fetch_jobs so the UI can
-- show progress (X of N creators processed).
create table creator_suggestion_jobs (
  id uuid primary key default uuid_generate_v4(),
  list_id uuid references lists(id) on delete cascade,
  status text default 'running',          -- running | done | failed
  started_at timestamptz default now(),
  finished_at timestamptz,
  total_creators integer default 0,
  creators_processed integer default 0,
  suggestions_new integer default 0,      -- brand-new suggested profiles added in this run
  suggestions_updated integer default 0,  -- existing rows whose count went up in this run
  error text
);

-- One row per (list, suggested IG username). Accumulates across scans.
-- recommendation_count = total times this profile has been suggested
-- (each source-creator-rec counts once, summed across all runs).
create table creator_suggestions (
  id uuid primary key default uuid_generate_v4(),
  list_id uuid references lists(id) on delete cascade,
  username text not null,
  instagram_pk text,
  full_name text,
  profile_pic_url text,
  is_verified boolean default false,
  is_private boolean default false,
  follower_count integer,
  recommendation_count integer default 0,
  hidden boolean default false,
  new_in_last_run boolean default true,   -- true only if first appeared in the latest scan
  first_suggested_at timestamptz default now(),
  last_suggested_at timestamptz default now(),
  last_scan_id uuid references creator_suggestion_jobs(id) on delete set null,
  created_at timestamptz default now(),
  unique (list_id, username)
);

create index on creator_suggestions(list_id, recommendation_count desc);
create index on creator_suggestions(list_id, hidden);
create index on creator_suggestion_jobs(list_id, started_at desc);

alter table creator_suggestions enable row level security;
alter table creator_suggestion_jobs enable row level security;
create policy "Authenticated full access" on creator_suggestions for all using (auth.role() = 'authenticated');
create policy "Authenticated full access" on creator_suggestion_jobs for all using (auth.role() = 'authenticated');
