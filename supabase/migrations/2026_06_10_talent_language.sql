-- ============================================================
-- Talent language preference — 2026-06-10
-- Applied via Supabase MCP.
--
-- Drives the locale of the public share page (PublicTodoPage) the
-- creator sees. Three supported languages today: Italian (default),
-- English, Spanish. Default 'it' since the agency is Italian — every
-- existing talent backfills to Italian.
-- ============================================================

alter table talents
  add column if not exists language text not null default 'it';

alter table talents
  drop constraint if exists talents_language_check;
alter table talents
  add constraint talents_language_check
    check (language in ('it', 'en', 'es'));
