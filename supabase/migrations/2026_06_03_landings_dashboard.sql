-- ============================================================
-- Landings live dashboard — geo + page views — 2026-06-03
-- Run this in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- ============================================================

-- ---- 1) Enrich landing_link_clicks with geo + source -----------
alter table landing_link_clicks
  add column if not exists ip text,
  add column if not exists country_code text,
  add column if not exists country_name text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  add column if not exists timezone text,
  add column if not exists referrer_host text,
  add column if not exists source_kind text;

create index if not exists landing_link_clicks_landing_clicked_idx
  on landing_link_clicks(landing_id, clicked_at desc);
create index if not exists landing_link_clicks_country_idx
  on landing_link_clicks(country_code);
create index if not exists landing_link_clicks_source_kind_idx
  on landing_link_clicks(source_kind);

-- ---- 2) Page-view tracking table -------------------------------
-- One row per landing-page LOAD (not click). Lets us compute true
-- CTR = clicks / views, source attribution from referrer/UTM, and
-- "unique visitors" by truncated-IP heuristic.
create table if not exists landing_page_views (
  id bigserial primary key,
  landing_id uuid references landings(id) on delete cascade,
  viewed_at timestamptz default now(),
  ip text,
  country_code text,
  country_name text,
  region text,
  city text,
  lat numeric,
  lng numeric,
  timezone text,
  user_agent text,
  referrer_host text,
  source_kind text,         -- 'instagram'|'threads'|'facebook'|'twitter'|'reddit'|'tiktok'|'google'|'direct'|'other'
  meta_platform text,
  utm_source text,
  utm_medium text,
  utm_campaign text
);
create index if not exists landing_page_views_landing_viewed_idx
  on landing_page_views(landing_id, viewed_at desc);
create index if not exists landing_page_views_country_idx
  on landing_page_views(country_code);
create index if not exists landing_page_views_source_kind_idx
  on landing_page_views(source_kind);

alter table landing_page_views enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='landing_page_views' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on landing_page_views for all using (auth.role() = 'authenticated');
  end if;
end $$;

-- ---- 3) Enable Realtime on landing_link_clicks -----------------
-- The live feed on the dashboard subscribes to INSERTs.
-- (Supabase ships a default publication called supabase_realtime.)
alter publication supabase_realtime add table landing_link_clicks;
