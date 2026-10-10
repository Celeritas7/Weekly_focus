# Weekly Focus — Vault data-loss report

Scope: static read of `js/weekly-focus-app.js` (Vault ≈ lines 3966–4380; cloud sync ≈ lines 1925–2078) and `docs/vault-address-v92.sql`.
Nothing was executed or reproduced. Findings come from reading the code; the cause of the specific loss the owner experienced is **not confirmed** (see "Next steps").

## How the Vault is stored

- Vault records live in `meta.cvault` (array of `{id, cat, f, fold, u}`).
- `meta` is **not** stored per record. It is part of one synthetic Supabase row: `weekly_focus_entries` where `item_key = '__board'`, payload `{targetOrder, meta, u}`.
- Every vault add/edit/delete calls `saveChats()` → `save()` + `cloudPushBoard()`, which upserts the whole `__board` row.

## Findings

### 1. Whole-board last-writer-wins; the vault is never merged (HIGH)
`cloudPullEntries`, line 2060:
```js
if ((b.u || 0) >= boardU) { ...; if (b.meta) meta = b.meta; boardU = b.u || 0; }
```
When the remote row's `u` is >= the local `boardU`, the **entire local `meta` (including `cvault`) is replaced** by the remote one. There is no per-record merge, unlike subtasks, which are union-merged via `mergeSubs`.
Scenario: device A (offline or stale) adds a login; device B adds an address and syncs. When A reconnects, one side's vault edits are overwritten, depending on which `u` is higher.

### 2. Outbox is in-memory only, and `boardU` resets to 0 on load (HIGH)
- `function saveOutbox() {}` (line 1935) is a no-op; `outbox` exists only in memory.
- `flushOutbox` swallows failures (`catch (e) { continue; }`) and just retries later; nothing is persisted or surfaced.
- `var boardU = 0` (line 62) at startup.
Sequence: save a vault record → local `save()` succeeds, cloud push is queued → tab closed / reloaded / killed / signal lost before the push succeeds → on next load `boardU = 0`, so any remote `__board` row passes `u >= boardU` and **overwrites the local `meta`, discarding the unsent vault record**. This is the most likely cause of "I saved it and it was gone."

### 3. Delete is immediate, synced, and has no undo or history (MEDIUM)
Lines 4319 and 4380: `confirm()` then `meta.cvault = vaultArr().filter(...)`, `saveChats()`. The deletion is pushed to the cloud straight away. No tombstone, no trash, no previous-version copy, no export/backup.
Combined with #1, a delete on one device can remove records on others (or be reverted by a stale device).

### 4. Edit of a record deleted elsewhere is silently dropped (LOW–MEDIUM)
Save handler, line ~4350: `vaultArr().forEach(x => { if (x.id === VM_ID) {...} })`. If no record has that id (already deleted/replaced by a sync), nothing is written, but the UI still shows `toast("Saved ✓")`.

### 5. Initial-sync seeding can push an empty/partial board (MEDIUM, needs verification)
Line 2050: if the remote has no rows and the device has data, the device seeds the cloud. Conversely, a device with an empty/new local state that gets a remote row simply adopts it (via #1). A fresh browser profile / cleared site data therefore takes whatever the cloud has, and any vault data that only existed locally is gone.

### 6. Manual SQL migration rewrites the same single row (LOW)
`docs/vault-address-v92.sql` rewrites `__board.payload.meta.cvault` and bumps `u`. Its own header warns an unsent app change would overwrite it (same race as #1/#2). It has no backup step before the `UPDATE`.

### 7. Not data loss, but related: secrets stored in plaintext
Passwords, card number + CVV, bank accounts and API keys are stored as plain JSON in Supabase with no client-side encryption. Protection relies on RLS only. (The app itself notes it is not a replacement for a password manager.)

## Recommended fixes (priority order)

1. **Merge `cvault` by record `id` and `u` on pull** (newest `u` wins per record, union of ids, with tombstones for deletions) instead of replacing `meta` wholesale.
2. **Persist the outbox** (localStorage/IndexedDB) and **initialise `boardU` from persisted local state**, so unsent edits survive reloads and are not clobbered by an older remote row. Surface push failures in the UI.
3. **Soft-delete / undo and an export-backup button** for the vault; keep a rolling local snapshot of `meta.cvault` before any pull overwrites it.
4. Make the edit handler re-insert (or warn) when the record id no longer exists.
5. Add a pre-`UPDATE` backup step to any manual SQL migration (`create table ... as select` of the `__board` row).
6. Consider client-side encryption for secret fields.

## Next steps to recover / confirm the owner's loss

- **Do not open the app on other devices yet** — a stale device can push its older board and overwrite the cloud copy.
- Check whether any device/browser still has the data in local storage (the app's `save()` copy) before it syncs; export it first.
- In Supabase: check Database → Backups (daily or PITR, plan-dependent) and query `weekly_focus_entries` where `item_key = '__board'` — inspect `payload->'meta'->'cvault'` and `payload->'u'` / `updated_at`.
- Establish the timeline: was the record saved on a different device than the one that later synced? Was the tab closed right after saving? Did the app show "synced" before closing? That distinguishes finding #1 from #2.
