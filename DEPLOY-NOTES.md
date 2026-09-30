# v96 — Wishlist is a shop assigner, not a purchase record

Copy these over the ones in `Weekly_focus/`, then reload:
- `index.html` (All shops button removed)
- `js/weekly-focus-app.js`
- `js/wf-purchase-adapter.js`
- `sw.js` (cache → `weekly-focus-v96`)

## Behaviour
- **Open = `reply->>'status'` is null.** Any reply (logged, rejected, or anything else) drops the request from the board at the next refresh. Cost keeps the history. WF's own items go too: a local ¥ item whose request Cost has answered is removed from this device's list.
- **Ticking an item removes it.** No "All bought ✓0" tile state, no "Show bought" list, no 30-day keep.
- **Boxes exist only while they hold an open item.** Empty boxes vanish. Pinned shops are gone (the old `wishPins` board data is ignored).
- **+ Add shop · from Cost's list** always shows (once Cost's shop list has loaded), even with no boxes. Picking a shop:
  - with an Unsorted item selected → files it there and the box appears;
  - otherwise → opens that shop's sheet, which lists Unsorted items to file here plus the add-item field. The box appears once it holds something.
- **All shops** button removed. While filing (an Unsorted chip is tapped), every Cost shop still shows as a target, as before.
- Shops come only from `akatsuki_shops`. No typed name is ever accepted as a box; `Shop: item` with an unknown shop lands in Unsorted.
- Flow view: stop header shows "N to buy" instead of "x of y bought".

## Adapter
`board()` now returns all rows (newest 500) with no status filter, plus `open(row)`. `boxOf(row)` is just `plan_shop`. Reads only — nothing new is written to the hub.

## Cleanup you can skip
`.wtile.full`, `.wbought`, `.wunpin`, `.wallbtn` CSS rules are unused now but harmless.
