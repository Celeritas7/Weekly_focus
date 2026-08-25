# Deploy v44 — recover quick links (deploy of the v43 fixes)

Your live app and local folder were running pre-v43 code with two problems:
1. **Link display/loss bug:** `normalizeInventory()` rebuilt each app/study item as only `{id, name, group}` on every Supabase pull, stripping `links` (quick links) and `gen` ("Made with…"). Links looked lost after every reload even though `weekly_focus_inventory` still had them — and any inventory edit then pushed the stripped copy, wiping them for real. Fixed: normalization preserves all item fields.
2. **No link editing:** pencil ✎ + click label/host to edit links inline (added in v43).

**Files changed vs your live build:** `js/weekly-focus-app.js`, `css/weekly-focus.css`, `sw.js` (cache → `weekly-focus-v61`).

**Deploy:** replace your repo's files with this folder's, push, then reload the app twice (first load installs the new service worker, second serves the new JS). The links still in the DB will reappear on their own — no data restore needed.

**Until deployed:** don't rename/add/delete/toggle items in the live app — an inventory push from the old code wipes the links in the DB.
