-- ============================================================
-- Creator Drive Uploads — 2026-06-10
-- Applied via Supabase MCP.
--
-- Workflow: each to-do list can optionally let the creator (via the
-- existing public share link) upload finished video clips for each
-- reel. Files go DIRECTLY from the creator's browser to a
-- creator-specific Google Drive folder using a resumable upload
-- session URL produced by our backend with the agency's OAuth token.
--
-- Two independent reel flags:
--   * is_done   — auto-set to true when the first clip arrives
--                 (never reverses; further clips welcome but don't
--                  change state)
--   * is_edited — manually toggled by the admin after the editor
--                 has finished editing the chosen clip
-- ============================================================

alter table agency_settings
  add column if not exists google_drive_refresh_token text,
  add column if not exists google_drive_user_email   text,
  add column if not exists google_drive_connected_at timestamptz;

alter table talents
  add column if not exists drive_folder_id   text,
  add column if not exists drive_folder_name text;

alter table todo_lists
  add column if not exists creator_uploads_enabled boolean not null default false,
  add column if not exists talent_id uuid references talents(id) on delete set null;

create index if not exists idx_todo_lists_talent on todo_lists (talent_id);

alter table todo_list_reels
  add column if not exists is_edited     boolean     not null default false,
  add column if not exists edited_at     timestamptz,
  add column if not exists uploads_count integer     not null default 0;

create table if not exists todo_list_reel_uploads (
  id                  uuid primary key default gen_random_uuid(),
  todo_list_reel_id   uuid not null references todo_list_reels(id) on delete cascade,
  drive_file_id       text not null,
  drive_file_name     text not null,
  drive_view_url      text,
  size_bytes          bigint,
  mime_type           text,
  version_number      integer not null,
  uploaded_at         timestamptz not null default now()
);

create index if not exists idx_uploads_todo_reel
  on todo_list_reel_uploads (todo_list_reel_id, version_number);
create index if not exists idx_uploads_uploaded_at
  on todo_list_reel_uploads (uploaded_at desc);
