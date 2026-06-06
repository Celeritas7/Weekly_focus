# Weekly Focus — Cloud setup

This folder is everything you need to put the planner online and sync it between your PC and phone.

```
cloud/
├─ index.html              ← the planner (host this)
├─ manifest.webmanifest    ← makes it installable on your phone
├─ sw.js                   ← offline support (works on the train)
├─ icon-180/192/512.png    ← app icons
├─ supabase-setup.sql      ← run once in Supabase
└─ pusher/
   ├─ push-inventory.mjs   ← keeps Supabase updated from your PC (hands-off)
   └─ .env.example         ← copy to .env and fill in
```

Do the four steps once, in order. ~15 minutes total.

---

## 1 · Supabase (the database)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste all of **`supabase-setup.sql`** and click **Run**. (Creates two tables: `inventory` and `entries`.)
3. Go to **Project Settings → API** and copy two things for later:
   - **Project URL** — `https://xxxx.supabase.co`
   - **anon public** key (the long `eyJ…` one). *Safe to put in the page.*

> Note on privacy: this is a personal setup where the public anon key can read/write your board. Your data is just project names, study topics and subtasks, namespaced by an unguessable **board name**. If you ever want hard isolation, switch the SQL policies to Supabase Auth.

---

## 2 · Host the page (GitHub Pages)

1. Create a GitHub repo (e.g. `weekly-focus`) and upload **everything in this `cloud/` folder** to it (index.html, manifest, sw.js, the three icons — keep the same filenames).
2. Repo → **Settings → Pages** → Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)** → Save.
3. After a minute you get a URL like `https://YOURNAME.github.io/weekly-focus/`. That's your planner, online and HTTPS (required for sync + install).

---

## 3 · Connect each device (in the app)

Open the URL, click **Cloud** in the toolbar, and enter:
- **Project URL** and **Anon public key** from step 1
- a **Board name** you choose (e.g. `my-week`) — **use the exact same name on every device**

Click **Connect & sync**. The pill in the toolbar shows **☁ Synced**.

- **On your PC:** also click **Connect PROJECT_STATUS.md** and **Connect Database folder** as before. Reading them pushes your inventory up to the cloud automatically.
- **On your phone:** add it to your home screen (Share → *Add to Home Screen* on iOS, or the install prompt on Android). It opens full-screen, works offline, and any subtasks you add on the train sync to your PC when you're back online.

---

## 4 · Keep the cloud fresh automatically (the pusher)

Your inventory changes ~weekly. The app already re-pushes whenever you open it on your PC — but if you'd rather it stay current without opening anything:

1. Install **Node 18+** (you likely have it).
2. In `pusher/`, copy **`.env.example`** → **`.env`** and fill it in. Use the **service_role** key here (Settings → API), **not** the anon key — and keep `.env` on your PC only.
3. Test it:
   ```
   cd pusher
   node push-inventory.mjs
   ```
   You should see `Pushed to board "my-week": N apps, M study domains.`
4. Make it hands-off — pick one:
   - **Chain it onto your generator:** run `node push-inventory.mjs` right after whatever regenerates `PROJECT_STATUS.md`.
   - **Schedule it:** Windows **Task Scheduler** → Create Basic Task → Weekly (or daily) → *Start a program* → `node` with argument `push-inventory.mjs`, "Start in" = the `pusher` folder.

That's it. Edit your files on the PC, the pusher (or just opening the planner) updates Supabase, and your phone always shows the latest week — with two-way subtasks.

---

### Updating the planner later
If I give you a new `index.html`, just replace it in the repo. The service worker is network-first for the page, so the new version lands on next open; your data lives in Supabase and is untouched.
