# Implementation prompt — Weekly Focus ⇄ Command Centre (Brain v2) bridge

> Hand this whole file to a coding agent (Claude Code, etc.). It is self-contained:
> it states the goal, both live schemas, the exact mapping, the sync loop, and
> acceptance criteria. Do not assume the old bridge is a starting point — see §0.

---

## 0. Context & the thing to get right first

There are two apps sharing **one** Supabase project (`wylxvmkcrexwfpjpbhyy`):

- **Weekly Focus (WF)** — a personal weekly-planning PWA. Its data lives in
  `weekly_focus_entries` (RLS-locked to the signed-in account).
- **Command Centre (CC), "Brain v2"** — a message-bus "brain" that decides which
  *team/squad* should be active right now (schedule + overrides + GPS/time
  triggers + a LIFO interrupt stack) and pushes blockers/alerts to 16 apps.

**A legacy bridge (`wf-cc-bridge.js`) already exists in this folder. Do NOT reuse its
table targets.** It writes to `mind_map_app_tasks`, `mind_map_app_tags`,
`mind_map_app_task_tags`, `mind_map_app_chat_memory` — a task/tag model from an
*older* Command Centre. **The advanced Brain-v2 CC has none of those tables.**
Keep only two ideas from the old bridge: (a) the bridge runs **inside Weekly Focus**
(because only the WF page holds the RLS session that can read `weekly_focus_*`, while
all `command_centre_*` tables accept the shared anon key so the WF page can write them);
and (b) it persists its item→id mapping in a key/value store. Everything else is new.

Deliverable: a single client-side file, `wf-cc-bridge-v2.js`, loaded in WF's
`index.html` after the app + supabase scripts. No server, no new tables beyond the
one optional settings key in §3.

---

## 1. Schemas you are integrating (both live)

### Weekly Focus — `weekly_focus_entries` (read + limited write; RLS to the user)
- `board_id text` — always `'my_week'` (configurable).
- `item_key text` — namespaced, e.g. `office:…`, `app:…`, `study:…`.
- `payload jsonb` — includes at least: `active` (bool, item switched on this week),
  `objective` (string, the target text — wins over the item name for the label),
  `targetDone` (bool, cleared on the board).
  **TODO for implementer:** open the WF payload for a row that is in *The Five* and
  find the flag/ordering it uses (e.g. `inFive`, a `star`, or a `fiveOrder` int).
  The bridge needs it in §2. Do not guess — inspect a real row.
- `updated_at timestamptz`.

### Command Centre Brain v2 — write these (all accept the anon key)
- **`command_centre_active_team`** — singleton row, `id='singleton'`.
  Columns: `active_team text`, `base_team text`, `interrupt_stack jsonb` (LIFO
  `[{team,reason,pushed_at,alert_id}]`), `location text`, `schedule_slot text`,
  `updated_at`. **Only CC writes `active_team`/`interrupt_stack` at runtime** — the
  bridge may set `base_team` (see §2), nothing else here.
- **`command_centre_brain_settings`** — `key text PK`, `value jsonb`.
  Existing keys: `schedule`, `overrides`, `triggers`. The bridge adds one key,
  `wf_focus` (§3).
- **`command_centre_alerts`** — `type, title, message, renderer, data jsonb,
  active bool, snoozed_until, dismissed_at, dismissed_by`. The bridge may *write*
  an alert (e.g. a study nudge tied to a real WF study target) and *read* dismissals.
- **`command_centre_blockers`** — do **not** write. Read-only awareness only.

CC squad/team vocabulary (from the seeded schedule + scheduler): `coding`,
`language_study`, `work`, `exercise`, `food`, `grooming`, `lunch`, `sleep_prep`,
`free`, plus grouped `defender_mid`/`defender`/`mid`. Football metaphor:
**attackers = career/coding, mid = food/exercise/grocery, defenders = fashion/sleep.**

---

## 2. What syncs, and which direction

The bridge translates *WF focus* into the brain's *team/priority* vocabulary — it
does **not** create tasks (there is no tasks table).

| Weekly Focus | dir | Command Centre (Brain v2) |
|---|:--:|---|
| Active `app:` item | → | contributes to squad **`coding`** priority |
| Active `study:` item | → | contributes to squad **`language_study`** priority |
| Active `office:` item | → | contributes to squad **`work`** priority |
| **The Five** membership + order | → | ranked priority list written to `wf_focus` settings key (§3) |
| Top-ranked active WF item's squad | → | optionally set `command_centre_active_team.base_team` (config-gated, default OFF) |
| CC `active_team` == a WF item's squad | ← | reflect "now" onto that WF entry: `payload.ccActive = true` (others `false`) |
| WF `study:` target active & not done | → | gate/annotate the CC `study_nudge` alert so it names the real target |

Mapping resolution (mirror the old bridge's shape, new targets):

```js
var PREFIX_TO_SQUAD = { 'app:': 'coding', 'study:': 'language_study', 'office:': 'work' };
var ITEM_OVERRIDES  = { /* 'app:JLPT Drills': 'language_study' */ };  // exact item_key → squad
function squadFor(itemKey){ return ITEM_OVERRIDES[itemKey]
  || (Object.keys(PREFIX_TO_SQUAD).find(function(p){return itemKey.indexOf(p)===0;})
      ? PREFIX_TO_SQUAD[Object.keys(PREFIX_TO_SQUAD).find(function(p){return itemKey.indexOf(p)===0;})]
      : null); }  // unmapped prefixes are skipped
```

**Decision point (confirm with the owner):** should WF ever *drive* the live
`active_team`? Default: **no** — WF only publishes the `wf_focus` priority feed and
CC's scheduler/overrides decide the active team. Flip `SET_BASE_TEAM_FROM_WF=true`
in config to also set `base_team` to the top WF squad when the interrupt stack is empty.

---

## 3. The `wf_focus` settings key (the priority feed)

The bridge owns exactly one settings row so the brain (scheduler `credit_emergency`,
huddle, override logic) can read what the user committed to this week without touching
WF's RLS-locked tables.

```jsonc
// command_centre_brain_settings where key = 'wf_focus'
{
  "board": "my_week",
  "updated_at": "2026-07-12T…Z",
  "the_five": [                        // ordered, max 5
    { "item_key": "app:Command Centre", "squad": "coding",
      "objective": "Ship the brain bridge", "done": false }
  ],
  "active": [                          // all switched-on items (superset of the_five)
    { "item_key": "study:JLPT N2", "squad": "language_study",
      "objective": "20 kanji/day", "done": false }
  ]
}
```

Rules: recompute on every sync from the current WF rows; write only if changed
(diff the JSON to avoid needless `updated_at` churn). Do not delete the key when WF
is empty — write empty arrays.

---

## 4. Mapping persistence

Persist `item_key → { ccAlertId?, lastSquad, lastState }` so the bridge can (a) find
the study-nudge alert it created, (b) detect a squad change, and (c) clear
`payload.ccActive` when the brain moves on. Store it in `command_centre_brain_settings`
under key `wf_cc_bridge_map` (same table, avoids a new table). Never store secrets.

---

## 5. Sync loop (every 60s; expose `WF_CC_SYNC.now()`)

```
1. Read WF: weekly_focus_entries where board_id = cfg.board.
   (If signed out, RLS returns error/empty → skip this pass silently.)
2. Read CC: active_team singleton + brain_settings(wf_focus, wf_cc_bridge_map)
   + active alerts.
3. Build the priority feed (§3) from active items + The Five; diff → write wf_focus.
4. CC → WF reflection: for each WF item, set payload.ccActive =
   (squadFor(item_key) === active_team.active_team). Write only changed rows.
5. Study-nudge coupling: if active_team is a study squad AND a study: item is
   active & not done, upsert/keep one alert (renderer 'nudge') naming the objective;
   when no study target qualifies, deactivate the bridge's own alert. Never touch
   alerts the bridge didn't create (track via wf_cc_bridge_map).
6. (Optional, gated) SET_BASE_TEAM_FROM_WF: if interrupt_stack empty, set base_team.
7. Persist wf_cc_bridge_map; dispatch window event 'wf-cc-synced'.
```

Guardrails: single-flight (`busy` flag), try/catch that only `console.warn`s (never
throws into the WF app), first pass ~4s after load, `crypto.randomUUID()` for ids,
ISO timestamps. Reuse WF's existing supabase client if it exposed one
(`window.__wfSb`), else create from `window.WF_CONFIG`.

---

## 6. Config block (top of file, documented)

```js
var SYNC_INTERVAL = 60000;
var BOARD = 'my_week';
var PREFIX_TO_SQUAD = { 'app:':'coding', 'study:':'language_study', 'office:':'work' };
var ITEM_OVERRIDES = {};
var SET_BASE_TEAM_FROM_WF = false;   // see §2 decision point
var COUPLE_STUDY_NUDGE = true;       // §5 step 5
```

---

## 7. Install

1. Copy `wf-cc-bridge-v2.js` into the Weekly Focus repo root (next to `weekly-focus-app.js`).
2. In WF `index.html`, after the app + supabase scripts:
   `<script src="wf-cc-bridge-v2.js"></script>`
3. Bump the service-worker cache version, commit, push.

---

## 8. Acceptance criteria

- Switching a WF `app:`/`study:`/`office:` item **on** adds it to `wf_focus.active`
  with the correct squad within one sync cycle; switching it off removes it.
- Promoting an item to **The Five** puts it in `wf_focus.the_five` in the right order.
- When CC's `active_team` equals a WF item's squad, that item's `payload.ccActive`
  becomes `true` and all others `false`; changing squads flips exactly the two rows.
- With `COUPLE_STUDY_NUDGE=true`, the `study_nudge` alert names a real active study
  objective; with no eligible study target, the bridge's nudge is not shown.
- No writes to `command_centre_blockers`; no writes to `active_team.active_team` or
  `interrupt_stack`; `base_team` written **only** when `SET_BASE_TEAM_FROM_WF=true`
  and the stack is empty.
- Signed-out WF page: bridge no-ops quietly (one warn max per pass), never blocks the app.
- Idle diff: with no WF changes, a sync pass writes nothing (no `updated_at` churn).
- `WF_CC_SYNC.now()` forces a pass; `wf-cc-synced` fires after each successful pass.

---

## 9. Out of scope (v2, deliberate)

- No subtask-level sync (WF checklists ⇄ CC). Clean next step if wanted.
- No GPS/time trigger logic in the bridge — that stays in CC's trigger engine.
- The bridge never *pops* the interrupt stack or dismisses CC-authored alerts/blockers.
- CC's credit/override math is unchanged; the bridge only *feeds* `wf_focus` for it to read.
