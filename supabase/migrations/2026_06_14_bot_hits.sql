-- ============================================================
-- Bot/crawler detection log — 2026-06-14
-- Applied via Supabase MCP.
--
-- Every request the botDetect module classifies as a bot lands here.
-- Lets us audit cloaking decisions, expand the IP list when new probe
-- ranges show up, and build a dashboard later if useful.
-- ============================================================

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
