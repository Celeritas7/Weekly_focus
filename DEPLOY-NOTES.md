# Deploy v41 (cache v58) — "Coming up" grouped by topic

## What changed
**Coming up strip → topic cards.** Tasks are no longer one flat wall of
random-width chips. Each source list (India tasks, Job change, Events…)
becomes a compact card with its coloured head + count; inside, rows sit in a
uniform list — overdue first, then ASAP, then dated (soonest first). Topics
holding the most urgent task sort first. Cards flow in a responsive grid
(1 column on phone). Row click still jumps to the parent block; the checkbox
still marks done.

## Copy these over your Weekly_focus root
    sw.js                     (cache bumped to v58)
    css/weekly-focus.css
    css/home-screens.css
    js/weekly-focus-app.js
    everything else unchanged, included for completeness
