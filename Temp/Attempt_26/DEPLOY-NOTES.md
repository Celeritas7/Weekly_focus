# Deploy v45 — Chats folder picker, starred chats, link UI, mobile fixes

1. **Chats: compact folder picker.** The wall of folder chips is now one "Save into" button; tapping it opens a full-screen picker modal with folders grouped by category (Apps / Study / Office / My folders), plus Unsorted and + New folder. The same modal is used when filing/moving a chat.
2. **Starred chats.** Every chat row has a ☆ toggle. Starred chats appear in a pinned ⭐ Starred card at the top of the Chats tab, across all folders — the chat stays in its own folder (starring pins, it doesn't move).
3. **Quick links UI.** Rows are now cards: icon badge, label, host pill, pill-shaped "Open ↗" button, hover lift; add-form wraps on mobile.
4. **Mobile fixes.** Timeline rows and section headers wrap instead of squeezing text to one letter per line; chat rows stack their action buttons on narrow screens; the Chats screen now lives inside the app container (consistent padding above the tab bar).
5. **Bottom tab bar.** Labels no longer collide (tighter tracking, clipping, smaller on very narrow screens); icons normalized to 20px.

**Files changed:** index.html, js/weekly-focus-app.js, css/weekly-focus.css, css/home-screens.css, sw.js (cache → weekly-focus-v62).

**Deploy:** copy this folder's files over your repo (and your local Weekly_focus folder), push, reload the app twice.
