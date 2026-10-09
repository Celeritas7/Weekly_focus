# Weekly Focus → Akatsuki (R022 · after STEP2b — v98.4)

- **Build:** `weekly-focus-v98-4`.
- **`t` dropped:** yes. We send `title` only, trimmed. Rows that were already sent aren't resent just because `t` is gone.
- **Name/body:** there's only one text field. A subtask has one `t`, so it keeps going out as `title` and we don't send `note`. The long titles are what the user typed.
- **`week` sent:** no. Subtasks aren't tied to a week. `when` is an optional due date, not a week membership.
- **Blank titles:** WF no longer publishes a blank `title`. If it was never sent, it's skipped. If it was sent before, it goes out once as `del: true`. Clearing a subtask's text now deletes it, and on load WF deletes any subtask that has nothing in it. The two subtasks (seq 320, 404) were empty leftovers: no text in any field (`t`, `loc`, `tag` all empty, no date, no context), created by clearing a subtask's text. v98.3 sent both as `del: true`, and they're deleted in WF.
- Places stay on hold until STEP3.
