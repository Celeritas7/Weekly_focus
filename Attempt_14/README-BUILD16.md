# Weekly Focus — build 16 (modes + screens)

## What's new
- **Bottom tabs**: Today / Calendar / Routines / Week. Week is the old board, untouched (Pulse, The Five, Special, pools, End of Week, Print).
- **Personal ⇄ Office mode** pill in the header. Filters Today, Calendar and Routines; the accent colour shifts (purple ⇄ amber). Per-device — your phone can sit in Office mode while your PC stays Personal. Keyboard: Tab to the pill, ←/→ to switch.
- **Office pool**: a third column on the Week tab. Office items sync like apps/study (needs the migration below).
- **Today screen**: date, live weather (Open-Meteo) + train cards (timetable + ODPT delays, shared with Command Centre via `info-feeds.js`), and Top Tasks = your mode's Five targets + anything scheduled for today.
- **Calendar screen**: week strip (Month expands), tap a day, schedule any pool item onto it. Scheduled tasks sync as normal entries.
- **Routines screen**: per-day schedules (e.g. gym M/W/F), streaks, quick links, add/edit in-app. Definitions sync via the board row.
- **Quick links** on any pool item: edit in the item's detail (Week tab), one per line as `Label | https://url`. They show as tap chips on Today/Calendar rows.

## Deploy (same as always, ONE extra step first)
1. **Run `docs/migration-build16.sql`** in Supabase → SQL editor. One `alter table` — do this BEFORE pushing the build. (The full schema, for a fresh board, lives in `docs/supabase-setup.sql`.)
2. Copy these files over the ones in your repo (same flat layout):
   `index.html`, `weekly-focus-app.js`, `weekly-focus.css`, `home-screens.css` (new), `info-feeds.js` (new), `sw.js`
   (`config.js`, manifest and icons are unchanged — included here for completeness.)
3. Commit + push. The service worker cache is bumped to v20, so devices pick up the new build on next load; add to Home Screen users may need one app restart.

## Notes
- Print always prints the Week sheet, whatever tab is open.
- Drag-reorder inside the new Office column isn't wired yet (toggle/priority/detail all work); say the word and I'll add it in build 17.
- The train card uses the Sōbu/Monorail weekday timetables + ODPT live status lifted from Command Centre. Edit the arrays at the top of `info-feeds.js` if your commute changes.
