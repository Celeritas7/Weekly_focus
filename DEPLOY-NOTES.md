# Deploy v51 — Ranked Five: Must · Can ×4 · Will (includes v49 + v50)

Copy into `Weekly_focus`, overwrite, push, reload twice:

- `js/weekly-focus-app.js`
- `css/weekly-focus.css`
- `css/home-screens.css`  (only if you skipped v48)
- `sw.js`  (cache v68)

## What changes

**Rank = position.** Every active app in the Apps column shows a rank badge. The Five are #1–#5 in their drag order; the rest of the column continues #6, #7… (existing sort: flagged first, then priority, name, manual order). Drag to re-rank, same as today.

**Roles.** #1 = **Must** (red frame + label on its Five card and Today row). #2–#5 = **Can**. #6 = **Will**: a dashed sixth card at the end of The Five and a dashed row on Today — visible, not tickable. Study/Office targets are unaffected (no rank badge).

**Hold remembers rank.** Toggling a starred app off still parks it 24 h, but now stores its rank. Backlog chip reads `⏸ 17h · #2`. When it returns (auto at expiry, or manual toggle) it re-enters The Five at that rank; the last Can drops back to Will. Toast on hold: "On hold — back in 24 hours at #1. Roadmap is Must now."

**Data.** One new field on held entries: `holdRank` (number). Nothing else in the schema moves; old holds without it fall back to appending, as before.

## Not in this build
Review phase / comments lock (needs its own prototype), Wishlist (Phase 7), Study/Office ranking.
