-- ============================================================
-- Default Creator List for the Dashboard — 2026-06-03
-- Applied via Supabase MCP.
-- ============================================================

alter table agency_settings
  add column if not exists default_list_id uuid references lists(id) on delete set null;
