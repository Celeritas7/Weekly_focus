# Weekly Focus — Cloud setup

Put the planner online and sync it privately between your PC and phone. Sync uses
**Supabase Auth (email magic link) + Row Level Security**, so your week is locked
to your account — anyone who reads the key out of the page gets nothing without
signing in as you.

```
├─ index.html              ← the planner (host this)
├─ manifest.webmanifest    ← makes it installable on your phone
├─ sw.js                   ← offline support (works on the train)
├─ icon-180/192/512.png    ← app icons
└─ supabase-setup.sql      ← run once in Supabase
```

> **Key safety.** The page only ever holds the **publishable** key
> (`sb_publishable_…`). That key is public by design — its safety comes entirely
> from RLS. **Never** put a **secret / `service_role`** key (`sb_secret_…`) in the
> page, in config, or in any helper script. This app has no server, so it never
> needs one. (The app refuses a secret key if you paste one by mistake.)

Do the four steps once, in order. ~15 minutes total.

---

## 1 · Supabase (database + auth)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste all of **`supabase-setup.sql`** and click **Run**. This creates two tables
   (`weekly_focus_inventory`, `weekly_focus_entries`), enables RLS, and adds `auth.uid()`-scoped policies so
   every row belongs to the account that created it.
3. **Project Settings → API** — copy two things for later:
   - **Project URL** — `https://xxxx.supabase.co`
   - **Publishable key** — the one starting `sb_publishable_…`. *Safe to put in the page.*
   - Do **not** copy the secret / `service_role` key. You never need it here.
4. **Authentication → Providers → Email** — make sure **Email** is enabled
   (magic links are on by default).

---

## 2 · Host the page (GitHub Pages)

1. Create a GitHub repo and upload **index.html, manifest.webmanifest, sw.js, and the
   three icons** (keep the same filenames).
2. Repo → **Settings → Pages** → Source = **Deploy from a branch**, Branch = **main**,
   folder = **/ (root)** → Save.
3. After a minute you get a URL like `https://YOURNAME.github.io/weekly-focus/`.
   That's your planner — online, HTTPS (required for sync + install).

### Allow the magic-link redirect
In Supabase → **Authentication → URL Configuration**:
- **Site URL**: your Pages URL (e.g. `https://YOURNAME.github.io/weekly-focus/`).
- **Redirect URLs**: add the same URL (and, while testing locally, `http://localhost…`).

Without this, the magic link won't return cleanly to the app.

---

## 3 · Connect and sign in (on each device)

Open the URL, click **Cloud** in the toolbar, then:

1. Enter **Project URL**, **Publishable key**, and a **Board name** you choose
   (e.g. `my-week`). Use the **exact same board name** on every device to share one
   week. Click **Save connection** (these are remembered on the device).
2. Under **Sign in**, enter your email and click **Send magic link**.
3. Open the email **on that same device** and click the link — it returns to the
   planner signed in. The toolbar pill turns **☁ Synced**.
4. Repeat the sign-in on each device (PC and phone) with the same email. Each device
   signs in independently; the same account = the same private boards everywhere.

- **On your PC:** also click **Connect PROJECT_STATUS.md** and **Connect Database
  folder**. Reading them pushes your inventory up to the cloud automatically (while
  signed in).
- **On your phone:** add it to the home screen (Share → *Add to Home Screen* on iOS,
  or the install prompt on Android). It runs full-screen, works offline, and any
  subtasks you add on the train sync to your PC when you're back online.

**Sign out** anytime from the Cloud panel — your local copy stays on the device and
sync pauses until you sign in again.

---

## 4 · Keeping the cloud fresh

There's no background pusher (and deliberately no secret key anywhere). The app
re-pushes your inventory whenever you open it on your PC and read the files. Your
day-to-day curation (toggles, priorities, objectives, subtasks) syncs two-way in the
background on every device while signed in.

---

### Updating the planner later
Replace `index.html` in the repo. The service worker is network-first for the page,
so the new version lands on next open; your data lives in Supabase, scoped to your
account, and is untouched.

### How the isolation works (the short version)
- RLS is **default-deny**: with no matching policy, a query returns nothing.
- The only policies grant the **`authenticated`** role access to rows where
  `auth.uid() = user_id`. The **`anon`** role is granted nothing.
- So a stranger with your publishable key and no session sees an empty database;
  signed in as you, they'd only ever see your rows. `board_id` is just a label for
  "which week," not a security boundary.
