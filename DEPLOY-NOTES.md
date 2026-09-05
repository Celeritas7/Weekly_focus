# Deploy v46 — Vault: personal records inside Chats

1. **🔐 Vault card** at the top of the Chats tab (next to ⭐ Starred). Opens a category grid — the folder view.
2. **7 categories, each with its own template:** Chats (topic + link), Addresses (name, street, city/PIN, phone), Links, Logins & passwords, Bank details (holder, account no, IFSC, branch), Important links, Cards (number, name, expiry, CVV).
3. **Sensitive fields masked** (passwords, account no, card no, CVV show •••• 1234) with 👁 reveal toggle; every field has a copy button; URL fields get an Open ↗ button.
4. **Add / edit modal** per category — tap "+ Add", fill the template; ✎ edits, × deletes (with confirm).
5. Data lives in the same board store (`meta.cvault`), so it syncs to your cloud like everything else.

**Note:** values are stored/synced as plain text — fine for addresses and links; keep truly critical passwords in a dedicated password manager.

**Files changed:** index.html, js/weekly-focus-app.js, css/weekly-focus.css, sw.js (cache → weekly-focus-v63).

**Deploy:** copy this folder's files over your repo (and your local Weekly_focus folder), push, reload the app twice.
