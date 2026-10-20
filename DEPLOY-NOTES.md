# v107 — Sphere Draft · built on v106 (v106 was never deployed, so this upload carries both)

Upload these five files, then reload twice on every device:
- `index.html` (loads the two new files)
- `js/weekly-focus-app.js` (v106 changes + the Sphere Draft hook)
- `js/wf-sphere-draft.js` (new)
- `css/wf-sphere-draft.css` (new)
- `sw.js` (cache → `weekly-focus-v107`, caches the new files for offline)

**No SQL ships with this build.** The history function `wf_keep_history()` is owned by the repo (`migrations/`). Never paste SQL that redefines it.

## What changed
**+ Add to sphere** (the empty slot in The Five, and the tile under "Also in the sphere") now opens the **Sphere Draft**: every active app, study topic and office task on one table, grouped by category; tap to pull one in, drag onto a number to rank it, onto the ring for orbit; week-load meter; Auto-fill; Undo. A picked card leaves the table. Moves go through the existing sphere functions, so storage and sync are unchanged. If `wf-sphere-draft.js` is missing, the old list opens instead.

## Check after upload
1. Footer reads **build v107 · opens offline · sphere draft**.
2. Tap **+ Add to sphere** → the draft opens. Tap 2 cards → they become targets #1 and #2 on the board behind it (close with **Done** or **Esc** to see).
3. Fill The Five, tap a 6th → it shows under "Also in the sphere" on the board.
4. On a second device, the same Five appear after sync.
5. Then run the v106 checks below (they were never run on a deployed build).

---

# v106 — empty-read guard · local only, not deployed

Built on v105 (live 18 Oct). Upload only these two files, then reload twice on every device:
- `js/weekly-focus-app.js`
- `sw.js` (cache → `weekly-focus-v106`)

`js/wf-login.js`, `index.html` and the CSS are unchanged from v105.

**No SQL ships with this build.** The history function `wf_keep_history()` is owned by the repo (`migrations/`). Never paste SQL that redefines it.

## Why
v105 test, 18 Oct: offline with 3 unsent changes → back online → pill showed **⚠ 99 not synced**, the sphere briefly emptied, then **Syncing 31…** → **Synced**. The first read after reconnecting most likely went out before the sign-in had refreshed. A read without a valid sign-in gets **no rows and no error** (row-level security), and v105 treated that as a new, empty board: it re-uploaded every row from this device's copy and merged the unsent app-list edit against an empty list. The copy was minutes old, so the result matched the cloud. With a days-old copy it would have overwritten newer edits from other devices.

## What changed
1. **An empty answer for a known board is never trusted.** If this device has seen the board before (local copy or an earlier pull) and the cloud answers with no rows, nothing is uploaded, nothing is merged, the sign-in is refreshed, and the next pull decides. A toast says so at most once a minute. The old "empty cloud + data here → seed the cloud" path is gone. That also closes the v105 limit where a board deleted on one device could be revived by another.
2. **A fresh token before every read.** Before the first sync, the 15-second poll, tab return and coming back online, the session is refreshed if it expires within a minute.
3. **Update bar, for real.** v105 devices will show **Update** for this build. That is test 7 from v105.

## Check after upload
1. Footer reads **build v106 · opens offline · empty-read guard**. A v105 device shows the Update bar first.
2. Repeat the v105 sequence: online reload → DevTools **Offline** → reload → add a Vault record + an app card → reload → **No throttling**. The pill should go **☁ Offline · 3 → ☁ Syncing 3… → ☁ Synced**. No 99, the sphere never empties.
3. Console: no `[wf] v106: the cloud answered an empty …` line. If you do see one, the guard worked. Send me the lines around it.

## Read-only probe (Claude Code, optional)
Confirms what v105 wrote at ~10:30 UTC on 18 Oct. Read-only, nothing changes:
```sql
select item_key, saved_at from weekly_focus_history where saved_at > '2026-10-18 09:30+00' order by saved_at desc limit 120;
```
Many `app:` / `study:` rows within one second = the re-upload. Since the copy was fresh, each should match its previous snapshot.
