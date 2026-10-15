-- =====================================================================
--  wf_keep_history() — always keep a snapshot for Vault / Chats record rows.
--  Project: General_apps (wylxvmkcrexwfpjpbhyy)
--
--  Why: the 10-minute throttle skips a snapshot when the same key was snapshotted in the
--  last 10 minutes. With one row per record (__v:<id> / __c:<id>), two devices editing the
--  same record within 10 minutes lose the first device's version without a copy
--  (test 4, Oct 15: A's "T4-A" was overwritten by B's "T4-B"; history only holds "T4").
--
--  Change: for item_key '__v:*' and '__c:*', every update that changes the payload keeps a
--  snapshot (no throttle). Everything else is unchanged from _03 (body from _01):
--  identical re-uploads (oldp = newp) still write nothing, the per-key cap and the
--  30-day per-user prune still apply. Note: '__v:'/'__c:' keys start with '__', so their
--  cap is 100 per key (not 20).
--
--  Run the whole file at once in Supabase -> SQL Editor.
-- =====================================================================

-- 0) PRECONDITION — live definition read 2026-10-15 (= _03).
do $$
declare live text := md5(pg_get_functiondef('public.wf_keep_history()'::regprocedure));
begin
  if live <> '212409a042cc1ad5bb18a07ed1a915a1' then
    raise exception 'wf_keep_history() changed since this migration was written (live md5 %). Read the live definition and write a new migration.', live;
  end if;
end $$;

-- 1) The function.
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
       or ((newp ? 'del') and not (oldp ? 'del'))           -- a record being deleted is always kept
       or left(k, 4) in ('__v:', '__c:') then                 -- Vault / Chats records: every change is kept
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

-- 2) VERIFY (run after; writes nothing). Expect has_cap = true, records_always = true.
--    Record the md5 in migrations/README.md and in the next migration's step 0.
select md5(pg_get_functiondef('public.wf_keep_history()'::regprocedure)) as md5,
       pg_get_functiondef('public.wf_keep_history()'::regprocedure) like '%cap int%' as has_cap,
       pg_get_functiondef('public.wf_keep_history()'::regprocedure) like '%in (''__v:'', ''__c:'')%' as records_always;

-- 3) Functional check (optional): edit one Vault record twice within a minute in the app, then
--    select id, saved_at, old_payload->'r'->'f'->>'t' from weekly_focus_history
--     where item_key = '__v:<id>' order by id desc limit 3;
--    Expect one new row per edit.
