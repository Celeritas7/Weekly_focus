# v94 — Focus view is the default (Phase 4)

Copy these over the ones in `Weekly_focus/`, then reload:
- `js/weekly-focus-app.js`
- `sw.js` (cache `weekly-focus-v93` → `weekly-focus-v94`)

## Behaviour
- A device that has never picked a view opens the Week tab in **Focus**.
- A device that already picked one keeps it:
  - If you picked Flat or Focus, it stays that way.
  - If you had **Groups** on before v90 (so Focus was never saved), it stays on Groups.
- Your choice is saved as soon as you tap Flat, Groups or Focus, as before.

**Note:** this device has already saved a choice (you switched views while testing), so it keeps whatever you last picked. To see the new default here, tap Focus once, or clear `wf2_view_focus` for this site.
