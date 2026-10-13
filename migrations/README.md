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
| `public.wf_keep_history()` | `20261013_01_wf_keep_history_merged.sql` | The only version. History for every `weekly_focus_entries` row; `del` flag always kept; cap 20 per key (100 for `__*`); per-user 30-day prune. |

Older SQL in `docs/` is history, not something to re-run.
