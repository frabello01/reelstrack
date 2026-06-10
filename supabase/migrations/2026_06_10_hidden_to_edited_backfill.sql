-- ============================================================
-- Hidden → Edited migration — 2026-06-10
-- Applied via Supabase MCP.
--
-- Per workflow change: we're removing the Hide concept from the admin
-- UI and replacing it with the explicit "Edited" flag. All historical
-- hidden reels become edited so they don't disappear from the admin's
-- view and land in the right Trello column. We also clear is_hidden
-- so the next time the public share page loads, those reels reappear
-- (the creator can keep adding clips if she wants).
-- ============================================================

update todo_list_reels
set is_edited = true,
    edited_at = coalesce(edited_at, now()),
    is_hidden = false
where is_hidden = true;
