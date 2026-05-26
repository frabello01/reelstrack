-- ============================================================
-- Landings (Linktree-style landing pages) — 2026-05-26
-- Applied via Supabase MCP. This file is kept under version
-- control as a record / for fresh DBs.
-- ============================================================

create table if not exists landings (
  id uuid primary key default uuid_generate_v4(),
  talent_id uuid references talents(id) on delete set null,
  host text,                                       -- nullable: null = default app host
  slug text not null,
  title text not null,
  subtitle text,                                   -- @username line under name
  bio text,
  avatar_url text,
  background_url text,
  verified boolean default false,
  theme jsonb default '{}'::jsonb,
  published boolean default true,
  age_gate_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists landings_host_slug_idx
  on landings ((coalesce(host, '__default__')), slug);
create index if not exists landings_talent_idx on landings(talent_id);

create table if not exists landing_links (
  id uuid primary key default uuid_generate_v4(),
  landing_id uuid references landings(id) on delete cascade,
  label text not null,
  url text not null,
  icon text,
  sort_order integer default 0,
  enabled boolean default true,
  age_gate boolean default false,
  click_count integer default 0,
  created_at timestamptz default now()
);
create index if not exists landing_links_landing_sort_idx
  on landing_links(landing_id, sort_order);

create table if not exists landing_link_clicks (
  id bigserial primary key,
  link_id uuid references landing_links(id) on delete cascade,
  landing_id uuid references landings(id) on delete cascade,
  clicked_at timestamptz default now(),
  user_agent text,
  meta_platform text
);
create index if not exists landing_link_clicks_link_idx on landing_link_clicks(link_id, clicked_at desc);
create index if not exists landing_link_clicks_landing_day_idx on landing_link_clicks(landing_id, clicked_at desc);

alter table landings enable row level security;
alter table landing_links enable row level security;
alter table landing_link_clicks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='landings' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on landings for all using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='landing_links' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on landing_links for all using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='landing_link_clicks' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on landing_link_clicks for all using (auth.role() = 'authenticated');
  end if;
end $$;
