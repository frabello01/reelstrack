-- ============================================================
-- Discord webhook URL on agency_settings — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

alter table agency_settings
  add column if not exists discord_webhook_url text;
