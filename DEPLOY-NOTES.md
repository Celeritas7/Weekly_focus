# v91 — Focus groups (replaces v89 Triage) · includes v88d

## v91 (26 Sep) — apps in several groups
- An app can now be in more than one group. In Focus view it shows under each; its chip reads "⇄ 2 groups".
- Archiving hides an app only when every group it is in is archived.
- Chip popover and Assign window toggle membership per group; "No group" leaves all of them. The Assign list shows an app's other groups on the right.
- **Re-run `docs/focus-groups.sql`** — it migrates the membership table's key and updates the view and functions. Existing groups and memberships are kept.
- `wf_group_remove(apps, group)` now takes an optional group; without it, the app leaves every group.
- Cache: `weekly-focus-v91`.

## v90b — Remove all shown · v90a — Assign window

## Install
1. **Supabase → SQL Editor:** run `docs/focus-groups.sql`. It's safe to run again.
2. Optional: run `docs/focus-groups-seed.sql` to create three starter groups: Akatsuki links (in focus), Language study, and Commonplace & coding.
3. Copy these into `Weekly_focus/`, overwriting: `index.html`, `css/weekly-focus.css`, `js/weekly-focus-app.js`, `sw.js` (cache `weekly-focus-v90`), and `docs/`.

## Removed
Everything from v89 Triage: the button, the sheet, the Active/Later/Parked tiers, the Parked row and the tier-only ranking. Any `tier` values already saved on items are ignored.

## What you'll see (Week tab)
- The View switch gains a third option: **Flat · Groups · Focus**.
- **Focus view:** the Apps column is split into your groups.
  - Starred groups come first, marked FOCUS. Then the other groups, then "No group".
  - Each group header has a collapse caret, a count, ★ (focus), ✎ (rename) and **Archive**.
  - Each app card has a small group chip. Tap it to move the app to another group, to "No group", or to "+ New group…".
  - **+ New group** sits under the list.
- **Archived groups** row at the bottom of Apps, in every view: "Archived groups · 2 · 9 apps hidden". Open it to **Restore** or delete (×) a group.
- Archiving hides the group's apps from Week, Today, the Build band and The Five. Their data isn't touched.

## Claude
Claude manages groups through the `wf_group_*` functions. See `docs/FOCUS-GROUPS.md`, which includes the rules for Claude and example requests. WF picks up changes on its 15 s poll.

## Notes
- If the SQL hasn't been run, groups still work on this device (cached locally), and the console warns once. Pending writes wait in the outbox until the tables exist.
- Restore doesn't put apps back into The Five. Star them again.
