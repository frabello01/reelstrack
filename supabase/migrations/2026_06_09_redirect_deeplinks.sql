-- ============================================================
-- Redirect Deeplinks — 2026-06-09
-- Applied via Supabase MCP.
--
-- Short-URL redirect service à la bouncy.ai. A creator-friendly slug
-- like /biancajorio is resolved to a destination URL on lookup. We do
-- the redirect client-side via metaEscape so the Meta in-app webview
-- gets escaped before bouncing.
--
-- Optional 18+ age-gate per link; when enabled the public renderer
-- shows the Italian "Contenuto maturo" prompt before navigating away.
-- Per design decision: always shown, no localStorage memoization.
--
-- Click tracking mirrors landing_link_clicks (IP+geo+source) so all
-- the same analytics surfaces work without bespoke aggregation.
-- ============================================================

create table if not exists redirect_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  destination_url text not null,
  title text,                                          -- internal admin label
  age_gate boolean not null default false,
  talent_id uuid references talents(id) on delete set null,
  my_account_id uuid references my_accounts(id) on delete set null,
  is_active boolean not null default true,
  click_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_redirect_links_slug
  on redirect_links (lower(slug));
create index if not exists idx_redirect_links_active
  on redirect_links (is_active, created_at desc);
create index if not exists idx_redirect_links_talent
  on redirect_links (talent_id);

create table if not exists redirect_link_clicks (
  id uuid primary key default gen_random_uuid(),
  redirect_link_id uuid not null references redirect_links(id) on delete cascade,
  user_agent text,
  meta_platform text,                                 -- instagram | threads | facebook
  ip text,                                            -- truncated /24 for IPv4
  country_code text,
  country_name text,
  region text,
  city text,
  lat numeric,
  lng numeric,
  timezone text,
  referrer_host text,
  source_kind text,                                   -- instagram | direct | tiktok | etc.
  age_gate_confirmed boolean,                         -- only set when link has age_gate
  created_at timestamptz not null default now()
);

create index if not exists idx_redirect_clicks_link_created
  on redirect_link_clicks (redirect_link_id, created_at desc);
create index if not exists idx_redirect_clicks_created
  on redirect_link_clicks (created_at desc);
