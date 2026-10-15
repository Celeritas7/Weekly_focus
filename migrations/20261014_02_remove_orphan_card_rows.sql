-- ============================================================
-- Weekly Focus · remove orphan card rows (2026-10-14)
-- weekly_focus_entries has 70 "app:" rows for board my_week, but the inventory lists 68 cards.
-- The two extra rows belong to no card. Neither id appears in any __inventory snapshot in
-- weekly_focus_history (oldest snapshot 2026-10-12 15:17), and both rows were last written by the
-- bulk sync on 2026-10-12 06:01:12, so they are leftovers from cards removed before then.
--
--   app:mr9enx3cwkk44   not archived · 16 subtasks, 4 still open (gift list: "PS5 for siddhesh", ...)
--   app:mrhyg07bgeito   archived     ·  6 subtasks, all done      (work manuals / pick-up lists)
--
-- Safety:
--   * Both rows are copied to weekly_focus_orphan_backup (kept until you drop it), and the
--     wf_hist_entries trigger also snapshots each delete into weekly_focus_history (30 days).
--   * A row is deleted only if its card is still missing from the inventory at run time.
--   * The whole thing runs in one transaction and aborts unless exactly 0 or 2 rows are removed.
-- Run in Supabase -> SQL Editor (all at once).
-- ============================================================

begin;

create table if not exists public.weekly_focus_orphan_backup (
  backed_up_at timestamptz not null default now(),
  user_id uuid,
  board_id text,
  item_key text,
  updated_at timestamptz,
  payload jsonb
);
alter table public.weekly_focus_orphan_backup enable row level security;
drop policy if exists "own orphan backup read" on public.weekly_focus_orphan_backup;
create policy "own orphan backup read" on public.weekly_focus_orphan_backup for select using (auth.uid() = user_id);

create temp table _orphans on commit drop as
select e.user_id, e.board_id, e.item_key, e.updated_at, e.payload
  from public.weekly_focus_entries e
 where e.board_id = 'my_week'
   and e.item_key in ('app:mr9enx3cwkk44', 'app:mrhyg07bgeito')
   and not exists (select 1
                     from public.weekly_focus_inventory i, jsonb_array_elements(i.apps) a
                    where i.user_id = e.user_id and i.board_id = e.board_id and a->>'id' = e.item_key);

insert into public.weekly_focus_orphan_backup (user_id, board_id, item_key, updated_at, payload)
select user_id, board_id, item_key, updated_at, payload from _orphans;

do $$
declare n int;
begin
  delete from public.weekly_focus_entries e
   using _orphans o
   where e.user_id = o.user_id and e.board_id = o.board_id and e.item_key = o.item_key;
  get diagnostics n = row_count;
  if n not in (0, 2) then
    raise exception 'orphan cleanup: expected 2 rows, would delete % - rolled back', n;
  end if;
  raise notice 'orphan cleanup: deleted % row(s)', n;
end $$;

commit;

-- Check afterwards — app_rows should equal inventory cards:
-- select (select count(*) from weekly_focus_entries where board_id = 'my_week' and item_key like 'app:%') as app_rows,
--        (select jsonb_array_length(apps) from weekly_focus_inventory where board_id = 'my_week') as cards;

-- Undo (puts both rows back exactly as they were):
-- insert into weekly_focus_entries (user_id, board_id, item_key, payload, updated_at)
-- select user_id, board_id, item_key, payload, updated_at from weekly_focus_orphan_backup
-- on conflict (user_id, board_id, item_key) do nothing;
