# Database migrations (Supabase project `General_apps`)

Every change to the database goes through a file in this folder. Nothing is changed
by hand in the SQL Editor or by an agent without a migration file committed first.

## Rules

1. **One file per change**, named `YYYYMMDD_NN_short_name.sql`, never edited after it has run.
   A fix is a new file.
2. **Start by reading the live definition.** Before writing a migration that changes an
   existing object, read what is live now:
   ```sql
   select md5(pg_get_functiondef('public.wf_keep_history()'::regprocedure)),
          pg_get_functiondef('public.wf_keep_history()'::regprocedure);
   ```
   Merge your change into *that* text, not into an older copy from the repo or a chat.
3. **Guard the precondition.** A migration that replaces a function starts with a step 0
   that compares the live md5 with the one you read and raises if they differ (see
   `20261013_01_wf_keep_history_merged.sql`). If it raises, someone changed the object:
   read it again and write a new migration. Never just update the md5.
4. **Run the whole file at once** in Supabase → SQL Editor, then run its VERIFY step and
   note the new md5 — the next migration's step 0 uses it.

## Single-version objects

| Object | Current migration | Notes |
|---|---|---|
| `public.wf_keep_history()` | `20261013_03_wf_keep_history_reapply.sql` (body from `_01`) | The only version. History for every `weekly_focus_entries` row; `del` flag always kept; cap 20 per key (100 for `__*`); per-user 30-day prune. |

Older SQL in `docs/` is history, not something to re-run.

## Applied log

| Migration | Applied (UTC) | md5 after | Notes |
|---|---|---|---|
| `20261013_01_wf_keep_history_merged.sql` | 2026-10-13 ~15:00 | `212409a042cc1ad5bb18a07ed1a915a1` | Overwritten by 15:05 with STEP5 fix A (md5 `a0767ab0dc079df9670f58ae0a690001`) from outside this repo. |
| `20261013_02_wf_keep_history_reapply.sql` | 2026-10-13 ~15:12 | `212409a042cc1ad5bb18a07ed1a915a1` | Verified 15:14: live md5 matches; deleting `app:__histtest` wrote 1 history row (delete path works). **Next migration's step 0 checks `212409a042cc1ad5bb18a07ed1a915a1`.** |
| `20261013_03_wf_keep_history_reapply.sql` | 2026-10-13 ~16:00 | `212409a042cc1ad5bb18a07ed1a915a1` | Live had been overwritten by 15:55 with the v103 `__v:`/`__c:` version (md5 `171880dcbcdb6c4f2ffd2f3a0a179fce`). Verified 16:03. Saved SQL Editor snippets and local v102/v103 history SQL deleted; `history-trigger-v102.sql` removed from the repo. **Next migration's step 0 checks `212409a042cc1ad5bb18a07ed1a915a1`.** |
