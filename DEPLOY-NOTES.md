# v97 — Roadmap link + banner (R022)

Copy these over the ones in `Weekly_focus/`, then reload:
- `index.html` (loads `js/akatsuki-banner.js` after the client)
- `js/weekly-focus-app.js`
- `js/akatsuki-banner.js` (new, hub file, unchanged)
- `js/config.js` (adds `roadmapUrl`)
- `sw.js` (cache → `weekly-focus-v97`, banner added)

`js/akatsuki-client.js` is not replaced. Yours is newer than R017 (it has the consume response-shape fix) and already has `doc()`.

## 1 · task.upsert to rm
- Every subtask under an `app:`, `study:` or `office:` item is published, one row per subtask. Addr is `{ board_id, item_key, sub_id }`, clock is `s.u`, and the payload follows the R022 shape.
- Synthetic rows are skipped: `__board`, `__timeline`, `__inbox`, plus the retired `app:cost-requests`.
- **Hash gate:** a per-device record in `localStorage wf_rm_task_seen`. A subtask is sent only when its payload changes. The first run backfills everything, up to 50 per 30 s tick.
- **Deletions:** a subtask whose whole item was deleted is sent once more with `del: true`.
- `when` is always sent as a date (`YYYY-MM-DD`).
- A contract error (route still `half` for `app:`/`office:`) pauses that prefix until the next reload. It never loops.
- Each edit triggers a publish 1.5 s later, and the tick catches anything missed.

## 2 · task.done / task.skipped from rm
- Handled only after the board has loaded (`akNotReady` → defer).
- The subtask is found by `src_addr { board_id, item_key, sub_id }`. A different board is deferred until that board is open.
- Replies use `unknown | stale | already | applied`:
  - `done` sets `done: true` and `u`.
  - `skipped` sets `lat: true` and `latAt = u`.
- The reason is not stored.

## 3 · Banner
`AkatsukiBanner(sb, 'wf', { roadmapUrl }).start()` runs in `akStart`, after sign-in. It is fixed to the bottom of the screen. If it covers the bottom tab bar, say so and I'll give it a `mount`.

## Also
- `var CTX` is gone. On sign-in, contexts load from `akatsuki_vocab` (`ns = 'context'`). Label comes from `meta.label | name | title`, short from `meta.short | abbr`, order from `meta.ord`. The last good read is cached in `wf_ctx_vocab` for offline use.
- `ctxNorm` now keeps any context id, even before the vocab arrives. The old filter would have wiped stored contexts on the first merge push while the vocab was empty.
- `subtasks[].when` stays a date. The task sheet's time field is untouched for now. Calendar owns time slots.

## Finding the `task.done` seq for the reply
```sql
select seq, kind, src_addr, reply->>'status' as status, reply_seq
from akatsuki_requests
where to_app = 'wf' and from_app = 'rm' and kind in ('task.done','task.skipped')
order by seq desc limit 5;
```
