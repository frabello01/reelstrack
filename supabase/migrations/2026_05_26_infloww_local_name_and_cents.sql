-- ============================================================
-- Local rename + cents→dollars fix on Infloww — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

alter table infloww_tracking_links
  add column if not exists local_name text;

-- Infloww returns earnings in cents (e.g. 11672 = $116.72). One-time fix
-- to convert existing rows; the sync service is updated separately to
-- divide before inserting going forward.
update infloww_tracking_links
  set earnings_gross = earnings_gross / 100,
      earnings_net   = earnings_net   / 100,
      epc_gross      = epc_gross      / 100,
      epc_net        = epc_net        / 100;

update infloww_tracking_link_snapshots
  set earnings_gross = earnings_gross / 100,
      earnings_net   = earnings_net   / 100;
