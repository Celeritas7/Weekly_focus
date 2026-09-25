-- =====================================================================
--  Weekly Focus v91 · Focus groups — run once in Supabase → SQL Editor
--  Temporary groups of apps. An app can be in SEVERAL groups (v91); it is
--  hidden in WF only when every group it is in is archived.
--  Readable/writable by the app (RLS, signed in) and by Claude via the
--  wf_group_* functions. See docs/FOCUS-GROUPS.md.  Safe to re-run.
-- =====================================================================

-- 1) Tables ------------------------------------------------------------
create table if not exists public.weekly_focus_groups (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id    text        not null,
  id          text        not null,              -- 'g_…'
  name        text        not null,
  note        text,                              -- why this group exists / goal
  hue         int         check (hue between 0 and 359),   -- null = derived from name
  ord         int         not null default 0,    -- display order (focus groups always first)
  focus       boolean     not null default false,
  archived_at timestamptz,                       -- set = group hidden in WF
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, board_id, id)
);

-- One row per (app, group). v91: an app may appear in several groups.
create table if not exists public.weekly_focus_group_apps (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id   text        not null,
  item_key   text        not null,               -- WF app id, e.g. 'app:k3j9…'
  group_id   text        not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_id, item_key, group_id),
  foreign key (user_id, board_id, group_id)
    references public.weekly_focus_groups (user_id, board_id, id) on delete cascade
);

-- v90 → v91 migration: the old primary key allowed one group per app.
do $$
declare pk text;
begin
  select conname into pk from pg_constraint
   where conrelid = 'public.weekly_focus_group_apps'::regclass and contype = 'p' and array_length(conkey, 1) = 3;
  if pk is not null then
    execute format('alter table public.weekly_focus_group_apps drop constraint %I', pk);
    alter table public.weekly_focus_group_apps add primary key (user_id, board_id, item_key, group_id);
  end if;
end $$;

-- 2) RLS ---------------------------------------------------------------
alter table public.weekly_focus_groups     enable row level security;
alter table public.weekly_focus_group_apps enable row level security;

drop policy if exists "fg_select_own" on public.weekly_focus_groups;
drop policy if exists "fg_insert_own" on public.weekly_focus_groups;
drop policy if exists "fg_update_own" on public.weekly_focus_groups;
drop policy if exists "fg_delete_own" on public.weekly_focus_groups;
create policy "fg_select_own" on public.weekly_focus_groups for select to authenticated using (auth.uid() = user_id);
create policy "fg_insert_own" on public.weekly_focus_groups for insert to authenticated with check (auth.uid() = user_id);
create policy "fg_update_own" on public.weekly_focus_groups for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fg_delete_own" on public.weekly_focus_groups for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "fga_select_own" on public.weekly_focus_group_apps;
drop policy if exists "fga_insert_own" on public.weekly_focus_group_apps;
drop policy if exists "fga_update_own" on public.weekly_focus_group_apps;
drop policy if exists "fga_delete_own" on public.weekly_focus_group_apps;
create policy "fga_select_own" on public.weekly_focus_group_apps for select to authenticated using (auth.uid() = user_id);
create policy "fga_insert_own" on public.weekly_focus_group_apps for insert to authenticated with check (auth.uid() = user_id);
create policy "fga_update_own" on public.weekly_focus_group_apps for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fga_delete_own" on public.weekly_focus_group_apps for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.weekly_focus_groups     to authenticated;
grant select, insert, update, delete on public.weekly_focus_group_apps to authenticated;
revoke all on public.weekly_focus_groups     from anon;
revoke all on public.weekly_focus_group_apps from anon;

-- 3) Read view: one row per app, with all its groups -------------------
drop view if exists public.weekly_focus_apps_v;
create view public.weekly_focus_apps_v with (security_invoker = on) as
select i.user_id, i.board_id,
       a->>'id'    as item_key,
       a->>'name'  as app,
       a->>'group' as category,
       coalesce((e.payload->>'active')::boolean, false) as on_week,
       coalesce((e.payload->>'upd')::boolean, false)    as update_flag,
       (e.payload->>'rank')::int                        as rank,
       coalesce(gm.names, '')        as groups,          -- 'Akatsuki links, Coding'
       coalesce(gm.ids, '{}')        as group_ids,
       coalesce(gm.n, 0)             as group_count,
       coalesce(gm.n > 0 and gm.n = gm.n_arch, false) as hidden   -- every group archived → hidden in WF
from public.weekly_focus_inventory i
cross join lateral jsonb_array_elements(i.apps) a
left join public.weekly_focus_entries e on e.user_id = i.user_id and e.board_id = i.board_id and e.item_key = a->>'id'
left join lateral (
  select string_agg(g.name, ', ' order by g.focus desc, g.name) as names, array_agg(g.id order by g.name) as ids,
         count(*)::int as n, count(g.archived_at)::int as n_arch
    from public.weekly_focus_group_apps m
    join public.weekly_focus_groups g on g.user_id = m.user_id and g.board_id = m.board_id and g.id = m.group_id
   where m.user_id = i.user_id and m.board_id = i.board_id and m.item_key = a->>'id'
) gm on true;
grant select on public.weekly_focus_apps_v to authenticated;
revoke all on public.weekly_focus_apps_v from anon;

-- 4) Functions (for Claude and SQL) ------------------------------------
create or replace function public.wf_ctx(p_board text default null, out uid uuid, out board text)
language plpgsql stable set search_path = public as $$
begin
  select i.user_id, i.board_id into uid, board
    from weekly_focus_inventory i
   where (auth.uid() is null or i.user_id = auth.uid())
     and (p_board is null or i.board_id = p_board)
   order by i.updated_at desc limit 1;
  if uid is null then raise exception 'wf_ctx: no Weekly Focus board found%', coalesce(' named ' || p_board, ''); end if;
end $$;

create or replace function public.wf_group_find(p_group text, p_board text default null)
returns public.weekly_focus_groups
language plpgsql stable set search_path = public as $$
declare c record; g weekly_focus_groups;
begin
  select * into c from wf_ctx(p_board);
  select * into g from weekly_focus_groups
   where user_id = c.uid and board_id = c.board and (id = p_group or lower(name) = lower(trim(p_group)))
   order by (archived_at is null) desc, updated_at desc limit 1;
  if g.id is null then raise exception 'No group "%"', p_group; end if;
  return g;
end $$;

-- Resolve app names or item_keys → item_keys. Unknown names come back with key null.
create or replace function public.wf_app_keys(p_apps text[], p_board text default null)
returns table (asked text, item_key text, app text)
language sql stable set search_path = public as $$
  with c as (select * from wf_ctx(p_board))
  select u.x, a->>'id', a->>'name'
    from unnest(coalesce(p_apps, '{}')) as u(x)
    left join weekly_focus_inventory i on true
    join c on i.user_id = c.uid and i.board_id = c.board
    left join lateral (select a from jsonb_array_elements(i.apps) a where a->>'id' = u.x or lower(a->>'name') = lower(trim(u.x)) limit 1) s on true
$$;

-- Overview: one row per group (+ "(no group)").
create or replace function public.wf_group_list(p_board text default null)
returns table (group_name text, group_id text, focus boolean, archived boolean, apps int, app_names text, note text)
language sql stable set search_path = public as $$
  with c as (select * from wf_ctx(p_board)),
  gs as (select g.* from weekly_focus_groups g join c on g.user_id = c.uid and g.board_id = c.board),
  mem as (select m.group_id, v.app from weekly_focus_group_apps m join c on m.user_id = c.uid and m.board_id = c.board
                 join weekly_focus_apps_v v on v.user_id = m.user_id and v.board_id = m.board_id and v.item_key = m.item_key)
  select gs.name, gs.id, gs.focus, gs.archived_at is not null,
         (select count(*)::int from mem where mem.group_id = gs.id),
         (select coalesce(string_agg(mem.app, ', ' order by mem.app), '') from mem where mem.group_id = gs.id), gs.note
    from gs
  union all
  select '(no group)', null, false, false, count(*)::int, string_agg(v.app, ', ' order by v.app), null
    from weekly_focus_apps_v v join c on v.user_id = c.uid and v.board_id = c.board
   where v.group_count = 0 having count(*) > 0
  order by 4, 3 desc, 1;
$$;

-- Add apps (by name or item_key) to a group. They keep their other groups.
create or replace function public.wf_group_add(p_group text, p_apps text[], p_board text default null)
returns table (app text, result text)
language plpgsql set search_path = public as $$
declare c record; g weekly_focus_groups; r record; n int;
begin
  select * into c from wf_ctx(p_board);
  g := wf_group_find(p_group, c.board);
  for r in select * from wf_app_keys(p_apps, c.board) loop
    if r.item_key is null then app := r.asked; result := 'not found'; return next; continue; end if;
    insert into weekly_focus_group_apps (user_id, board_id, item_key, group_id, updated_at)
    values (c.uid, c.board, r.item_key, g.id, now())
    on conflict (user_id, board_id, item_key, group_id) do nothing;
    get diagnostics n = row_count;
    app := r.app; result := case when n > 0 then 'added' else 'already in' end; return next;
  end loop;
  update weekly_focus_groups set updated_at = now() where user_id = c.uid and board_id = c.board and id = g.id;
end $$;

-- Create a group (or reuse a live one with the same name) and optionally fill it.
create or replace function public.wf_group_create(p_name text, p_apps text[] default '{}', p_note text default null,
                                                  p_focus boolean default false, p_board text default null)
returns text
language plpgsql set search_path = public as $$
declare c record; gid text;
begin
  select * into c from wf_ctx(p_board);
  select id into gid from weekly_focus_groups
   where user_id = c.uid and board_id = c.board and lower(name) = lower(trim(p_name)) and archived_at is null limit 1;
  if gid is null then
    gid := 'g_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into weekly_focus_groups (user_id, board_id, id, name, note, focus, ord)
    values (c.uid, c.board, gid, trim(p_name), p_note, p_focus,
            coalesce((select max(ord) from weekly_focus_groups where user_id = c.uid and board_id = c.board), 0) + 1);
  end if;
  if coalesce(array_length(p_apps, 1), 0) > 0 then perform wf_group_add(gid, p_apps, c.board); end if;
  return gid;
end $$;

-- Take apps out of ONE group (p_group given) or out of EVERY group (p_group null).
create or replace function public.wf_group_remove(p_apps text[], p_group text default null, p_board text default null)
returns int
language plpgsql set search_path = public as $$
declare c record; gid text; n int;
begin
  select * into c from wf_ctx(p_board);
  if p_group is not null then gid := (wf_group_find(p_group, c.board)).id; end if;
  delete from weekly_focus_group_apps m
   using wf_app_keys(p_apps, c.board) k
   where m.user_id = c.uid and m.board_id = c.board and m.item_key = k.item_key and (gid is null or m.group_id = gid);
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.wf_group_archive(p_group text, p_board text default null)
returns text language plpgsql set search_path = public as $$
declare g weekly_focus_groups;
begin
  g := wf_group_find(p_group, p_board);
  update weekly_focus_groups set archived_at = now(), focus = false, updated_at = now() where user_id = g.user_id and board_id = g.board_id and id = g.id;
  return 'archived ' || g.name;
end $$;

create or replace function public.wf_group_restore(p_group text, p_board text default null)
returns text language plpgsql set search_path = public as $$
declare g weekly_focus_groups;
begin
  g := wf_group_find(p_group, p_board);
  update weekly_focus_groups set archived_at = null, updated_at = now() where user_id = g.user_id and board_id = g.board_id and id = g.id;
  return 'restored ' || g.name;
end $$;

create or replace function public.wf_group_focus(p_group text, p_on boolean default true, p_board text default null)
returns text language plpgsql set search_path = public as $$
declare g weekly_focus_groups;
begin
  g := wf_group_find(p_group, p_board);
  update weekly_focus_groups set focus = p_on, updated_at = now() where user_id = g.user_id and board_id = g.board_id and id = g.id;
  return case when p_on then 'focus on ' else 'focus off ' end || g.name;
end $$;

create or replace function public.wf_group_rename(p_group text, p_name text, p_note text default null, p_board text default null)
returns text language plpgsql set search_path = public as $$
declare g weekly_focus_groups;
begin
  g := wf_group_find(p_group, p_board);
  update weekly_focus_groups set name = trim(p_name), note = coalesce(p_note, note), updated_at = now() where user_id = g.user_id and board_id = g.board_id and id = g.id;
  return g.name || ' → ' || trim(p_name);
end $$;

-- Deletes the group; its apps keep their other groups (nothing else is touched).
create or replace function public.wf_group_delete(p_group text, p_board text default null)
returns text language plpgsql set search_path = public as $$
declare g weekly_focus_groups;
begin
  g := wf_group_find(p_group, p_board);
  delete from weekly_focus_groups where user_id = g.user_id and board_id = g.board_id and id = g.id;
  return 'deleted ' || g.name;
end $$;

-- v90 had wf_group_remove(text[], text) with a different meaning; drop it so calls are unambiguous.
drop function if exists public.wf_group_remove(text[], text);

do $$ declare f text; begin
  foreach f in array array['wf_ctx(text)','wf_group_find(text,text)','wf_app_keys(text[],text)','wf_group_list(text)','wf_group_add(text,text[],text)',
    'wf_group_create(text,text[],text,boolean,text)','wf_group_remove(text[],text,text)','wf_group_archive(text,text)',
    'wf_group_restore(text,text)','wf_group_focus(text,boolean,text)','wf_group_rename(text,text,text,text)','wf_group_delete(text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
