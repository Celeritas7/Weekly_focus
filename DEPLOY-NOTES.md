# v117 — Set logo · built on v116

Upload these five files, then reload twice on every device:
- `js/wf-logos.js`
- `js/wf-sphere-draft.js`
- `css/wf-sphere-draft.css`
- `js/weekly-focus-app.js` (the logo hook for the draft, build number, footer)
- `sw.js` (cache → `weekly-focus-v117`)

**No SQL ships with this build.** It writes through Akatsuki's R038 store: bucket `akatsuki-logos` and RPC `akatsuki_app_identity_upsert`.

## What changed
1. **Set logo.** Tap any app bubble or planet in the Sphere Draft. The details window has a **Logo** section:
   - **Upload image:** any image the browser can read (PNG, JPEG, WebP, GIF, SVG). WF turns it into one square 256 px PNG or WebP under 64 KB, names it by its hash and stores it in Akatsuki's store. Every app that reads the store shows it.
   - **Use an emoji:** one emoji instead of an image.
   - **Use the site's icon:** only for apps with a live site that currently use an upload or emoji. It goes back to the site's icon and asks the sync to fetch it.
   - A line says where the current logo comes from, or why the store has none (no PNG icon on the site, icon file missing, page too big).
   Study and office items have no Logo section.
2. **Names behind logos stay hidden.** Long names (ScreenToll, Astrocyte, Calender_app…) showed clipped text under the logo, because the "hide" class was never applied to names with a size class.
3. **Long names fit their circle.** Names wrap after `_` or `-`, and each one is measured and shrunk until it fits. A word breaks mid-way only if it still doesn't fit at the smallest size.

## Check after upload
1. Footer reads **build v117 · opens offline · set logo**.
2. Tap Hypnos → Upload image → pick any picture → "Logo saved". The bubble shows it, and so do your other devices after a reload.
3. Command_centre_advanced and "Commonplace - C++" sit inside their circles.

---

# v116 — logo registration fix · built on v115

Upload these three files, then reload twice on every device:
- `js/wf-logos.js`
- `js/weekly-focus-app.js` (build number only)
- `sw.js` (cache → `weekly-focus-v116`)

**No SQL ships with this build.**

## What changed
When two cards map to the same app in the logo store, WF now registers the one that links to the live site. Before, the first card won, so "Food_department_advanced" (no links) hid the address of "Food department". On the next load WF updates that row and asks the sync for its logo.

## Known issue (hub side, reported to Akatsuki)
The `akatsuki-logo-sync` function rejects the browser's CORS preflight (OPTIONS → 405), so WF's call to it is blocked. Akatsuki's daily sync and its one full sync still fill the logos. Until then WF shows icons from the live sites.

## Check after upload
1. Footer reads **build v116 · opens offline · shared logos**.

---

# v115 — shared logos live (Akatsuki R038) · built on v114

Upload these three files, then reload twice on every device:
- `js/wf-logos.js`
- `js/weekly-focus-app.js` (build number and footer only)
- `sw.js` (cache → `weekly-focus-v115`)

**No SQL ships with this build.** The logo store (bucket `akatsuki-logos`, view `akatsuki_app_logos`, RPC `akatsuki_app_identity_upsert`, edge function `akatsuki-logo-sync`) was built and applied by Akatsuki as hub migration R038.

## What changed
- The logo sync accepts at most 40 apps per call. WF now sends the apps it registers in calls of 40.
- Nothing else: v109 was already built against R038's names. On the first signed-in load WF registers every app in the store, asks the sync to copy the hosted apps' icons, and shows them.

## Notes
- An app's site icon is stored only if it is a square PNG or WebP of 64 KB or less. Otherwise the store has no logo for it and WF keeps reading the icon from the live site.
- All "Commonplace …" cards link into the one Commonplace site, so they share its logo. "KG chart" and "Mechanical - GD&T" both link to KG_chart_new and share that logo too.

## Check after upload
1. Footer reads **build v115 · opens offline · shared logos**.
2. Open WF once while signed in, then wait a minute and reload: planets and bubbles show logos, and the red core shows Akatsuki's.

---

# v114 — compact filters on phones · built on v113

Upload these four files, then reload twice on every device:
- `js/weekly-focus-app.js` (build number only)
- `js/wf-sphere-draft.js`
- `css/wf-sphere-draft.css`
- `sw.js` (cache → `weekly-focus-v114`)

**No SQL ships with this build.**

## What changed (phones only, 600 px wide or less; desktop unchanged)
In the Sphere Draft the block between the sphere and the bubbles is one row: **All / Apps / Study / Office** plus a 🔍 button. Search, **By category** and the sort open when you tap 🔍 (the cursor goes to search); tap again to fold them away. A dot on 🔍 shows while a search, the flat list or a non-default sort is in effect. The priority legend is one short line. About 70 px instead of about 200 px.

## Check after upload
1. Footer reads **build v114 · opens offline · compact filters**.
2. Phone: the bubbles start right under the type row. Tap 🔍 → search, group, sort appear.

---

# v113 — review fixes · built on v112

Upload these three files, then reload twice on every device:
- `js/weekly-focus-app.js`
- `js/wf-logos.js`
- `sw.js` (cache → `weekly-focus-v113`)

Everything else is unchanged from v112. **No SQL ships with this build.**

## What changed (a review of v107–v112, nothing new to use)
1. **Service worker:** pages and icons of the *other* apps on celeritas7.github.io are no longer cached by Weekly Focus. The logo fallback reads them, and the old rule cached them for good, so a changed logo on a sibling site would not have shown until the next Weekly Focus deploy.
2. **Logo store:** a failed read of Akatsuki's store (network error) is retried after a minute, not on every redraw.
3. **Today · Build:** "Will · next in line" only ever shows an orbit app; with an empty orbit it is hidden instead of showing an app outside the sphere.
4. The Akatsuki lookup is cached per app-list change (it ran inside every rank sort).

## Check after upload
1. Footer reads **build v113 · opens offline · review fixes**.
2. Today tab with nothing in orbit: no "Will" row.

---

# v112 — Akatsuki always at the centre · built on v111

Upload these four files, then reload twice on every device:
- `js/weekly-focus-app.js` (build number only)
- `js/wf-sphere-draft.js`
- `css/wf-sphere-draft.css`
- `sw.js` (cache → `weekly-focus-v112`)

**No SQL ships with this build.**

## What changed
In the Sphere Draft, Akatsuki now stays at the centre all the time. While it has open tasks it is the bright red moon (open count + next task); with none it is **dimmed** and reads **All clear**. Tap it either way to open the Akatsuki card. The Five count stays in the header (The Five n/5). The red core bar on Today and Week still shows only while Akatsuki has open tasks.

## Check after upload
1. Footer reads **build v112 · opens offline · core always shown**.
2. Tick off all Akatsuki subtasks → the draft's centre stays, dimmed, "All clear". Add one → bright red again.

---

# v111 — an emptied slot stays empty · built on v110

Upload these two files, then reload twice on every device:
- `js/weekly-focus-app.js`
- `sw.js` (cache → `weekly-focus-v111`)

Everything else is unchanged from v110. **No SQL ships with this build.**

## What changed
- Taking an app out of the Five (send back, ◎, ×, drag to orbit) **leaves its slot empty**. Nothing moves up from orbit by itself any more; you fill the slot when you choose. The Five stay in order, so the free slot is the last one.
- **Ranks**: the Five are 1–5 with gaps allowed; orbit apps follow from 6; apps outside the sphere come after them. An app outside the Five never shows a target rank.
- **Rank picker**: ranking an app 1–5 puts it in the Five at that place (a full Five drops its last app to orbit); it never pulls other apps in. Ranking a target 6+ takes it out and leaves the slot empty.
- **Today · Build**: Must / Can show only real targets; **Will · next in line** is the first orbit app.

## Check after upload
1. Footer reads **build v111 · opens offline · slots stay empty**.
2. Send a target back → the Five show 4 and an empty slot; orbit is unchanged.
3. Rank an orbit app #2 → it lands at #2; nothing else joins the Five.

---

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
