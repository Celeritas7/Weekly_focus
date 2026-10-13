# WF history trigger — report for Akatsuki (2026-10-13)

Re: review-2026-10-12-b1, fix A ("history for every row"). Project `General_apps` (`wylxvmkcrexwfpjpbhyy`).

## TL;DR

Fix A was applied and worked, then **`wf_keep_history()` was overwritten by a different version** that brings the early return back. Per-record rows (`app:*`, `code:*`, …) get no history again, including on delete. The two versions need merging; neither should be re-applied over the other blindly.

## Timeline (UTC)

| Time | Event |
|---|---|
| Oct 13, before 13:51 | Fix A applied via SQL Editor (`docs/migration-wf-history-all-rows.sql`). Verified live: no early return, per-key cap (`cap int`), per-user 30-day prune. Index `weekly_focus_history_key_idx` created. |
| 13:51:44 | `app:mu7zbvdwtqdm8` (Akatsuki card) edit → history row ✅ |
| 14:13:41 | Same card, 22 min later → 2nd history row ✅ (test steps 1–2 pass) |
| between 14:13 and 14:36 | **Function replaced** by another version (not by this session) |
| 14:36:44 | `test2` card deleted in app: PostgREST `DELETE /rest/v1/weekly_focus_entries` → 204, row `app:mv6s7j8aa11xw` gone, **no history row** ❌ |
| ~14:50 | Read the live function: it is the replacement below. |

## What is live now

```sql
if old.item_key not in ('__board', '__timeline', '__inbox')
   and left(old.item_key, 4) not in ('__v:', '__c:') then
  return case when tg_op = 'DELETE' then old else new end;   -- app:*, code:* skipped again
end if;
...
if newp is null or not recent or length(newp::text) < length(oldp::text) * 0.9
   or ((newp ? 'del') and not (oldp ? 'del')) then          -- a record being deleted is always kept
  insert ...
end if;
delete from weekly_focus_history where saved_at < now() - interval '30 days';  -- all users again
```

Compared with fix A it:
- **re-adds the early return**, now also allowing `__v:` and `__c:` keys (looks like per-record vault/chats rows);
- adds the soft-delete rule (`del` flag appears → always snapshot) — good, fix A lacked it;
- **drops the per-key cap** (20 / 100);
- **reverts the prune to all users** on every write.

Nothing else touches `weekly_focus_history` (checked every function body; cron jobs don't). Triggers `wf_hist_entries` / `wf_hist_inv` are unchanged (BEFORE UPDATE OR DELETE). Table owner/function owner = `postgres`, `security definer`, no FK — the insert path is fine.

## Proposed merged function (not applied)

Keeps both intents: history for every row (fix A) + the `del` soft-delete rule + cap + per-user prune.

```sql
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

      cap := case when left(k, 2) = '__' then 100 else 20 end;
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
```

Verify after applying: delete a throwaway `app:` row → its key gets 1 history row.

## Other findings

1. **Leftover test row:** `weekly_focus_entries.item_key = 'app:__histtest'` (inserted 14:49:52 for a controlled delete test). The Supabase MCP tool would not run the `DELETE` (it holds destructive statements for a confirmation that never appears; this is also why `create or replace function` timed out four times from the agent). Remove it in the SQL Editor:
   `delete from weekly_focus_entries where item_key = 'app:__histtest';`
2. **Secret in cron:** job `akatsuki-tts` (jobid 3) has the **service_role JWT hard-coded** in its command. Anyone who can read `cron.job` gets full DB access. Rotate the key and read it from Vault (`vault.decrypted_secrets`) instead.
3. **Orphan entries:** 69 `app:*` rows vs 66 apps in inventory — 3 rows may be leftovers of deleted cards. Not investigated.
4. **Two agents editing one function:** fix A and the `__v:`/`__c:` change collided. Suggest one owner for `wf_keep_history()`, and a migration file in the repo for every change.
