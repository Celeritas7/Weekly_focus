-- ============================================================
-- Weekly Focus · close the public read on wf_subtasks_flat (2026-10-24)
--
-- Found while checking the Vercel deploy. public.wf_subtasks_flat is owned by postgres
-- (which bypasses RLS) and was created WITHOUT security_invoker, so it runs with the
-- owner's rights. The anon role had SELECT on it, so anyone holding the public anon key
-- that ships in js/config.js could read every subtask title through
-- /rest/v1/wf_subtasks_flat without signing in.
-- Read-only check on 2026-10-24 as role anon: 215 rows across 59 cards visible.
-- Supabase's security advisor lists it as "Security Definer View" (ERROR).
--
-- Fix:
--   1. security_invoker = on: the view now applies weekly_focus_entries' RLS of whoever
--      reads it, so a signed-in app sees only its user's rows (same as before for them).
--      Edge functions using the service_role key bypass RLS and are unaffected.
--   2. anon loses every privilege on it; authenticated keeps SELECT only (the view is
--      read-only anyway: it unnests JSON, so it was never updatable).
-- Nothing in the database depends on this view (checked pg_depend and function bodies),
-- and WF's own code does not read it.
--
-- Run in Supabase -> SQL Editor (all at once), then run the VERIFY block.
-- ============================================================

begin;

-- step 0: the view must still be the one described above
do $$
begin
  if to_regclass('public.wf_subtasks_flat') is null then
    raise exception 'wf_subtasks_flat does not exist - nothing to fix, stop here';
  end if;
end $$;

alter view public.wf_subtasks_flat set (security_invoker = on);
revoke all on public.wf_subtasks_flat from anon;
revoke all on public.wf_subtasks_flat from authenticated;
grant select on public.wf_subtasks_flat to authenticated;

commit;

-- VERIFY (expect: invoker = {security_invoker=on}, anon_select = false, auth_select = true, anon_rows = 0)
-- select (select reloptions from pg_class where oid = 'public.wf_subtasks_flat'::regclass) invoker,
--        has_table_privilege('anon', 'public.wf_subtasks_flat', 'select') anon_select,
--        has_table_privilege('authenticated', 'public.wf_subtasks_flat', 'select') auth_select;
-- begin; set local role anon; select count(*) as anon_rows from public.wf_subtasks_flat; rollback;
--   (the last line should now fail with "permission denied", which is the goal)
