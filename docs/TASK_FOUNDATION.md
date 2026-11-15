# Task foundation rollout

Batch A contains two stacked, independently reviewable changes. Merge Phase 1
before Phase 2. No production SQL is included or applied.

## Phase 1 — compatibility

`wf-task-data.js` preserves JSON extension fields during normalization, merge
and serialization. Existing task IDs (including legacy text-derived IDs),
`src`, notes, ratings and completion-history fields are retained. Signatures
include all fields so a metadata-only change participates in convergence.
Repeated records with ambiguous IDs are detected, not silently given new IDs.

Supported production writes remain the existing flat task format (version 1;
an absent version is legacy version 1). A newer version, parent relationship,
archived task branch, or occurrence ID makes the entry read-only in this build.
Raw records remain available to backup export. Unsafe outbox entries remain
queued. A remote read-only record cannot be overwritten by a pending local
overlay; task replay waits for the initial cloud pull. Roadmap publication and
completion requests also respect the hold rather than acknowledging an edit
that was not applied.

### Writers and rollout boundary

| Writer | Current boundary | Follow-up |
| --- | --- | --- |
| UI, details, Today/Calendar and Roadmap `rmApply` | `patch` plus cloud queue/flush checks | Phase 2 central task rules |
| Pull/merge and persistent outbox | Preserve unknown fields; check remote format before replay | Phase 3 revision checks and concurrent-device protocol |
| Inventory deletion and task tombstones | Guard ambiguous/newer task entries | Retain deletion identities across shared consumers |
| CC bridge (`wf-cc-bridge-v2.js`) | Reads and replaces a whole entry payload when `ccActive` changes | Phase 3 narrow/guarded write; not solved by normalizer changes |
| Code tab | Separate `wf-code` board and payloads; unchanged | Keep excluded from task migration |
| Older deployed clients and external writers | Cannot acquire new client guards retroactively | Server-enforced version/revision gate before nesting rollout |

The stale-build check in this build holds all queued writes, including task
entries. It cannot stop an already-deployed older build writing to the server.
Nested editing must stay disabled until the shared contract and writer rollout
are complete. A future database change requires approval, a new migration,
live-definition preconditions, isolated validation and a rollback plan.

Equal-clock legacy merges keep the former `done = a.done || b.done` semantics.
They now have deterministic tie selection and preserve provenance, but this is
not a concurrency solution for simultaneous completion/reopen. Phase 3 must
introduce operation/revision ordering rather than rely on device wall clocks.
Absent extension fields are retained from the other copy; intentional clearing
must use an explicit value such as `null`, not omission. Source provenance is
retained when a legacy writer omits it.

## Phase 2 — task rules

`wf-task-engine.js` is a pure, immutable engine over the existing subtask IDs.
The app's shared `patch` path invokes its transition validator for checklist
changes. The existing compact `subProgress` counts use its progress result.
No database columns, task copies, reminder registrations or production nesting
controls are introduced. Parent/archived/occurrence records remain read-only
under Phase 1's rollout gate until Phase 3 protects all shared writers.

Rules:

- An active task can be marked done only when all active descendants, including
  intermediate parents, are done. Completing the last child enables its parent;
  it does not automatically confirm the parent.
- Reopening, restoring, adding or moving unfinished work reopens completed
  ancestors in the same edit. Changed records receive one monotonic edit time.
- Archived and deleted branches contribute no active work. Each descendant's
  own archived flag survives a parent restore. Parked (`lat`) work still counts
  and blocks completion, but is absent from the engine's actionable set.
- Removal retains a tombstone, ID and metadata. Archive restore is distinct
  from deleted-record recovery. Invalid IDs, duplicates, missing parents and
  cycles block edits; input order does not define ancestry.
- Unknown fields, provenance and existing history are retained. This phase does
  not create a new completion ledger or recurring occurrence/reset mechanism.

Progress counts unique active terminal tasks, never both a parent and its
children. A wrapper whose children are all archived remains a wrapper and does
not become an extra unit of work. An empty active checklist has no percentage.

| Example | Result |
| --- | --- |
| Parent P has group G (A done, B open) and C done | P: 2/3 (67%); G and B block parent completion |
| Add a separate completed task D to that collection | 3/4 (75%), with neither P nor G counted again |
| A, B, C done but G unconfirmed | 3/3 checklist work; G still blocks P's explicit completion |
| Archive G and its branch | P: 1/1; restoring unfinished G reopens P |
| A task has never had children | No checklist, not a completed 0/0 checklist |
| All children are archived/deleted | No active checklist; no artificial 100% |

Collection counts are a foundation for goal aggregation. Selecting the same
stable task from multiple weeks/goals must be deduplicated by the future scoped
reference adapter; that adapter and historical weekly snapshots are not in this
phase. The existing manual `targetDone` remains an independent weekly outcome.
Reminder completion/snooze behavior and reminder source identities are unchanged.

### Completion entry points

| Entry point | Coverage |
| --- | --- |
| Five, details, special lists, timeline, flow, agenda (`subtoggle`) | Shared `patch` validator; disabled completion attributes |
| Today and Calendar (`sub2`) | Same validator and disabled attributes |
| For later (`latdone`) | Same validator; parked work can still be explicitly completed |
| Roadmap request (`rmApply`) | Defers a rejected edit instead of replying applied |
| Bulk updates | Engine validates the complete proposed state; no checklist bulk UI currently exists |
| Tree view | Engine handles arbitrary depth; tree UI is a later phase |

The eight completion renderers expose disabled/ARIA state, and details explain
a read-only entry. Failed new-item, settings and expanded-editor saves retain
the draft rather than clearing it or reporting success. Existing tree-less
screens are not a complete UI for imported hierarchical records.

These are local transition rules, not a server concurrency guarantee. Before
enabling nesting, Phase 3 must validate remote merge/replay operations against
the same rules and implement ownership/revision checks across all writers.
Recurring-task resets, goal references, history snapshots, tree controls and
urgent-deadline/reminder coordination remain later work.

## Validation

Run from the repository root:

```sh
node --test tests/task-data.cjs tests/task-engine.cjs
node tests/task-reminders.cjs
node --check js/weekly-focus-app.js
node --check js/wf-task-data.js
node --check js/wf-task-engine.js
```

Compatibility and engine fixtures are synthetic and contain no account or production data.
Engine tests include a 2,500-level tree, archive/restore, bulk validation and the
real app handler bodies in a VM. A test-only permissive format guard exercises
nesting through these handlers; production retains the Phase 1 gate.
The existing `tests/details.html` fixture loads the new module before the app.
The Sphere fixture remains unchanged. Browser launch was attempted during
Phase 1 but the execution environment denied Chromium's socket operation;
layout and physical-phone checks are pending. Merging is not deployment or
device verification.
