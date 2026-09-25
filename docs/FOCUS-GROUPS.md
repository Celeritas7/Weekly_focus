# Weekly Focus — focus groups (for you and for Claude)

Temporary groups of apps, used to decide what gets developed next. They're stored in Supabase, so Weekly Focus (WF) and Claude both read and write the same data. WF picks up changes within 15 seconds.

## Model
- **Group:** a name, an optional note (the goal), a **focus** star, and **archived** yes/no.
- **Membership:** an app can be in several groups at once (v91). In the Focus view it appears under each of them.
- **Focus:** starred groups show first on the Week tab (View → **Focus**).
- **Archive:** hides the group. An app disappears from Week, Today, the Build band, the Calendar and The Five only when **every** group it is in is archived. Their tasks, ranks and flags are not touched. **Restore** brings them back, but they don't return to The Five, so star them again.

## Setup (once)
1. Supabase → SQL Editor → run `docs/focus-groups.sql`.
2. Optional: run `docs/focus-groups-seed.sql` for three starter groups.

## For Claude: rules
- Start with `select * from wf_group_list();` and never guess group or app names.
- Refer to apps by their **name** as shown in `weekly_focus_apps_v`. The functions resolve names for you.
- Only use the `wf_group_*` functions. **Never** write to `weekly_focus_entries` or `weekly_focus_inventory`.
- To **move** an app between groups, add it to the new one and remove it from the old one; adding alone keeps both.
- Archiving is reversible, so it's fine when asked. Only run `wf_group_delete` when the user explicitly says delete.
- After a change, show `wf_group_list()` again so the user can see the result.

## Functions
| call | does |
|---|---|
| `select * from wf_group_list();` | every group, with its app count, app names, focus and archived state |
| `select app, category, groups, hidden from weekly_focus_apps_v order by groups, app;` | every app with its category, `on_week`, `update_flag`, `rank`, its `groups` (comma list) and whether it is `hidden` |
| `select wf_group_create('Name', array['App A','App B'], 'goal note', false);` | creates a group (or reuses a live one with the same name), then fills it. Returns the id |
| `select * from wf_group_add('Name', array['App C']);` | adds apps; they keep their other groups. Result per app: `added`, `already in` or `not found` |
| `select wf_group_remove(array['App C'], 'Name');` | takes those apps out of that one group |
| `select wf_group_remove(array['App C']);` | takes those apps out of every group |
| `select wf_group_focus('Name', true);` | stars (`true`) or unstars (`false`) a group |
| `select wf_group_archive('Name');` / `select wf_group_restore('Name');` | hides or unhides the whole group |
| `select wf_group_rename('Old', 'New', 'new note');` | renames a group and optionally changes its note |
| `select wf_group_delete('Name');` | deletes the group. Its apps keep their other groups |

All functions take an optional last argument `p_board`. Leave it out: it defaults to your most recently updated board.

## Example requests to Claude
- "Group my coding apps and put them in focus." → `wf_group_list`, then `weekly_focus_apps_v`, then `wf_group_create(..., true)`.
- "Archive Language study for two weeks." → `wf_group_archive('Language study')`. Claude can't schedule the restore; ask again later.
- "What's in focus right now?" → `wf_group_list` filtered to `focus = true`.
