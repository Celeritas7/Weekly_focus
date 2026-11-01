# WF → Akatsuki · v88 report: purchase board (R016), reply statuses, multi-sender merge

From: Weekly Focus (WF), via its Claude Code session. Checked 2026-11-01 against the code on `main` (build v129) and the live project (read-only).
Status: **live since v88, refined in v96.** Nothing in this report asks the hub to change anything, except one question about Exercise (section 5).

## 1. Purchase board (R016)

- **Read:** `wf.purchases.board()` reads `akatsuki_purchases` (columns `seq, from_app, src_addr, payload, reply, reply_seq, created_at, plan_key, plan_shop`), newest 500 by `seq`.
- **When:** on load (after WF's state is ready), on Refresh, and every 30 s while the Wishlist is open.
- **Open vs closed (v96):** a row is open while `reply->>'status'` is null. The Wishlist shows **open rows only**; Cost keeps the history. Closed WF rows are used only to drop the matching local items.
- **Shop boxes:** from `akatsuki_shops` (Cost's list, refreshed at most every 10 min). No typed shop names; a name not on Cost's list is not offered.
- **WF's only write:** `purchase_plan.shop`, via `hub.put('purchase_plan', 'shop', plan_key, { shop, at })` on a **drop** onto a shop box, and `hub.remove(...)` on a drop back to Unsorted. Key = `plan_key`, else `from_app:payload.id`. Never written on render or load, and never for a closed row.
- **Box shown:** `plan_shop`, else Unsorted (display only, never written back).

## 2. Reply statuses

**WF's own ¥ requests** (`purchase_request`, `from_app = 'wf'`, `src_addr = {board_id, item_key, sub_id}`):
- `akPollReplies()` pages `hub.replies('purchase_request', since)` with a per-device cursor on `reply_seq` (`localStorage wf_ak_pr_cursor`).
- Matched to the local Wishlist item by `src_addr.sub_id` (or `wish_id`). Unknown ids and replies to older, closed request ids are ignored.

| `reply.status` | WF does |
|---|---|
| `logged` | item marked done (`doneAt`), badge "logged" |
| `approved` | badge "approved" |
| `rejected` | ¥ switched off, badge "rejected" |
| `pending` | badge "sent" |
| anything else | ignored |

**Other senders' rows:** the badge shows the sender and `reply.status` (`pending` when null); a pending row with no `plan_shop` is marked "new".

## 3. Multi-sender merge

- WF's own rows (`from_app = 'wf'`) are **merged** with the local Wishlist item by `payload.id` (= `sub_id`), so each ¥ item shows once.
- Other senders' rows are shown as **read-only** items (item, quantity, price belong to the sender); the only thing WF changes is the shop.
- **Sender tag (v88d):** every non-WF item carries a chip with the sender's name: `wf` → Weekly Focus, `sukkiri` → Sukkiri, `exercise` → Exercise, `cost` → Cost; any other `from_app` is shown capitalised.
- Deleting a non-WF item in WF **hides it on this device only** (`localStorage wf_purchase_hidden`); it stays open in Cost. Never a hub write.

## 4. Live state (2026-11-01, read-only)

| from_app | logged | rejected | open |
|---|---|---|---|
| sukkiri | 2 | 6 | 0 |
| wf | 2 | 4 | 0 |

- 14 requests in all, **0 open**. Last request: 2026-09-30.
- Routes live: `purchase.board` (cost → wf, view), `purchase.plan` (wf → cost, view), `purchase_request` (wf → cost, sukkiri → cost), `purchase_reply` (cost → wf, cost → sukkiri).
- 0 rows in `akatsuki_violations` mention purchases.

## 5. Open items

1. **Sender tag not yet seen live.** No other sender has had an open request since 2026-09-30, so the chip on a Sukkiri / Exercise / Cost item has not shown on a real row. Verification waits for the next request from one of them.
2. **Exercise has no `purchase_request` route.** WF already names Exercise as a sender, but the registry lists only wf → cost and sukkiri → cost. If Exercise is meant to send purchase requests, it needs a route (hub decision); until then its publishes would be refused.
3. **Per-device state.** The reply cursor and the hidden list live in each browser. A new device or address (e.g. the Vercel copy of WF) re-reads replies from the start (harmless: the mapping is idempotent) and starts with nothing hidden.
4. **Cost's override of the shop is not shown.** Since v96 the Wishlist shows open rows only, so the shop Cost actually used when logging is not displayed in WF. That is intended (Cost keeps the history); noting it so the contract text matches.
5. **Board limit:** WF reads the newest 500 rows. Fine at 14; worth a note if volume grows.

Please confirm the contract matches what the hub expects, and decide item 2.
