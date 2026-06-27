# Weekly Focus — app source (authoring parts)

The app is **one IIFE** that shares a single closure scope. To keep that intact while
authoring in smaller files, the logic is split into ordered fragments here in `src/`
(named `*.part`), and concatenated — in filename order — into the shipped
`../weekly-focus-app.js`.

> The `.part` extension is deliberate: these fragments are **not** valid standalone
> scripts (they share variables, and the first/last only open/close the IIFE), so they
> must stay invisible to JS tooling and bundlers. Only the concatenated
> `weekly-focus-app.js` is ever loaded by a browser.

## Edit → build → ship
1. Edit the relevant part below (not the combined file).
2. From the `app/` folder, run the build:
   - macOS / Linux: `sh build.sh`
   - Windows (PowerShell): `Get-Content src\*.part | Set-Content weekly-focus-app.js`
   - Anywhere, by hand: concatenate `src/*.part` in filename order into `weekly-focus-app.js`.
3. Commit/deploy, and bump `CACHE` in `sw.js` so devices pick up the new build.

The output is **byte-identical** to hand-editing the big file — zero runtime change.

## The parts (in concatenation order)
| File | What's in it |
|---|---|
| `00-header.part` | File banner, `(function(){ "use strict";` open |
| `01-helpers.part` | Inline icons, small helpers, the SVG ring builder |
| `02-state.part` | State + persistence: cloud config, inventory, CRUD, model accessors, subtask merge, targets, liveliness state |
| `03-render.part` | `renderAll` + pulse / The Five / columns / item card / detail panel |
| `04-picker.part` | The target-picker modal |
| `05-add.part` | The add-item modal |
| `06-events.part` | Click / keydown / input / change handlers, subtasks, toast |
| `07-cloud.part` | Supabase client, auth, two-way sync (outbox, pulls) |
| `08-liveliness.part` | Ring count-up, confetti, drag-and-drop |
| `09-boards.part` | Multiple-board switcher |
| `10-init.part` | `init()` + boot |
| `99-footer.part` | `})();` IIFE close |

> Filenames are numeric-prefixed because the build sorts by name. Keep the prefixes
> in order if you add a part (e.g. `065-foo.part` to slot between events and cloud).
