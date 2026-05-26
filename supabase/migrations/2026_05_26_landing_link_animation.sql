-- ============================================================
-- Per-link animation on landing pages — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

alter table landing_links
  add column if not exists animation text;

-- Values today:
--   null / 'none'  → no animation
--   'bounce'       → soft looping vertical bounce
-- Free text so additional variants (pulse, shine, glow) can be added later.
