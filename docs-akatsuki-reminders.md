# Akatsuki source-task reminders

Phase 5 adds a Reminder schedule/status control to tasks. It opens the shared Akatsuki editor and reads the latest shared state. Existing native due dates and completion checkboxes are unchanged; reminders are explicitly configured by the user.

Weekly Focus identity is `source_app=wf`, `source_task_id=JSON.stringify([board_id,item_key,sub_id])`. Roadmap mirrors use the exact same identity after resolving their original Weekly Focus address. Native Roadmap tasks use `source_app=rm`, `source_task_id=task:<uuid>`. Titles are never keys. Missing or orphaned mirror links fail rather than creating a duplicate native reminder.

The integration reuses deployed R074; no SQL changes or automatic migration are needed. The editor reads the original owner's state through the app's authenticated session. Signed-out users cannot schedule; source dialogs are removed on sign-out. The existing server transaction protects against duplicate active occurrences and stale occurrence replacement.

Validation: source identity/sign-in/deleted-item tests in Weekly Focus; native/mirror/missing-link/orphan tests and production TypeScript/Vite build in Roadmap. Chromium launch was attempted but failed in this execution environment; real-device layout and cross-app notification checks remain pending. Albert reminder storage has not been identified, and legacy reminder migration is not part of this batch.
