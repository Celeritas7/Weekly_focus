-- =====================================================================
--  Weekly Focus — Supabase schema
--  Run this once in your Supabase project:  SQL Editor → New query → paste → Run
-- =====================================================================

-- 1) Inventory: the apps list + study folder-tree. Written by your PC, read by all devices.
create table if not exists inventory (
  board_id   text primary key,
  apps       jsonb default '[]'::jsonb,
  study      jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- 2) Entries: one row per item — which are active, priority, objective, subtasks.
--    Read AND written by both PC and phone (this is the two-way synced part).
create table if not exists entries (
  board_id   text not null,
  item_key   text not null,          -- e.g. 'app:Roadmap' or 'study:LANGUAGES/Japanese/Kanji'
  payload    jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  primary key (board_id, item_key)
);

-- 3) Row Level Security.
alter table inventory enable row level security;
alter table entries   enable row level security;

-- Personal, single-user setup: allow the public "anon" key full access.
-- Your data is namespaced by board_id; pick an unguessable board name.
-- (The anon key is meant to be public and is safe to ship in the page. If you later
--  want hard isolation, switch these policies to use Supabase Auth + auth.uid().)
drop policy if exists "anon all inventory" on inventory;
drop policy if exists "anon all entries"   on entries;
create policy "anon all inventory" on inventory for all to anon using (true) with check (true);
create policy "anon all entries"   on entries   for all to anon using (true) with check (true);
