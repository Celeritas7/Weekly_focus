# v95 — Wishlist: Add shop always there, no All shops

Copy these over the ones in `Weekly_focus/`, then reload:
- `index.html`
- `js/weekly-focus-app.js`
- `sw.js` (cache `weekly-focus-v94` → `weekly-focus-v95`)

## Behaviour
- The **+ Add shop · from Cost's list** tile now shows even when there are no boxes. A request from another app (e.g. Sukkiri) sitting in Unsorted can be given a box from Cost's list.
- The **All shops** button is gone. Empty shops appear only when you add them with + Add shop, or while you're filing an Unsorted item.
- Shops still come only from `akatsuki_shops`. The picker has no free-text entry, and typing `Shop: item` with a name that isn't on Cost's list puts the item in Unsorted.
- If Cost's list hasn't loaded yet, the empty board says so and asks you to tap ↻. It no longer suggests typing a shop.

## Notes
- The old `wf_wish_allshops` localStorage key is ignored now. You can leave it.
- The `.wallbtn` rules in `css/weekly-focus.css` aren't used any more. They do nothing, so the CSS doesn't need to be shipped.
