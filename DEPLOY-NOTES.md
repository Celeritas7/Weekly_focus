# v102 — data guards + daily export + history trigger + Label group headers · local only, not deployed

Built on v101. Copy over `Weekly_focus/`, then reload twice:
- `index.html` (adds **Export board** to the Cloud panel)
- `js/weekly-focus-app.js`
- `css/weekly-focus.css` (v102 rules appended at the end)
- `sw.js` (cache → `weekly-focus-v102`)

Database: no SQL ships with this build. The history trigger (`wf_keep_history()`) is owned by `migrations/` — see `migrations/README.md`. Do not paste history SQL from older builds.

## Protection
1. **Shrink guard** — a save that would empty the Vault, Chats, Wishlist, Places, Routines or Dev links while the cloud copy still has items is blocked: the cloud copy is put back and a toast says so. Same for Timeline notes, Inbox and the app / study list.
   Deliberately clearing one of those for real: in the console run `__wfAllowEmpty = true`, do it, then reload.
2. **Push guard** — Timeline and Inbox edits made before the first sync are held and merged on top of the real list (not pushed over it). App-list edits before the first sync are not saved (toast asks you to redo).
3. **Daily export** — on desktop, the first sync of each day saves `weekly-focus-my_week-YYYY-MM-DD.json` to Downloads. Skipped if the board is empty. **Export board** in the Cloud panel does it any time.
4. **History trigger (SQL)** — every overwrite of `__board`, `__timeline`, `__inbox` and the inventory row keeps the previous copy for 30 days (at most one per 10 min per row, but any save that shrinks a row by >10 % is always kept). Restore query is at the bottom of the SQL file.

## v102.1 — daily backup is per device
Cloud panel → **Daily backup on this device** checkbox. Stored in this browser only (localStorage), so each device decides for itself. **Off by default on every device** — tick it on the device(s) you want. Export board stays available on every device.
Files changed: `index.html`, `js/weekly-focus-app.js`, `sw.js` (cache → `weekly-focus-v102-1`).

## Look
- Group headers are now a plain label: colour dot · name · "N in sphere" · + Apps, on a hairline. ★ ✎ Archive appear on hover (always shown on touch when the group is open).
- Groups with nothing in the sphere auto-collapse to one dashed line; tap to open for this session.
- Sphere apps come first inside each group.
- App cards are white; priority stays as the coloured left edge.

## Check
- Cloud panel shows **Export board**; clicking it downloads a .json.
- Console: `({sph: document.querySelectorAll('.fg-sph').length, collapsed: document.querySelectorAll('.fg-head.coll').length})`
- SQL block 4 lists rows after an edit.
