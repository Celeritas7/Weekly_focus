# v101 — Sphere (replaces The Five) · local only, not deployed

Built on v100. Copy these four files over `Weekly_focus/`, then reload twice:
- `index.html`
- `js/weekly-focus-app.js`
- `css/weekly-focus.css` (new rules appended at the end)
- `sw.js` (cache → `weekly-focus-v101`)

## What you'll see
- **◎ Sphere** where The Five was. Top row = the five targets (same cards as before: rank, Must/Can, subtasks, tick, ×). Under it, **Also in the sphere** — every other app/topic you pulled in, ordered by rank. No limit.
- **Columns unchanged.** Items in the sphere are outlined; everything else is faint. Hover, tap or open a faint card and it's full strength — fully usable.
- **◎ button** on every card (replaces the ☆ star): tap to pull in / take out.
- **Add to sphere**: the dashed tile opens the picker — tap rows to toggle, no limit.
- **Ranking**: the rank badge on any app — rank 1–5 makes it a target. Dropping a sphere tile or a column card into the top row makes it a target at that slot; the last target slides down to "Also in the sphere".
- × on a target or tile takes it out of the sphere; the next-ranked sphere item moves up into the free slot.

## Data
- Sphere membership is `sph: true` on each item's own row in `weekly_focus_entries` — **not** inside `__board`. A bad board save can't wipe it.
- The Five is still `targetOrder` on `__board` (unchanged), so Today, Print and Claude/SQL readers keep working.
- Your current targets join the sphere the first time you add anything.

## Review fixes (same build)
- "Also in the sphere" tiles drag as items (not targets) — dropping one into the top row now works.
- Ranking via the popover keeps the pushed-out #5 in the sphere.
- Free-slot auto-fill only runs when a slot is actually free.

## Check (console)
```js
({inSphere: document.querySelectorAll('.item.insph').length, faintCols: document.querySelectorAll('.col.sph-on').length, alsoTiles: document.querySelectorAll('.sph-t').length})
```
