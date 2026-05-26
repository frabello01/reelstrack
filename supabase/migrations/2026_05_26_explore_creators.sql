-- ============================================================
-- Explore Creators (suggestion-scan feature) — 2026-05-26
-- Run this in the Supabase SQL editor on an existing project.
-- Safe to re-run: uses IF NOT EXISTS guards where possible.
-- ============================================================

create table if not exists creator_suggestion_jobs (
  id uuid primary key default uuid_generate_v4(),
  list_id uuid references lists(id) on delete cascade,
  status text default 'running',
  started_at timestamptz default now(),
  finished_at timestamptz,
  total_creators integer default 0,
  creators_processed integer default 0,
  suggestions_new integer default 0,
  suggestions_updated integer default 0,
  error text
);

create table if not exists creator_suggestions (
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
  new_in_last_run boolean default true,
  first_suggested_at timestamptz default now(),
  last_suggested_at timestamptz default now(),
  last_scan_id uuid references creator_suggestion_jobs(id) on delete set null,
  created_at timestamptz default now(),
  unique (list_id, username)
);

create index if not exists creator_suggestions_list_count_idx
  on creator_suggestions(list_id, recommendation_count desc);
create index if not exists creator_suggestions_list_hidden_idx
  on creator_suggestions(list_id, hidden);
create index if not exists creator_suggestion_jobs_list_started_idx
  on creator_suggestion_jobs(list_id, started_at desc);

alter table creator_suggestions enable row level security;
alter table creator_suggestion_jobs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'creator_suggestions' and policyname = 'Authenticated full access'
  ) then
    create policy "Authenticated full access" on creator_suggestions
      for all using (auth.role() = 'authenticated');
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'creator_suggestion_jobs' and policyname = 'Authenticated full access'
  ) then
    create policy "Authenticated full access" on creator_suggestion_jobs
      for all using (auth.role() = 'authenticated');
  end if;
end $$;
