-- WF — history for every row (Akatsuki review-2026-10-12-b1, fix A)
-- wf_keep_history() used to return early for every item_key except __board/__timeline/__inbox,
-- so per-record rows (app:*, code:*, ...) got no history. Also scopes the 30-day prune to the writing user.
-- Unchanged on purpose: trigger names/timing (wf_hist_entries BEFORE UPDATE OR DELETE, fires after
-- akatsuki_wf_owner_guard), the 10-minute throttle, shrink > 10 % and delete exceptions, RLS, inventory branch.

create index if not exists weekly_focus_history_key_idx
  on weekly_focus_history (user_id, board_id, item_key, id desc);

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
    if newp is null or not recent or length(newp::text) < length(oldp::text) * 0.9 then
      insert into weekly_focus_history (tbl, user_id, board_id, item_key, old_payload)
      values (tg_table_name, old.user_id, old.board_id, k, oldp);

      cap := case when k like '\_\_%' then 100 else 20 end;
      delete from weekly_focus_history h
       where h.user_id = old.user_id and h.board_id = old.board_id and h.item_key = k
         and h.id not in (select id from weekly_focus_history
                           where user_id = old.user_id and board_id = old.board_id and item_key = k
                           order by id desc limit cap);
    end if;
  end if;

  delete from weekly_focus_history
   where user_id = old.user_id and saved_at < now() - interval '30 days';
  return case when tg_op = 'DELETE' then old else new end;
end $function$;
