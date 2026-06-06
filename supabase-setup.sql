-- =====================================================================
--  Weekly Focus — Supabase schema (secure: RLS + Supabase Auth)
--  Run this once:  Supabase → SQL Editor → New query → paste → Run
--
--  Security model
--  --------------
--  • The page ships only the PUBLISHABLE key (sb_publishable_…). That key is
--    public by design; its safety comes ENTIRELY from the policies below.
--  • Every row is owned by a logged-in account (user_id = auth.uid()).
--  • A stranger who reads the publishable key out of the page source and is NOT
--    signed in as you gets nothing: RLS is default-deny and anon is granted no
--    privileges. Signed in as you, they only ever see your own rows.
--  • board_id is just a label for "which week" — NOT a security boundary.
--    Two accounts can both use 'my-week' without colliding (user_id is in the PK).
--
--  NEVER put a service_role / secret key (sb_secret_…) in the client. This app
--  has no server, so it never needs one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------

-- Board metadata: the apps list + study folder-tree pushed from your PC.
-- One row per (account, board).
create table if not exists public.inventory (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id   text        not null,
  apps       jsonb       not null default '[]'::jsonb,
  study      jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

-- Items: one row per curated item (active / priority / objective / subtasks).
-- Read AND written by every device — this is the two-way synced part.
create table if not exists public.entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  board_id   text        not null,
  item_key   text        not null,   -- e.g. 'app:Roadmap' or 'study:LANGUAGES/Japanese/Kanji'
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_id, item_key)
);

-- ---------------------------------------------------------------------
-- 2) Row Level Security — enable, then default-deny until a policy allows.
-- ---------------------------------------------------------------------
alter table public.inventory enable row level security;
alter table public.entries   enable row level security;

-- ---------------------------------------------------------------------
-- 3) Policies — authenticated users may touch only their own rows.
--    Separate policy per command so each grant is explicit.
-- ---------------------------------------------------------------------

-- inventory
drop policy if exists "inventory_select_own" on public.inventory;
drop policy if exists "inventory_insert_own" on public.inventory;
drop policy if exists "inventory_update_own" on public.inventory;
drop policy if exists "inventory_delete_own" on public.inventory;

create policy "inventory_select_own" on public.inventory
  for select to authenticated using (auth.uid() = user_id);
create policy "inventory_insert_own" on public.inventory
  for insert to authenticated with check (auth.uid() = user_id);
create policy "inventory_update_own" on public.inventory
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "inventory_delete_own" on public.inventory
  for delete to authenticated using (auth.uid() = user_id);

-- entries
drop policy if exists "entries_select_own" on public.entries;
drop policy if exists "entries_insert_own" on public.entries;
drop policy if exists "entries_update_own" on public.entries;
drop policy if exists "entries_delete_own" on public.entries;

create policy "entries_select_own" on public.entries
  for select to authenticated using (auth.uid() = user_id);
create policy "entries_insert_own" on public.entries
  for insert to authenticated with check (auth.uid() = user_id);
create policy "entries_update_own" on public.entries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "entries_delete_own" on public.entries
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4) Grants — the authenticated role needs table privileges; anon gets none.
--    (RLS still filters every row to auth.uid(); grants just open the door.)
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.inventory to authenticated;
grant select, insert, update, delete on public.entries   to authenticated;

-- Belt-and-suspenders: make sure the public/anon role can touch nothing.
revoke all on public.inventory from anon;
revoke all on public.entries   from anon;
