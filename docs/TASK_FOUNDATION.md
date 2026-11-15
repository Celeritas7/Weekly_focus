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

## Validation

Run from the repository root:

```sh
node --test tests/task-data.cjs
node tests/task-reminders.cjs
node --check js/weekly-focus-app.js
node --check js/wf-task-data.js
```

Compatibility fixtures are synthetic and contain no account or production data.
The existing `tests/details.html` fixture loads the new module before the app.
The Sphere fixture remains unchanged. Browser launch was attempted during
Phase 1 but the execution environment denied Chromium's socket operation;
layout and physical-phone checks are pending. Merging is not deployment or
device verification.
