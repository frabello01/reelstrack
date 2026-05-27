-- ============================================================
-- Hide flag on Infloww tracking links — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

alter table infloww_tracking_links
  add column if not exists hidden boolean default false;

create index if not exists infloww_tracking_links_hidden_idx
  on infloww_tracking_links(talent_id, hidden);
