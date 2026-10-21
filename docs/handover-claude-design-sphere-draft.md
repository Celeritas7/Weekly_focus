# Handover to Claude Design — Sphere Draft (game-style "Add to sphere")

> **v108:** the app card named **Akatsuki** is the sphere's core (`coreId()` / `isCore()` in `weekly-focus-app.js`): never a target, never in orbit, not on the draft's table, no rank. While it has open subtasks a red core bar shows on Today and Week, and the draft's centre becomes its red moon. Keep these rules if you touch the sphere code.
>
> **v109:** logos via `js/wf-logos.js` (`WFLogos.logoFor(item)`): Akatsuki's store first, the app's live site as fallback. Planets show a logo or the name, never a two-letter monogram.
>
> **Status: built by Claude Code in v107.** Code: `js/wf-sphere-draft.js`, `css/wf-sphere-draft.css`, plus the `SD_HOST` block next to `openPicker()` in `js/weekly-focus-app.js`. Don't rebuild it; to change it, edit those files. The rest of this note is the design record.

**Prototype (playable):** https://claude.ai/artifact/HpMazVRWEE1TL1pv6KgUaW
**Source:** `docs/prototypes/sphere-draft.html` (self-contained HTML/CSS/JS, example data, uses the app's own tokens: Helvetica, brand purple, priority colours).

## Why

The sphere works, but filling it is a chore: `+ Add to sphere` opens `#pickModal`, a flat list of toggle buttons (`openPicker()`). The user wants to **see every app at once** and pull in **only the high-priority ones**, and wants it to feel like a game.

## What to build

Replace `openPicker()` / `#pickModal` with a full-screen **Sphere Draft** view, opened from every existing `data-act="tpick"` entry point (empty Five card, "+ Add to sphere" in `renderSphereMore()`).

Layout (see prototype):
- **Left: the orrery.** Inner disc with **5 numbered slots** (The Five, rank 1 at the top, clockwise) and an outer dashed **orbit ring** for extras ("Also in the sphere"). Centre shows `n/5`.
- **Right: the table.** Every active item as a card. Filter: All / Apps / Study / Office. Sort: Priority first (default) / Most open tasks / Longest untouched / A–Z. Search.
- **By category (on by default, toggle remembered per device):** the table is split into sections by `item.group`, each with a heading (colour dot, name, count). Sections appear in the order of their best card under the current sort (A–Z sorts them by name), and cards inside a section follow the sort. Grouped cards drop the crumb, since the heading already names the category. Use the app's `catColor()` for the dot where it has one; otherwise a stable hue from the name.
- **Under the orrery:** week-load meter, orbit chips (tap = send back), Auto-fill the Five, Undo.
- **Phone:** orrery on top, table below, plus a sticky top bar (5 mini slots + orbit count) that appears when the orrery scrolls out of view; tapping it scrolls back.

### Card content (all from existing helpers)

| On the card | Source |
|---|---|
| Kind tag + crumb | `kindOf(k)`, `item.group` (same rows `openPicker()` builds: `activeItems("app"/"study"/"office")`, skipping `isSpecialItem`) |
| Name | `labelFor(k).name` |
| Priority (left stripe + label) | `getEntry(k).pri` — High / Medium / Low |
| Next step | `nextSub(k)`; "No open subtasks" if empty |
| Progress bar + `done/total` | `subProgress(k)` |
| "N days ago" (amber at 14+ days) | newest `subs(k)[].u`; omit the chip if no timestamps |
| Badge `#n` / `Orbit` when picked | `targetOrder.indexOf(k)` / `inSphere(k)` |

A picked card **leaves the table**: it is now a planet in the orrery (and a chip in the orbit list). The table only shows what is still up for selection, and the filter counts (All / Apps / Study / Office) count only those. When nothing is left, the table says "Everything is in the sphere. Tap a planet to send it back." Sending an item back puts its card back on the table.

### Moves → existing functions

Call `renderAll()` after each move. Membership is already per-item (`entries[k].sph`) and the Five is `targetOrder`, so this adds **no new storage** and no DB change.

| Gesture | Call |
|---|---|
| Tap a card not in the sphere | `sphereAdd(k)` → next free slot, else orbit |
| Tap a card / planet / orbit chip that is in the sphere | `sphereRemove(k)` |
| Drag onto slot *i* (0-based), from the table, orbit or another slot | `sphereAdd(k, i)`; the 6th target drops to orbit (it keeps `sph`) |
| Drag onto the orbit ring | `sphFlag(k); removeTarget(k);` then refill the Five from orbit **skipping `k`** (like the prototype's `fill(except)`; plain `sphereFill()` could pull it straight back). For apps also `setRank(k, 6)` so the rank list agrees. `setRank` only ranks apps, so study/office items use the first part alone |
| Drag back onto the table | `sphereRemove(k)` |
| Drop on the centre disc | not in sphere → `sphereAdd(k)`; in orbit with a free slot → `sphereAdd(k, targetOrder.length)` |
| Auto-fill the Five | `sphereAdd` the top-scored unpicked items until 5, staggered 220 ms |
| Keys on a focused card | `1`–`5` slot, `O` orbit, `Del`/`Backspace` send back, `Enter`/`Space` toggle |

**Score** used by "Priority first" and Auto-fill: `priWeight*100 + min(openSubtasks, 9)*3 − min(daysUntouched, 30)*0.1` with High 3 / Medium 2 / Low 1 / none 0.

**Undo:** toast with Undo after each move. Implement as the inverse move (`sphereRemove` / `sphereAdd(k, previousIndex)` / `setRank`), not by restoring a saved copy of `targetOrder`: restoring a whole copy would fight v104's sync merge.

### The game layer

- **Fly-in:** on add, a monogram token flies from the card to its slot or orbit (460 ms, `cubic-bezier(.2,.8,.2,1)`), then the slot pops.
- **Week load meter:** 5 gold segments (Five) + orbit segments. Orbit **soft cap 3**: past it, segments turn red and the label says `Heavy · N in orbit, drop X`. It nudges, never blocks.
- **Ignite:** when the Five go from 4 to 5, a one-off particle burst from the centre plus a gold glow on the disc; centre label becomes "Your Five are set".
- **Drag:** mouse after 6 px; touch after a 280 ms hold (cards keep `touch-action: pan-y` so the list still scrolls).
- `prefers-reduced-motion`: no fly, no burst, no pops.
- Both themes: the prototype defines light and dark token sets.

## Acceptance checks

1. With 15+ active items, all are visible in the table at desktop width without opening anything.
2. Tap 3 cards → they land in slots 1–3 in tap order; `targetOrder` matches; reload → same.
3. Drag the slot-3 planet onto slot 1 → ranks shift, nothing is lost.
4. Fill the Five, tap a 6th → it lands in orbit; the load meter shows 1 orbit segment.
5. Put 4 items in orbit → meter shows "Heavy · 4 in orbit, drop 1".
6. Send a target back → the first orbit item moves up into the Five.
7. Undo after each of the above restores the previous state on **both** devices (v104 sync).
8. Phone: long-press-drag works; normal swipes still scroll; the sticky bar appears once the orrery is off-screen.

## Rules (unchanged)

- Build on the current `main`. Keep `migrations/`, `CLAUDE.md` and the "no SQL ships with this build" line in `DEPLOY-NOTES.md`.
- This feature needs **no database change**. If you think it does, ask for a migration in `migrations/`; don't paste SQL.
