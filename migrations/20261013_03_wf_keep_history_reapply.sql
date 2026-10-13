-- =====================================================================
--  wf_keep_history() — re-apply the single version (third overwrite).
--  Project: General_apps (wylxvmkcrexwfpjpbhyy)
--
--  _02 was applied and verified at 15:14 UTC Oct 13 (md5 212409a042cc1ad5bb18a07ed1a915a1).
--  At 15:55 UTC the live function was the v103 "__v:/__c:" version again
--  (md5 171880dcbcdb6c4f2ffd2f3a0a179fce): early return for app:*/code:* rows,
--  no per-key cap, all-users prune. Body below = _01, unchanged.
--
--  BEFORE RUNNING: find who pasted the v103 history SQL and delete it from wherever
--  it is saved (SQL Editor snippets, Claude Design notes), or this repeats.
--  Run the whole file at once in Supabase -> SQL Editor.
-- =====================================================================

-- 0) PRECONDITION — live definition read 2026-10-13 15:55 UTC.
do $$
declare live text := md5(pg_get_functiondef('public.wf_keep_history()'::regprocedure));
begin
  if live <> '171880dcbcdb6c4f2ffd2f3a0a179fce' then
    raise exception 'wf_keep_history() changed since this migration was written (live md5 %). Read the live definition and write a new migration.', live;
  end if;
end $$;

-- 1) Index for the per-key lookups (already exists live; idempotent).
create index if not exists weekly_focus_history_key_idx
  on weekly_focus_history (user_id, board_id, item_key, id desc);

-- 2) The function.
create or replace function public.wf_keep_history()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  k text; oldp jsonb; newp jsonb; recent boolean; cap int;
begin
  if tg_table_name = 'weekly_focus_entries' then
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
    if newp is null or not recent or length(newp::text) < length(oldp::text) * 0.9
       or ((newp ? 'del') and not (oldp ? 'del')) then      -- a record being deleted is always kept
      insert into weekly_focus_history (tbl, user_id, board_id, item_key, old_payload)
      values (tg_table_name, old.user_id, old.board_id, k, oldp);

      cap := case when left(k, 2) = '__' then 100 else 20 end;   -- keep the newest N per key
      delete from weekly_focus_history h
       where h.user_id = old.user_id and h.board_id = old.board_id and h.item_key = k
         and h.id not in (select id from weekly_focus_history
                           where user_id = old.user_id and board_id = old.board_id and item_key = k
                           order by id desc limit cap);
    end if;
  end if;

  delete from weekly_focus_history                             -- this user only
   where user_id = old.user_id and saved_at < now() - interval '30 days';
  return case when tg_op = 'DELETE' then old else new end;
end $function$;

-- 3) VERIFY (run after; writes nothing). Expect has_cap = true, early_return = false.
--    Record the md5 in the next migration's step 0.
select md5(pg_get_functiondef('public.wf_keep_history()'::regprocedure)) as md5,
       pg_get_functiondef('public.wf_keep_history()'::regprocedure) like '%cap int%' as has_cap,
       pg_get_functiondef('public.wf_keep_history()'::regprocedure) like '%item_key not in%' as early_return;
