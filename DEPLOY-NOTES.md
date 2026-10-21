# v110 — sphere bubbles · built on v109

Upload these four files, then reload twice on every device:
- `js/weekly-focus-app.js`
- `js/wf-sphere-draft.js`
- `css/wf-sphere-draft.css`
- `sw.js` (cache → `weekly-focus-v110`)

`index.html` and `js/wf-logos.js` are unchanged from v109. **No SQL ships with this build.**

## What changed (Sphere Draft)
- The table is **just bubbles**: logo (or the name) inside, the ring colour is the priority (red High, amber Medium, green Low), grouped by category. A legend sits under the filters.
- **Tap a bubble** → a details window (bottom sheet on a phone): name, category, priority, progress, last touched, every open task, notes. One big button **Add as #n** (or **Add to orbit** when the Five are full), plus **1–5 / Orbit** to place it exactly, and **Open the full card to edit**.
- **Tap a planet** in the sphere → the same window with **Send back to the table** and **Move it to 1–5 / Orbit**.
- **Esc** closes the window first, then the draft. Dragging and the 1–5 / O keys still work.

## Check after upload
1. Footer reads **build v110 · opens offline · sphere bubbles**.
2. **+ Add to sphere** → bubbles only. Tap one → its tasks and notes are readable; **Add as #1** puts it in the sphere and closes the window.
3. Tap a planet → **Send back to the table** returns it.

---

# v109 — app logos · built on v108

Upload these six files, then reload twice on every device:
- `index.html` (loads `js/wf-logos.js`)
- `js/wf-logos.js` (new)
- `js/weekly-focus-app.js`
- `js/wf-sphere-draft.js`
- `css/wf-sphere-draft.css`
- `sw.js` (cache → `weekly-focus-v109`)

**No SQL ships with this build.** The logo store is Akatsuki's (hub migration **R038**); WF only reads it and seeds it through Akatsuki's RPC.

## What changed
- Planets in the Sphere Draft show the app's **logo**; an app without one shows its **name** inside the planet (no label underneath, so the sphere is more compact). Orbit planets: logo or a short name. Cards on the table get a small logo. The Akatsuki core shows its logo in the red moon and in the core bar.
- **Where logos come from**, in order: Akatsuki's shared store (`akatsuki_app_logos`: uploaded, emoji or synced from the app's site) → the app's own GitHub Pages site (home-screen icon, else the largest manifest icon ≤ 512 px, else its browser icon), remembered on this device for a week → no logo.
- **Until R038 is live**, the store isn't there and WF quietly uses the live sites. No errors, nothing to do.
- **Once R038 is live**, WF sends each app (name + live link) to Akatsuki once, using Akatsuki's key rule (Pages repo name, or a slug of the name), then only apps that are new or renamed. New hosted apps trigger Akatsuki's logo sync.

## Check after upload
1. Footer reads **build v109 · opens offline · app logos**.
2. Open **+ Add to sphere**: apps with a github.io link in Quick links show their logo within a few seconds; others show their name.
3. After R038 lands: reload once; Akatsuki's `akatsuki_app_identity` gets one row per app; a day later (or after the sync runs) the hosted apps' logos come from the store.

---

# v108 — Akatsuki is the core of the sphere · built on v107

Upload these four files, then reload twice on every device:
- `js/weekly-focus-app.js`
- `js/wf-sphere-draft.js`
- `css/wf-sphere-draft.css`
- `sw.js` (cache → `weekly-focus-v108`)

`index.html` is unchanged from v107. **No SQL ships with this build.** `wf_keep_history()` is owned by `migrations/`.

## What changed
The app card named **Akatsuki** is the core of the sphere: always in it, never one of the Five, never in orbit, never on the Sphere Draft's table, and it has no rank.
- While Akatsuki has **open subtasks**, a red **Core · Akatsuki** bar shows on **Today** (above Build) and on the **Week** tab (above the Five), with the next task and the open count. Tap it to open the Akatsuki card. With no open subtasks the bar is hidden.
- In the **Sphere Draft**, the centre becomes Akatsuki's red moon while it has open subtasks; tap it to open the card. Otherwise the centre shows the n/5 count.
- If Akatsuki was one of the Five, it leaves its slot on first load and the next sphere item moves up.
- Its ◎ button and the rank picker say it is the core and change nothing.

## Check after upload
1. Footer reads **build v108 · opens offline · Akatsuki core**.
2. Akatsuki is no longer in the Five; the Five are refilled.
3. Add a subtask to Akatsuki → the red bar appears on Today and Week. Tick it done → the bar disappears.
4. Open **+ Add to sphere** → the red moon is in the centre; Akatsuki is not on the table.

---

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
