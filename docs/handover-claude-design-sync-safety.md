# Handover to Claude Design — Weekly Focus sync safety (no more silent data loss)

From: the Claude Code session that investigated the Vault data loss (Oct 12–13, 2026).
Scope: app code only (`js/weekly-focus-app.js` and whatever replaced it). **The database side is done and is not yours to change** — see "Database rules" at the end.

The code I read is the repo copy (v92–v94 era). Your live build is newer: on Oct 13 15:14:40 UTC it moved the one vault record out of `__board.meta.cvault` into its own `__v:<id>` row. That is the right direction. Use the checks below against **your** current code, not line numbers from mine.

---

## How data is lost today (repo code)

The app keeps **no local copy** of user data: `save()` is a no-op, `outbox` lives in memory only, `meta` / `entries` start empty and are filled by the first cloud pull.

1. **Push before first pull wipes the board.** On a slow or offline start, `meta` is `{}`. Any board-level action (add a vault record, star, note) calls `cloudPushBoard()` → upserts `__board` with an almost empty `meta` and `u = Date.now()`. That `u` beats the cloud copy, so every other device adopts the empty board. Everything in `meta` is gone (vault, chats, wishlist, routines…).
2. **Unsent changes die on reload.** `outbox` is in memory. Close/reload the tab, lose signal, or have the OS kill the tab before `flushOutbox()` succeeds → the change never existed. Failures are swallowed (`catch { continue; }`).
3. **Whole-board last-writer-wins.** `cloudPullEntries()` replaces `meta` wholesale when remote `u >= boardU`, and pending local `__board` writes replace the remote one wholesale. Two devices editing different vault records → one device's record disappears. `u` is the client clock, so a device whose clock runs fast always wins.
4. **Edit of a record deleted elsewhere is dropped**, but the UI still says "Saved ✓".
5. **Hard delete, no undo.** Delete removes the record and syncs immediately.

---

## Requirements

### R1 — Never push before the first successful pull *(highest priority: this one can wipe everything)*
- Track `pulledOnce` per board. Until the first `cloudPullEntries()` **and** `cloudPullInventory()` succeed, block every `cloudPush*` that writes a whole document (`__board`, inventory). Queue the user's change locally (R2) and apply it on top of the pulled state.
- While not pulled, show it ("Loading your board…"); disable or queue edits.
- Same rule after switching boards.

### R2 — Persist the outbox
- Store the outbox in `localStorage` (or IndexedDB) under a key that includes user id and board id, e.g. `wf_outbox:<user>:<board>`.
- Write it **before** sending; delete an entry only after the server confirms (`!r.error`).
- On startup: restore it, run the first pull, then re-apply pending ops on top and flush.
- `beforeunload` / `pagehide`: if the outbox is non-empty, warn ("Changes not synced yet").
- The cloud pill shows the pending count and the last error (`⚠ 2 not synced`). No silent `catch {}`.

### R3 — Vault (and chats) as one row per record — you have started this; finish it safely
- Key: `__v:<id>` (and `__c:<id>` for chats). Payload carries its own `u`.
- **Delete = soft delete first:** set `del: <timestamp>` and push. The UI hides `del` records. The server keeps a history copy whenever `del` appears (that rule is in the DB). A later "empty trash" may hard-delete.
- **Pull merges per key.** For each key: if there's a pending local op for it, local wins; else take remote. Never replace the whole set.
- **Migration from `meta.cvault`** must be loss-proof: (1) upsert every record as `__v:<id>`, (2) re-read and confirm each row exists, (3) only then remove it from `meta.cvault`. Never clear `meta.cvault` in the same push that creates the rows. Run it on one device only (e.g. guard with a `meta.cvaultMigrated` flag set after step 2).
- Edit of a missing id: re-create it (it was deleted elsewhere) **or** ask the user — never show "Saved ✓" for a write that didn't happen.

### R4 — What stays in `__board.meta`
- Anything still in `meta` is still whole-document last-writer-wins. Either move each list (wishlist, routines, places, links, medit…) to per-record rows like R3, or at minimum merge `meta` **per top-level key** on pull: keys with pending local changes keep the local value, others take remote.
- Don't compare client clocks across devices to decide winners. Prefer "pending local change wins, otherwise remote wins".

### R5 — Recovery affordance (small)
- Settings → "Restore deleted vault items" listing `del` records (and a link to export the vault as JSON).

---

## Acceptance tests (do these in two browser profiles, A and B, same account)

1. **Slow start:** throttle network to "Offline" in A, reload, add a vault record, go online. Expect: nothing lost on B; the new record appears on both.
2. **Reload before sync:** in A go offline, add a vault record, reload the tab, go online. Expect: the record syncs (outbox survived).
3. **Two devices, two records:** A and B both offline; A adds record X, B adds record Y; both online. Expect: both X and Y on both devices.
4. **Same record, two edits:** A and B edit the same record offline; online. Expect: one wins, no other record changes, and the loser's text is in server history.
5. **Delete then edit:** A deletes X; B (stale) edits X. Expect: no "Saved ✓" lie — either X comes back as edited or B is told it was deleted.
6. **Migration:** a board with N records in `meta.cvault` → after upgrade, N `__v:` rows, `meta.cvault` empty, and run the upgrade on a second device too: still N rows, no duplicates.
7. **Soft delete:** delete a record → row gets `del`, history gains 1 row for that key, restore brings it back.

Server-side check you can ask the Claude Code session to run after each test:
```sql
select item_key, count(*), max(saved_at) from weekly_focus_history group by 1 order by 3 desc limit 10;
```

---

## Database rules (do not change from the app side)

- `public.wf_keep_history()` has **one** version, owned by the repo: `migrations/20261013_01_wf_keep_history_merged.sql` (re-applied by `_02`, live md5 `212409a042cc1ad5bb18a07ed1a915a1`). It snapshots every `weekly_focus_entries` row (incl. `__v:` / `__c:`) on update/delete, always on `del`, keeps 20 per key (100 for `__*`), 30 days.
- **Do not paste SQL that redefines it.** On Oct 13 three pasted versions overwrote each other within two hours. Any DB change → ask for a migration in `migrations/` (see `migrations/README.md`); it starts by reading the live definition and checks its md5.
- History only exists from 2026-10-12 15:15 UTC. Older losses are not recoverable from it.
