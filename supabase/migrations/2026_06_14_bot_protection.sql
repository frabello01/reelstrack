-- ============================================================
-- Bot Protection feature — 2026-06-14
-- Applied via Supabase MCP.
--
-- Per-landing opt-in: when ON, the landing's outbound links are
-- served as JWT-signed URLs pointing to a SECOND domain (the
-- sacrificial redirector). The redirector applies bot detection
-- (IP CIDR + UA + canary blacklist) and responds with 410 Gone
-- for bots, 302 redirect for humans.
-- ============================================================

alter table landings
  add column if not exists bot_protection_enabled boolean not null default false;

create table if not exists bot_hits (
  id bigserial primary key,
  resource_kind text not null,
  resource_id uuid,
  slug text,
  ip text,
  full_ip text,
  detection_kind text not null,
  reason text,
  user_agent text,
  path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_hits_created_at on bot_hits (created_at desc);
create index if not exists idx_bot_hits_resource on bot_hits (resource_kind, resource_id, created_at desc);
create index if not exists idx_bot_hits_detection on bot_hits (detection_kind, created_at desc);
create index if not exists idx_bot_hits_full_ip on bot_hits (full_ip);
