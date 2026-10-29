-- ============================================================
-- Weekly Focus · public read-only links for Code tab folders (2026-10-29)
--
-- The owner switches "Share" on a Code folder (or on All code). Anyone holding that
-- folder's link can read it live, without signing in. Nothing else becomes readable:
--   * weekly_focus_entries keeps its RLS exactly as it is (own rows only).
--   * Reads go through two SECURITY DEFINER functions that take the secret token and
--     return only files inside the shared folder (and its subfolders), never other
--     boards, never deleted rows, never version history.
--   * The token is 32 random URL-safe characters (~190 bits), made in the browser with
--     crypto.getRandomValues. Unknown, malformed or switched-off tokens return nothing.
--
-- New objects (none existing are changed):
--   table    public.wf_code_shares      one row per shared folder; owner-only RLS
--   function public.wf_code_shared_list(p_token)            → folders + files, no contents
--   function public.wf_code_shared_file(p_token, p_file_id) → one file's contents
--
-- Run in Supabase -> SQL Editor (all at once), then run the VERIFY block.
-- ============================================================

begin;

create table if not exists public.wf_code_shares (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id  text        not null default '',          -- '' = the whole Code tab ("All code")
  token      text        not null unique check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  enabled    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, folder_id)
);
alter table public.wf_code_shares enable row level security;
drop policy if exists wf_code_shares_owner on public.wf_code_shares;
create policy wf_code_shares_owner on public.wf_code_shares for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.wf_code_shares from anon;
grant select, insert, update, delete on public.wf_code_shares to authenticated;

-- folders + files of a shared folder, without file contents
create or replace function public.wf_code_shared_list(p_token text)
returns table (id text, kind text, name text, parent text, lang text, size integer, u bigint, root_id text)
language sql stable security definer set search_path = public as $$
  with recursive
  s as (
    select x.user_id, x.folder_id from public.wf_code_shares x
     where p_token ~ '^[A-Za-z0-9_-]{22,64}$' and x.token = p_token and x.enabled
     limit 1),
  r as (
    select substring(e.item_key from 6) as id,
           case when e.item_key like 'fold:%' then 'folder' else 'file' end as kind,
           e.payload as p
      from public.weekly_focus_entries e join s on e.user_id = s.user_id
     where e.board_id = 'wf-code' and (e.item_key like 'code:%' or e.item_key like 'fold:%')
       and coalesce((e.payload->>'del')::boolean, false) = false),
  tree(id) as (
    select s.folder_id from s
    union
    select r.id from r join tree t on r.kind = 'folder' and coalesce(r.p->>'parent', '') = t.id)
  select r.id, r.kind, r.p->>'name',
         coalesce(case when r.kind = 'folder' then r.p->>'parent' else r.p->>'folder' end, ''),
         r.p->>'lang', case when r.kind = 'file' then length(coalesce(r.p->>'code', '')) end,
         nullif(r.p->>'u', '')::bigint, s.folder_id
    from r, s
   where s.folder_id = ''                                                         -- whole tab
      or (r.kind = 'folder' and r.id in (select id from tree))
      or (r.kind = 'file' and coalesce(r.p->>'folder', '') in (select id from tree));
$$;

-- one file's contents, only if it sits inside the shared folder
create or replace function public.wf_code_shared_file(p_token text, p_file_id text)
returns table (id text, name text, lang text, code text, u bigint)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.lang, e.payload->>'code', l.u
    from public.wf_code_shared_list(p_token) l
    join public.wf_code_shares x on x.token = p_token
    join public.weekly_focus_entries e
      on e.user_id = x.user_id and e.board_id = 'wf-code' and e.item_key = 'code:' || l.id
   where l.kind = 'file' and l.id = p_file_id;
$$;

revoke all on function public.wf_code_shared_list(text) from public;
revoke all on function public.wf_code_shared_file(text, text) from public;
grant execute on function public.wf_code_shared_list(text) to anon, authenticated;
grant execute on function public.wf_code_shared_file(text, text) to anon, authenticated;

commit;

-- VERIFY (expect: table_rls = true, anon_table = false, anon_list = true, anon_file = true, bad_token_rows = 0)
-- select (select relrowsecurity from pg_class where oid = 'public.wf_code_shares'::regclass) table_rls,
--        has_table_privilege('anon', 'public.wf_code_shares', 'select') anon_table,
--        has_function_privilege('anon', 'public.wf_code_shared_list(text)', 'execute') anon_list,
--        has_function_privilege('anon', 'public.wf_code_shared_file(text,text)', 'execute') anon_file,
--        (select count(*) from public.wf_code_shared_list('not-a-real-token-xxxxxxxxxxxx')) bad_token_rows;
