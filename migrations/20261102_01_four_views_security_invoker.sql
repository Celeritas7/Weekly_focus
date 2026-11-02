-- ============================================================
-- General_apps · four other apps' views readable without sign-in (2026-11-02)
--
-- public.sift_conflicts, public.v_calendar_requests, public.chatak_daily_best and
-- public.dhara_act_overview are owned by postgres (which bypasses RLS) and were created
-- WITHOUT security_invoker, so they run with the owner's rights. anon has SELECT on all four.
-- Supabase's security advisor lists them as "Security Definer View".
--
-- Read-only checks on 2026-11-02:
--   sift_conflicts       -> sift_note_links (5,714 rows, RLS: owner or sift_is_admin()).
--                           The view skips that rule: anyone with the anon key would see every
--                           user's near-duplicate note pairs. 0 rows today (no pair reaches
--                           sim >= 0.9 yet), so nothing has leaked, but the next one would.
--   v_calendar_requests  -> team_requests (RLS on, NO policies, so only the view could read it).
--                           0 rows today (team = 'sukkiri').
--   chatak_daily_best    -> chatak_offers / _price_points / _stores, all "readable to public" by
--                           their own policy. The view exposes nothing extra.
--   dhara_act_overview   -> dhara_* tables, all "public read" to anon by policy. 52 rows, same
--                           as reading the tables directly.
-- No app code reads sift_conflicts or v_calendar_requests (searched Sift, Sukkiri, Calender_app,
-- Akatsuki, Weekly_focus); Sift's schema.sql only defines its view. No database function uses
-- either view.
--
-- Fix:
--   1. security_invoker = on for all four: each view now applies its tables' RLS for whoever
--      reads it. Chatak and Dhara stay public (their tables allow it), so their pages behave
--      exactly as before. Edge functions using the service_role key bypass RLS: unaffected.
--   2. sift_conflicts and v_calendar_requests: anon loses every privilege; authenticated keeps
--      SELECT only. A signed-in Sift user sees only their own pairs (or all, if admin).
--      v_calendar_requests returns no rows to anyone but service_role until team_requests gets
--      a policy (it has none today), which matches how the table itself is protected.
--
-- Run in Supabase -> SQL Editor (all at once), then run the VERIFY block.
-- ============================================================

begin;

-- step 0: the four views must still be the ones read on 2026-11-02 (md5 of pg_get_viewdef)
do $$
declare
  want constant jsonb := '{
    "sift_conflicts":      "f645d6501f395e4edd6793ea3244cf6e",
    "v_calendar_requests": "336a0d88e6254d1cc6c52fb14cbe3a59",
    "chatak_daily_best":   "33e6ca7bf8bb494161786f5d98194dd7",
    "dhara_act_overview":  "edead99b1a7f292679bec86f96e72110"
  }';
  v text; got text;
begin
  for v in select jsonb_object_keys(want) loop
    if to_regclass('public.' || v) is null then
      raise exception 'public.% does not exist - stop and read the live state again', v;
    end if;
    got := md5(pg_get_viewdef(('public.' || v)::regclass));
    if got <> want ->> v then
      raise exception 'public.% changed since 2026-11-02 (md5 % , expected %) - read it again and write a new migration', v, got, want ->> v;
    end if;
  end loop;
end $$;

-- step 1: every view runs with the reader's rights
alter view public.sift_conflicts      set (security_invoker = on);
alter view public.v_calendar_requests set (security_invoker = on);
alter view public.chatak_daily_best   set (security_invoker = on);
alter view public.dhara_act_overview  set (security_invoker = on);

-- step 2: the two private views: no anon access, read-only for signed-in users
revoke all on public.sift_conflicts      from anon;
revoke all on public.sift_conflicts      from authenticated;
grant select on public.sift_conflicts    to authenticated;
revoke all on public.v_calendar_requests from anon;
revoke all on public.v_calendar_requests from authenticated;
grant select on public.v_calendar_requests to authenticated;

commit;

-- ============================================================
-- VERIFY (run after the block above). Expected:
--   all four rows: invoker = true
--   sift_conflicts, v_calendar_requests: anon_select = false, auth_select = true
--   chatak_daily_best, dhara_act_overview: anon_select = true (public by design)
-- ============================================================
-- select c.relname,
--        coalesce('security_invoker=on' = any(c.reloptions) or 'security_invoker=true' = any(c.reloptions), false) as invoker,
--        has_table_privilege('anon', c.oid, 'select')          as anon_select,
--        has_table_privilege('authenticated', c.oid, 'select') as auth_select
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
--   and c.relname in ('sift_conflicts','v_calendar_requests','chatak_daily_best','dhara_act_overview')
-- order by 1;
--
-- VERIFY 2 (as anon; read-only, rolled back). Expected: an error "permission denied" for the
-- first select; run the Dhara line on its own and expect 52.
-- begin; set local role anon; select count(*) from public.sift_conflicts; rollback;
-- begin; set local role anon; select count(*) from public.dhara_act_overview; rollback;
