# Weekly Focus — notes for Claude

## Database changes
- Any change to the Supabase database (project `General_apps`, `wylxvmkcrexwfpjpbhyy`) goes
  through a new file in `migrations/` — see `migrations/README.md`. No ad-hoc DDL.
- `public.wf_keep_history()` has exactly one version: `migrations/20261013_01_wf_keep_history_merged.sql` (re-applied by `_02`, `_03`). The applied log in `migrations/README.md` has the current md5.
  To change it, first read the live definition (`pg_get_functiondef`), merge into that, and write
  a new migration whose step 0 checks the live md5.
- The Supabase MCP tool may hang on DDL/DELETE (it waits for a confirmation that does not appear).
  Commit the migration and have the user run it in the SQL Editor.
