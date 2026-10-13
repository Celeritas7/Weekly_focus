-- ============================================================
-- Weekly Focus v102 · history trigger (free-plan backup)
-- Before a blob row is overwritten or deleted, its previous copy is kept in weekly_focus_history for 30 days.
-- Covers: weekly_focus_entries rows __board / __timeline / __inbox, and weekly_focus_inventory.
-- Size control: a copy is kept at most every 10 minutes per row — EXCEPT a save that shrinks the row by
-- more than 10 %, which is always kept (that is what a wipe looks like).
-- Run each numbered block on its own in Supabase → SQL Editor.
-- ============================================================

-- 1 · table
create table if not exists public.weekly_focus_history (
  id bigserial primary key,
  saved_at timestamptz not null default now(),
  tbl text not null,
  user_id uuid,
  board_id text,
  item_key text,
  old_payload jsonb not null
);
create index if not exists wfh_lookup on public.weekly_focus_history (user_id, board_id, item_key, saved_at desc);
create index if not exists wfh_age on public.weekly_focus_history (saved_at);
alter table public.weekly_focus_history enable row level security;
drop policy if exists "own history read" on public.weekly_focus_history;
create policy "own history read" on public.weekly_focus_history for select using (auth.uid() = user_id);

-- 2 · function
create or replace function public.wf_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text; oldp jsonb; newp jsonb; recent boolean;
begin
  if tg_table_name = 'weekly_focus_entries' then
    if old.item_key not in ('__board', '__timeline', '__inbox') then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    k := old.item_key; oldp := old.payload;
    newp := case when tg_op = 'DELETE' then null else new.payload end;
  else
    k := '__inventory';
    oldp := jsonb_build_object('apps', old.apps, 'study', old.study, 'office', old.office, 'updated_at', old.updated_at);
    newp := case when tg_op = 'DELETE' then null
                 else jsonb_build_object('apps', new.apps, 'study', new.study, 'office', new.office, 'updated_at', new.updated_at) end;
  end if;

  if oldp is not null and oldp is distinct from newp then
    select exists (select 1 from weekly_focus_history h
                   where h.user_id = old.user_id and h.board_id = old.board_id and h.item_key = k
                     and h.saved_at > now() - interval '10 minutes') into recent;
    if newp is null or not recent or length(newp::text) < length(oldp::text) * 0.9 then
      insert into weekly_focus_history (tbl, user_id, board_id, item_key, old_payload)
      values (tg_table_name, old.user_id, old.board_id, k, oldp);
    end if;
  end if;

  delete from weekly_focus_history where saved_at < now() - interval '30 days';
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- 3 · triggers
drop trigger if exists wf_hist_entries on public.weekly_focus_entries;
create trigger wf_hist_entries before update or delete on public.weekly_focus_entries
  for each row execute function public.wf_keep_history();
drop trigger if exists wf_hist_inv on public.weekly_focus_inventory;
create trigger wf_hist_inv before update or delete on public.weekly_focus_inventory
  for each row execute function public.wf_keep_history();

-- 4 · check it works (make any edit in the app, wait a few seconds, then run)
select item_key, saved_at, length(old_payload::text) as bytes,
       jsonb_array_length(coalesce(old_payload->'meta'->'cvault', '[]')) as vault
from public.weekly_focus_history order by saved_at desc limit 10;

-- ============================================================
-- RESTORE — only when needed. Look first:
-- select id, item_key, saved_at, jsonb_array_length(coalesce(old_payload->'meta'->'cvault','[]')) as vault
-- from weekly_focus_history where board_id = 'my_week' and item_key = '__board' order by saved_at desc limit 20;
--
-- Put back ONLY the Vault + Chats from history row <ID> (everything else on the board stays as it is now):
-- update weekly_focus_entries e
--   set payload = jsonb_set(jsonb_set(e.payload, '{meta,cvault}', h.old_payload->'meta'->'cvault'),
--                           '{meta,cchats}', h.old_payload->'meta'->'cchats'),
--       updated_at = now()
-- from weekly_focus_history h
-- where h.id = <ID> and e.user_id = h.user_id and e.board_id = h.board_id and e.item_key = '__board';
-- Then reload the app twice.
-- ============================================================
