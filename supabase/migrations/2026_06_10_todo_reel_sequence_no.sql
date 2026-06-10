-- ============================================================
-- Immutable sequence number per to-do-list reel — 2026-06-10
-- Applied via Supabase MCP.
--
-- Problem we're fixing: previously the "#N" label shown to the creator,
-- to the admin, and embedded in the Drive filename were computed from
-- DIFFERENT sortings (priority+added_at vs added_at desc), and they
-- shifted every time a reel was added/removed. Net effect: a reel could
-- be displayed as #6 in the UI but uploaded to Drive as #12.
--
-- Fix: each row gets an immutable sequence_no assigned at insertion,
-- unique within its to-do list. Deletions leave gaps (good — numbers
-- never collide with each other in the creator's mental model).
-- ============================================================

alter table todo_list_reels
  add column if not exists sequence_no integer;

with numbered as (
  select id, row_number() over (
    partition by todo_list_id
    order by added_at nulls first, id
  ) as rn
  from todo_list_reels
)
update todo_list_reels r
set sequence_no = n.rn
from numbered n
where r.id = n.id
  and r.sequence_no is null;

alter table todo_list_reels
  alter column sequence_no set not null;

alter table todo_list_reels
  drop constraint if exists uq_todo_list_reels_seq;
alter table todo_list_reels
  add constraint uq_todo_list_reels_seq unique (todo_list_id, sequence_no);

create index if not exists idx_todo_list_reels_seq
  on todo_list_reels (todo_list_id, sequence_no);
