-- ============================================================
-- Landings → my_accounts (IG profile) optional link — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

alter table landings
  add column if not exists my_account_id uuid references my_accounts(id) on delete set null;

create index if not exists landings_my_account_idx on landings(my_account_id);
