# Request to Akatsuki — one shared place for every app's logo

From: Weekly Focus (WF), via its Claude Code session. Date: 2026-10-21.
Status: request. Nothing has been built or changed on the hub side.

## What we want

A single place, owned by Akatsuki, where **every app's logo** is stored and kept up to date, so any app (WF first, then the hub dashboard, Cost and others) can show the same logo for the same app.

WF's immediate use: the Sphere Draft (the game-style "Add to sphere" view) and the sphere planets show app logos instead of two-letter monograms. Apps with no logo show their name.

## Facts (checked read-only on 2026-10-21)

- WF has **69 apps** on its board (`weekly_focus_inventory.apps`). **40** have quick links; **31** link to their live GitHub Pages site, `https://celeritas7.github.io/<Repo>/` (Astrocyte, Axon, Burmese_study_app_advanced, Calender_app, Cerebrum, Chatak, Code_sensei, Commonplace, Coordinate_support, Cost_management, Dojo, Food_department_advanced, HealthLog, Holdings, Japanese_study_app_advanced, kata-kita, KG_chart_new, Roadmap_advanced, ScreenToll, Scriptura_app, Sift, Sukkiri, Tapal, Weekly_focus, writing_test, and others).
- These apps already have logos in their repos, served from the live site. WF declares its own the standard way: `<link rel="apple-touch-icon" href="icons/icon-180.png">`, `<link rel="icon" href="icons/icon-192.png">`, and `icons` in `manifest.webmanifest`. Most apps were built the same way, though I could not verify the other sites from my sandbox (github.io is blocked there).
- `akatsuki_apps` has **13 rows** and no column for a site address or a logo. WF's 69 apps are mostly not in it, and WF's card ids (`app:…`) are not Akatsuki ids.
- No logo or icon field exists anywhere in WF's data today.

## Proposed design (Akatsuki decides the details)

### 1. Storage
- A Supabase Storage bucket, `akatsuki_logos` (or the nearest name Storage allows).
- Object path: `<user_id>/<app_key>/<hash>.png`. The content hash in the name makes every update a new URL, so browsers never show a stale logo and old URLs can be cached forever.
- Image: square PNG or WebP, 128 px and optionally 256 px, under 50 KB. Uploaders resize before upload.
- **Read: public.** Logos aren't secret, a public URL works in `<img>` without signed-URL expiry, and service workers can cache it for offline use. **Write:** only the signed-in owner, by storage policy on the `<user_id>/` folder.

### 2. Registry table
`akatsuki_app_identity` (one row per app per user). Suggested columns:

| column | meaning |
|---|---|
| `user_id` | owner, RLS `user_id = auth.uid()` |
| `app_key` | stable slug. For hosted apps the Pages repo name, lower-cased (`kg_chart_new`); otherwise a slug of the name |
| `name` | display name |
| `home_url` | live site, e.g. `https://celeritas7.github.io/KG_chart_new/` |
| `logo_path` | object path in the bucket, null if none |
| `logo_source` | `site` (taken from the app's own site), `upload` (set by hand) or `emoji` |
| `emoji` | when `logo_source = 'emoji'` |
| `akatsuki_app_id` | optional link to `akatsuki_apps.id` for the 13 registered apps |
| `updated_at`, `updated_by` | which app or process last wrote it |

Unique on `(user_id, app_key)`. Apps read it through a view with `security_invoker = on`, per the hub's rules.

### 3. Keeping logos up to date: "the repo is the source"
An Edge Function, e.g. `akatsuki-logo-sync`, run daily and on demand:
1. For each row with a `home_url`, fetch the page and read its `apple-touch-icon` / `icon` link, or the largest `manifest` icon ≤ 512 px.
2. If the image's hash differs from the stored one, resize, upload the new object and update `logo_path`.
3. Never overwrite a row whose `logo_source` is `upload` or `emoji`. Those are the user's choice.

So changing a logo in an app's repo shows up everywhere the next day, with no manual step. This runs server-side, so no app has to fetch other apps' sites.

### 4. Writing: who may publish what
Following "an owner declared per shared path before the first write":
- **Each app may publish its own row** (name, home_url, and its own logo if it wants), e.g. on deploy or first load. Owner: that app, for its own `app_key`.
- **WF may create rows for apps that never self-publish** and set `upload`/`emoji` logos the user picks in WF. WF is where the user curates the full app list.
- Proposed write path: one RPC, `akatsuki_app_identity_upsert(app_key, name, home_url, logo_source, emoji)`, plus the storage upload. Akatsuki may prefer its `akatsuki_publish` stream instead; either works for WF.

### 5. Seeding
- Create rows for WF's 69 apps from `weekly_focus_inventory.apps` (name, plus `home_url` where a github.io link exists). Or let WF publish them on first run, whichever the hub prefers.
- Run the sync once, so the ~31 hosted apps get their logos straight away.

## What WF will do once this exists
1. Read the identity view on load and cache it.
2. Match each card to an `app_key`, using its github.io link first, then a key stored on the card once matched.
3. Show the logo on planets and cards; otherwise the name.
4. Offer "Set logo" (upload or emoji) for apps without one, written through the agreed path.
5. Until this exists, WF falls back to reading logos from live sites itself.

## Akatsuki's own logo

- Akatsuki registers **itself** in the identity table (`app_key = 'akatsuki'`, its live site as `home_url`), so the sync stores its logo like any other app's.
- WF shows Akatsuki at the **core of its sphere** (v108). Once the store exists, the core shows Akatsuki's logo inside the red moon.
- Each app keeps its **own** favicon and home-screen icon in its own repo. The repo is the source the sync copies from, and an app must still open offline. The store is for showing **other** apps' logos.

## Decisions for Akatsuki
1. Bucket name, path layout and public read: OK?
2. New `akatsuki_app_identity` table, or columns on `akatsuki_apps` (which would then need all 69 apps)?
3. Write path: dedicated RPC or `akatsuki_publish`?
4. Ownership: may WF create rows for apps that never self-publish?
5. Sync: daily Edge Function OK? Anything that must never be fetched?

Please reply with the decisions and the names you chose (bucket, table/view, RPC). WF will build its side against them.
