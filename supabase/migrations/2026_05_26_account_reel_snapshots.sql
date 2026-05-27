-- ============================================================
-- Per-reel daily snapshots — 2026-05-26
-- Applied via Supabase MCP.
-- ============================================================

create table if not exists account_reel_snapshots (
  id bigserial primary key,
  reel_id uuid not null,
  account_id uuid references my_accounts(id) on delete cascade,
  snapshot_date date not null,
  views integer default 0,
  likes integer default 0,
  comments integer default 0,
  created_at timestamptz default now(),
  unique (reel_id, snapshot_date)
);

create index if not exists account_reel_snapshots_account_date_idx
  on account_reel_snapshots(account_id, snapshot_date desc);
create index if not exists account_reel_snapshots_reel_date_idx
  on account_reel_snapshots(reel_id, snapshot_date desc);

alter table account_reel_snapshots enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='account_reel_snapshots' and policyname='Authenticated full access') then
    create policy "Authenticated full access" on account_reel_snapshots for all using (auth.role() = 'authenticated');
  end if;
end $$;
