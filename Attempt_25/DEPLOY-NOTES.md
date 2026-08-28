# Deploy v42 (cache v59) — flat-view sort: priority above drag order

## What changed
**Flat view sort order is now: starred → flagged → priority → name → manual drag order.**
Previously a drag-reorder (`ord`) outranked priority, so low-priority items stayed pinned wherever they'd once been dragged. Priority now always wins; dragging only breaks ties in flat view. Grouped view is unchanged.

## Copy these over your Weekly_focus root
    sw.js                     (cache bumped to v59)
    js/weekly-focus-app.js
    everything else unchanged, included for completeness
