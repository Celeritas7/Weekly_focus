# Deploy v38 — checklist drag handles + Five card & separator polish

## What changed
1. **Checklist drag-to-reorder** — every subtask row in an item's detail panel
   now has a `⋮⋮` grip on the left (faint until you hover; always visible on
   touch). Drag it to reorder; the order saves and syncs like any other edit.
2. **The Five cards** — cards now hug their content instead of all stretching
   to the tallest card in the row (no more giant empty middle). Long names
   (e.g. `Command_centre_advanced`) wrap instead of clipping. Paragraph-length
   subtasks clamp to 2 lines (hover for full text), and a card shows at most
   5 subtasks with a "+N more" tail.
3. **Group separators** — the category heads (■ LANGUAGE STUDY 4) now carry a
   hairline rule to the right edge, tabular count in the group colour, and
   more breathing room above (24px) / below (10px).

## Copy these over your Weekly_focus root (same layout as v37)
    sw.js                     (cache bumped to v38)
    css/weekly-focus.css
    js/weekly-focus-app.js
    index.html / manifest / icons / other js+css — unchanged, included for completeness
