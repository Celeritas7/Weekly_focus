# Weekly Focus ⇄ Command Centre — sync bridge

Both apps share one Supabase project (\`wylxvmkcrexwfpjpbhyy\`), so sync is a single client-side file — **no new tables, no server, no schema migration**.

## Why the bridge lives in Weekly Focus
- \`weekly_focus_*\` tables are RLS-locked to your signed-in account → only the WF page has that session.
- Command Centre's tables (\`mind_map_app_tasks\`, \`mind_map_app_tags\`, \`mind_map_app_task_tags\`, \`mind_map_app_chat_memory\`) use permissive anon policies → the WF page can write them directly.

## Install (2 steps)
1. Copy \`wf-cc-bridge.js\` into your Weekly Focus repo root (next to \`weekly-focus-app.js\`).
2. In \`index.html\`, after the app script, add:
   \`<script src="wf-cc-bridge.js"></script>\`
   Commit + push (bump the sw.js cache version as usual).

## What syncs
| Weekly Focus | direction | Command Centre |
|---|---|---|
| Active item (office:) | → | Task under **Office** category |
| Active item (app:) | → | Task under **Career** (⚔️ Attackers ball) |
| Active item (study:) | → | Task under **Study** (🏃 Midfield ball) |
| Objective text | → | Task name (\`[WF]\` prefix) |
| Item switched off / deleted | → | CC task archived (marked done) |
| CC task marked done | ← | WF entry \`targetDone: true\` (cleared on board) |

- Mapping \`item_key → task_id\` persists in \`mind_map_app_chat_memory\` (key \`cf_wf_sync\`).
- Edit \`PREFIX_TO_CATEGORY\` / \`ITEM_OVERRIDES\` at the top of the file to change which pitch ball an item lands on.
- Polls every 60s; force with \`WF_CC_SYNC.now()\` in the console; listen for the \`wf-cc-synced\` event to refresh UI.

## v1 scope (deliberate)
- Item-level sync only. Subtask-level sync (WF checklist ⇄ CC task checkmarks) is a clean next step — say the word.
- The Five ordering stays WF-only; CC just sees the tasks.
- CC-native tasks (no \`[WF]\` mapping) are never touched.
