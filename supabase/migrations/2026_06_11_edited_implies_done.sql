-- ============================================================
-- Invariant: "edited" implies "done" — 2026-06-11
-- Applied via Supabase MCP.
--
-- The Trello tabs (Pending / To be edited / Edited) assume each reel
-- belongs to exactly one bucket. Without this invariant a row with
-- is_edited=true && is_done=false would render in both Pending and
-- Edited at the same time.
--
-- Most likely source of bad rows: the prior hidden->edited backfill
-- (2026_06_10_hidden_to_edited_backfill.sql) flipped is_edited=true
-- on historical hidden reels but didn't touch is_done. Anything that
-- was hidden + not-done would hit the bug.
--
-- The PATCH /api/uploads/reels/:id/edited endpoint now enforces this
-- invariant on every write going forward.
-- ============================================================

update todo_list_reels
set is_done = true,
    done_at = coalesce(done_at, edited_at, now())
where is_edited = true
  and is_done = false;
