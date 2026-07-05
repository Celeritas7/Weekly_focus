# Weekly Focus — build 17

**Theme: tasks get a life of their own — mode, hours, deadlines, priority.**

## What's new

- **Per-task Personal / Office / Both tag.** Every Special task can be tagged `Personal`, `Office`, or `Both` (default). The Personal–Office toggle now filters Special tasks on the Week tab and the Today screen. Hidden tasks show as a tappable "Show N office tasks" note on each card, so nothing silently disappears.
- **Mode hours + waiting tray.** Set Office hours and Personal hours from the clock button next to Top Tasks (defaults: Office 9:00–18:00, Personal 19:00–22:00). Single-mode tasks surface on Today only inside their hours; outside them they collapse into a "waiting for … hours" tray you can expand. Urgent and overdue tasks always break through.
- **Urgent flag.** A flag on every task (in the row and in the task sheet). Urgent tasks pin to the top of their card, the agenda strip, and Today — in red, with an ASAP chip — even if they have no date.
- **ASAP deadline zone.** A dated task automatically turns red once it's overdue, past its time today, or within 3 hours of a timed deadline today.
- **Quick task sheet.** Tapping a task's date chip (or calendar icon) now opens one sheet with tap-chips: Today / Tomorrow / next 5 days + preset times (9:00, 12:00, 15:00, 18:00, 21:00), plus native pickers for anything else, plus the Mode tag and Urgent flag. No more raw dd-mm-yyyy inputs.
- **Countdown deadlines.** In the task sheet, toggle "Add countdown" on any dated task (e.g. *book flight tickets* — the later, the costlier). The chip becomes a live countdown ("6 days left") that escalates: amber inside 7 days (and it surfaces on Today), red/ASAP inside 2 days, overdue red after.
- **Two-line task rows.** Mode tag + date chip sit on their own line under the task text, so long task names no longer squeeze into a one-word-per-line column.
- **Routines on Today.** Routines scheduled today (your Japanese / Burmese quick tests, written test) now appear on Top Tasks — just below the priority tasks, above the weekly targets — with their quick links and streak. They ignore mode hours on purpose: they're commute-friendly.
- **Daily test tracking.** Every routine tick is now recorded per day. Routine cards show a 14-day history strip (green = done, red = missed, outlined = today, faded = not scheduled) plus the streak, so you can see at a glance whether the tests are actually happening daily. History starts accumulating from this build.
- **Places — condition-based lists (own tab).** New "Places" tab in the bottom bar (e.g. Shin-Ōkubo with its shopping list). The list surfaces at the top of Today when you tap "Going today" — or automatically when the app opens within ~700 m of the spot (set the coordinates by tapping "Use my location" once while you're there; the 📍 button re-checks on demand). One location fix on open/focus only, no continuous tracking. Items are checkboxes; "Uncheck all" resets for the next visit.
- **Weekly check-in nudge.** Each place can ask you on a chosen day + time (e.g. Friday 18:00): a "Going to Shin-Ōkubo?" card appears at the top of Today from that time — "Yes, today" plans the visit (list surfaces), "Not this time" dismisses it until next week. It's an in-app prompt: you see it when you open the app that evening.
- **Routine categories.** Routines can be grouped (e.g. "Quick tests", "Written tests") — grouped headers on the Routines tab, and the category shows as the chip on Today rows. Type any category in the editor; existing ones auto-suggest.
- **Overdue is its own severity tier.** A missed deadline no longer looks like "due soon": the row turns solid dark red with a growing "OVERDUE · N days" counter, outranks even urgent tasks everywhere, throbs gently, and a banner at the top of Today counts what you've let slip ("the oldest has been waiting 3 days"). It only goes away when you finish, reschedule, or delete the task.
- **Today screen fix.** Top Tasks now includes Special tasks dated today, overdue Special tasks, and urgent tasks (even undated) — ordered urgent → overdue → due today → deadline countdowns → targets → scheduled.

## Data + deploy notes

- **No Supabase migration.** The new per-task fields (`md`, `urg`) and mode hours (`meta.hours`) ride inside the existing entries/board JSON payloads. Old subtasks default to mode `Both`, not urgent.
- Service worker cache bumped to `weekly-focus-v21`. No new files — same asset list as build 16.
- `preview.html` is a seeded demo for design review only — do NOT deploy it.
