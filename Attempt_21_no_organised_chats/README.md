# Handoff: Schedule screen (location + date board) with PDF export

Implement a new **Schedule** screen in Weekly Focus (`Weekly_focus/` — vanilla JS PWA, no build step) that groups every open Special subtask by **where** it happens and **when**, plus a print/PDF export of the whole plan.

## About the design files
The `.dc.html` files in this folder are **design references built in HTML** — they show the intended look and behavior with hard-coded trip data. Do **not** ship them. Recreate the winning design (**Board**) inside the app's existing vanilla-JS patterns, driven by real board data. `Timeline` and `Agenda` are alternates kept for reference; `Print` is the reference for the PDF export layout. Open them in a browser to inspect (they need `support.js` next to them, included).

## Fidelity
**High-fidelity** for structure, hierarchy, and behavior. For colors/type/spacing, use the app's own CSS variables and classes (`css/weekly-focus.css`, `css/home-screens.css`) — the mocks approximate the app's design system; the app's real tokens win wherever they differ.

## Where it goes in the codebase
- `index.html`
  - New screen section after `scrLife`: `<section class="screen" id="scrSchedule" data-screen-label="Schedule">` containing a `.hone` wrapper with a `.sec-head.hsec` header and a host div `<div id="schedHost"></div>`.
  - New bottom tab in `.htabbar-in` (before Life): `<button class="htab" data-screen="scrSchedule">…Schedule</button>` — reuse an existing SVG style (a map-pin or grid icon, stroke-width 1.9).
  - The existing `showScreen()` / `.htab` wiring picks the tab up automatically (it iterates `document.querySelectorAll(".htab")`).
- `js/weekly-focus-app.js` — all logic lives **inside the existing IIFE** (the data — `entries`, `items`, `meta` — is closure-scoped; an external file cannot see it). Add:
  - `renderSchedule()` — builds the board from data (below); call it from `renderAll()` and from `showScreen("scrSchedule")` so it is fresh on tab switch.
  - A delegated click handler on `#schedHost` for checkbox toggles and group collapse (same pattern as `renderSpecial()`'s host handler).
- `css/home-screens.css` — new `sched-*` classes + the print rules (below).

## Data model (already exists — reuse, do not invent)
A schedule row = one subtask of a Special list:
- Lists: `specialSorted()` → items whose `group` is "Special".
- Subtasks: `visibleSubs(subs(it.id))` → `{ id, t, done, when ("YYYY-MM-DD" or "…THH:MM"), loc, urg, dl, md, tag }`.
- Date semantics: `whenView(x)` → `{ label, rel, cls (" over"/" today"/" soon"), asap, w.pastDue }`. Overdue/urgency logic is already correct here — reuse it, never re-derive.
- Places: `metaLocs()` + `placeList()` (and any `x.loc` seen on subtasks).
- Persisting a checkbox toggle: mutate the subtask's `done`, then `saveSubs(itemId, arr)` / the same entry-push path `renderSpecial()` uses (`entries[k]` + `cloudPushEntry(k, entries[k])`). Follow the exact code path of the existing subtask checkbox (`data-act="done"` handling) so cloud sync stays correct.

## Screen: Schedule (Board layout — see `Trip Schedule - Board.dc.html`)
- **Header row** (in `.sec-head.hsec`): kicker "Schedule", sub "every open task by place and date", count chip `N open`, plus a **countdown chip** to the next `dl` (countdown-deadline) task: "✈ N days" style — take the soonest future subtask with `x.dl` set; omit the chip when none.
- **Grouping:** one card per group. Group key = `x.loc` if set; subtasks with a `when` but no `loc` group under their date; subtasks with neither go in an "Anytime" card. Within a card, sort by `subRank(x)` (existing).
- **Card grid:** `display:grid; grid-template-columns:repeat(auto-fill,minmax(252px,1fr)); gap:14px; align-items:start`. Cards are the app's card style + a 3px top border in the group's hue (`hueFor(loc)` — existing) — overdue groups force the red/danger color.
- **Card header** (click = collapse toggle, persist in `localStorage["wf2_sched_collapsed"]` as an object of keys):
  - date/status chip: uppercase, 9.5px/800/letter-spacing .1em — red for overdue ("NOW"), dashed muted for "ANYTIME", theme color otherwise; text from `whenView` labels ("Today", "Sat 15", "3d overdue"…)
  - place title (uppercase, 12px/800), done-count badge `n/N`, collapse caret (rotates -90° when closed, `transition: transform .15s`)
- **Task row:** checkbox (`sub-check` pattern) · title (13px/600; done = line-through + faint) · note line if the subtask has extra text · urgent flag = existing red urgent treatment (`x.urg`) · `dl` tasks show the "N days left" chip from `whenView`.
- Empty state: "Nothing scheduled — add places and dates from any Special task."

## Interactions & behavior
- Checkbox toggle → persist + cloud push + re-render (counts, badges, countdown update).
- Card header click → collapse/expand that group (caret rotation, persisted).
- Tab switch → `renderSchedule()` re-runs (dates like "Today"/"overdue" are time-relative).
- Respect the app's mode (Personal/Office) exactly as `renderSpecial()` does: filter with `subModeOk(x.md, mode)`.

## PDF export
Browser-print based (matches the existing `btnPrint` → `window.print()` pattern):
1. Add a **⎙ PDF** button in the Schedule screen header (`.tbtn` style).
2. On click: set `document.body.dataset.print = "schedule"`, call `window.print()`, clear the attribute in an `afterprint` listener.
3. In CSS: `@media print { body[data-print="schedule"] … }` — hide topbar, tabbar, every screen except `#scrSchedule`; force it visible even if not the active tab.
4. Print layout follows `Trip Schedule - Print.dc.html`: single column, black on white, 22pt title + rule, per-group blocks with `break-inside: avoid`, 9pt empty checkboxes (✓-filled when done), URGENT outline chips, `orphans:3; widows:3`. Collapse states are ignored in print — everything prints.
5. Keep the existing `btnPrint` (focus sheet) untouched; this is a second, screen-scoped print path. Guard the two with the same `data-print` switch (`body[data-print="focus"]` for the old one if needed).

## Design tokens
Use the app's existing CSS variables from `css/weekly-focus.css` (card, hairline, ink/mid/faint text, urgent red, mode hues) — the mock hex values are approximations of these. Group hues come from `hueFor()`. No new fonts.

## Files in this bundle
- `Trip Schedule - Board.dc.html` — **the winning design; implement this**
- `Trip Schedule - Print.dc.html` — print/PDF layout reference
- `Trip Schedule - Timeline.dc.html`, `Trip Schedule - Agenda.dc.html` — alternates, reference only
- `support.js`, `doc-page.js` — runtime for viewing the mocks in a browser; not for the app
