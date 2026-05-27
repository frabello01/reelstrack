-- ============================================================
-- Infloww tracking-link metrics — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

alter table talents
  add column if not exists infloww_creator_id text;

create table if not exists infloww_tracking_links (
  id uuid primary key default uuid_generate_v4(),
  infloww_link_id text not null unique,
  talent_id uuid references talents(id) on delete set null,
  landing_link_id uuid references landing_links(id) on delete set null,

  name text,
  code text,
  source text,
  tag_names text[],

  click_count integer default 0,
  sub_count integer default 0,
  paying_fans_count integer default 0,
  earnings_gross numeric default 0,
  earnings_net numeric default 0,
  subscription_cvr numeric default 0,
  spending_cvr numeric default 0,
  epc_gross numeric default 0,
  epc_net numeric default 0,
  currency text default 'USD',
  finished boolean default false,

  created_at_infloww timestamptz,
  expired_at_infloww timestamptz,
  updated_at_infloww timestamptz,

  last_synced_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists infloww_tracking_links_talent_idx on infloww_tracking_links(talent_id);
create index if not exists infloww_tracking_links_landing_link_idx on infloww_tracking_links(landing_link_id);

create table if not exists infloww_tracking_link_snapshots (
  id bigserial primary key,
  infloww_link_id text not null references infloww_tracking_links(infloww_link_id) on delete cascade,
  snapshot_date date not null,
  click_count integer default 0,
  sub_count integer default 0,
  paying_fans_count integer default 0,
  earnings_gross numeric default 0,
  earnings_net numeric default 0,
  subscription_cvr numeric default 0,
  created_at timestamptz default now(),
  unique (infloww_link_id, snapshot_date)
);
create index if not exists infloww_snap_link_date_idx
  on infloww_tracking_link_snapshots(infloww_link_id, snapshot_date desc);

alter table infloww_tracking_links enable row level security;
alter table infloww_tracking_link_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='infloww_tracking_links' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on infloww_tracking_links for all using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='infloww_tracking_link_snapshots' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on infloww_tracking_link_snapshots for all using (auth.role() = 'authenticated');
  end if;
end $$;
