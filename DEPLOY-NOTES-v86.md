# v86 — Requests move to the Wishlist

Copy into `Weekly_focus/` (overwrite):
- `js/weekly-focus-app.js`
- `css/weekly-focus.css`
- `sw.js` (cache → weekly-focus-v86)

## What changed
- Cost → WF requests now land in the **Wishlist** (Routines tab), filed under `preferred_shop`, or in Unsorted if it has none. The Life "Requests" list is migrated into the Wishlist once, then deleted.
- Tags on items: a teal tag shows the source (Cost / Sukkiri…). A **¥** badge sits on every WF item: tap it to send the item to Cost. The badge then shows "¥ sent", "¥ bought", "¥ waiting" or "¥ cancelled". Tap a sent badge to cancel (asks first).
- Tap an item's name in its shop sheet to open its details: needed-by date, notes, source and budget.
- WF → Cost: the first send publishes `request.created`. Ticks, moves, renames and detail edits then publish `request.changed` with `updated_at`, so the last edit wins.
- Cost's replies to WF's sends: `done` ticks the item; `cancelled` turns it back into a plain WF item.
- Replies to Cost's own requests are unchanged: tick → done, un-tick → open, delete → cancelled.
- `[ak]` logging only runs in debug mode: add `?akdebug` to the URL or set `localStorage.wf_ak_debug = "1"`. Warnings and errors always log.

## Needs from Akatsuki
- Routes **wf → cost** for `request.created` and `request.changed`. Until they're open, sends show "¥ waiting" and retry every 30 s.
- Payload WF sends: `{item, quantity:1, preferred_shop, needed_by, notes, status: open|done|cancelled, source:"wf", updated_at}`. Address: `{board_id, doc:"wish", wish_id}`.
- Cost replies on the `request.created` row with `{status, at}`.

## v87 (after routes open)
Show Sukkiri and Exercise → Cost requests in WF, with a "new" mark until you put them in a shop. Edits sync back; they can't be deleted in WF.
