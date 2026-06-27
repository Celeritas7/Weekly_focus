# Weekly Focus — deploy the redesigned app

This is a drop-in replacement for your existing app. **No database changes** — it
reuses your `weekly_focus_inventory` / `weekly_focus_entries` tables and the same
`item_key` format (`app:Name`, `study:DOMAIN/.../Topic`), so your synced data stays.

## Files to ship (all in the same folder, e.g. your GitHub Pages repo root)
```
index.html            ← the redesigned app (was "Weekly Focus.html")
weekly-focus.css
weekly-focus-app.js
sw.js                 ← cache list updated + bumped to weekly-focus-v4
manifest.webmanifest
icon-180.png  icon-192.png  icon-512.png
supabase-setup.sql    ← already run once; keep for reference
```

## Steps
1. Copy the files above into your repo (overwrite the old `index.html`, `sw.js`,
   `weekly-focus.css`, `weekly-focus-app.js`).
2. Commit & push. GitHub Pages serves it.
3. On each device: open the site → **Cloud** button → paste your Project URL +
   publishable key + the **same board name** → **Save connection** → send yourself
   a magic link and open it on that device. The pill shows **☁ Synced**.
4. Connect your data once per setup via the **Data** button (live file-connect on
   Chrome/Edge, or paste). Inventory is pushed to the cloud and pulled on your
   other devices automatically.

## What syncs
- **Inventory** (apps list + study tree) → pushed from whichever device loads it.
- **Per-item entries** (active / priority / objective / subtasks / notes) → two-way.
- **The Five** (target order) and **week + End-of-Week notes** → ride on a synthetic
  `__board` entry, so no schema change.

## Notes
- Cloud is **off until you connect** — until then it's a local-only PWA (works offline,
  installable). Nothing breaks if you never set up Supabase.
- Only ever paste the **publishable** key (`sb_publishable_…`). The app refuses a
  secret / service_role key. Security comes from RLS scoping every row to your account.
- Bump `CACHE` in `sw.js` on every future deploy so phones pick up the new build.
