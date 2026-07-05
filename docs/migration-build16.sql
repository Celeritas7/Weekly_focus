-- Weekly Focus — build 16 migration
-- Run this ONCE in Supabase → SQL editor BEFORE deploying build 16.
--
-- Adds the Office pool to each board's inventory. Office tasks sync the same
-- way apps/study already do (weekly-focus-app.js reads & writes this column
-- alongside apps/study on weekly_focus_inventory). Routines and scheduled
-- tasks need NO schema change — they ride inside weekly_focus_entries.payload
-- and the board meta row, which are already jsonb.
--
-- Safe to re-run: `if not exists` makes it idempotent.

alter table public.weekly_focus_inventory
  add column if not exists office jsonb not null default '[]'::jsonb;
