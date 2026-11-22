# Phase 3A — Shared task revisions

Scope: design and executable examples for task-bearing app, study and office entries. The current flat task format, nesting guard and production writers still run as before. The Code board has its own synchronization protocol.

## Writer trace

| Path audited | Current behavior | Required boundary |
| --- | --- | --- |
| Weekly Focus UI → `patch` → `cloudPushEntry` → `queue` → `flushOutbox` in js/weekly-focus-app.js | Validates a local transition, coalesces by entry key and upserts an entire payload. Waiting for the first pull checks format, but another device can commit between pull and upsert. | WF owns checklist state. Persist the original base revision with each pending intent, including deletion. |
| `cloudPullEntries` and `mergeSubs` | Overlays pending scalar fields and merges subtree records. Device clocks and legacy equal-clock completion rules cannot distinguish a stale completion from a later reopen. | Keep the remote baseline and pending intent separately until confirmation. |
| Roadmap public/akatsuki/rm-adapter.js at 8eda969, WF `rmSync` and `rmApply` | WF publishes task projections addressed by board, item and subtask. Roadmap sends task.done/task.skipped via the hub. WF replies after a successful local patch, ahead of cloud confirmation. | Roadmap owns the request. WF validates the observed revision, applies done/park under its own authority and replies after commit. Carry the originating request identity through retries. |
| js/wf-cc-bridge-v2.js, CC reflection step 4 | Reads a snapshot, replaces its payload with a copy containing a changed ccActive flag. This bypasses the task outbox. | Only ccActive belongs to this writer. Recompute the desired flag on conflict and patch just that field atomically. |
| Akatsuki reminders and weekly outcomes | Reminder identities, task source references and the manual weekly targetDone field serve separate workflows. | Completing/snoozing a reminder or confirming the week's outcome grants no authority to edit task completion. Preserve source links. |

## Proposed commit contract

Use a server-assigned revision per (authenticated user, board_id, item_key), plus the existing stable sub_id for task actions. A whole-entry revision intentionally favors detectable conflicts over silent overwrites. Two independent edits may initially conflict. Weekly Focus should retain the pending draft for review.

1. A client stores a stable operation ID, address, intended change and last confirmed revision in its persistent outbox. Reopening the app or refreshing the board must preserve that original base. Freeze an operation after its first send; later edits require separate IDs.
2. In one database transaction verify identity, board access and the permitted writer/field using trusted server authorization. Look up a receipt scoped to the authenticated actor, writer, entry and operation ID. An exact replay returns the original acknowledgment; reuse with a different intent is refused.
3. Compare the base with the current revision under a lock or conditional write. A mismatch returns a conflict and current revision. Never automatically rebase a completion, reopen or delete. A user can review the latest state and submit a fresh intent. A missing base on a legacy queued snapshot requires reconciliation.
4. Validate against the authoritative current task tree using the Phase 2 rules. Apply only owned fields, advance the revision and persist the receipt atomically. Keep tombstones revisioned to prevent stale recreation. Define an explicit create-if-absent operation for genuinely new entries.
5. Send acknowledgments and publish downstream changes only after a durable commit. Retry after a lost response using the same ID. Legacy requests lacking an observed revision must be held for reconciliation if their freshness cannot be established.

## Reproduction and rollout

Run `node --test tests/task-revision-contract.cjs`. The isolated one-entry transaction model uses the existing task engine. It tests an offline PC completion racing a phone completion/reopen, a lost acknowledgment, ID reuse, CC reflection, and legacy or unauthorized writes. The writer argument represents an already authenticated authority in the fixture. These examples do not exercise PostgreSQL locks, RLS, browsers or physical devices.

Phase 3B should prototype the atomic write and receipt contract in isolation, exercise two real concurrent database sessions and lost responses, and design the transition for old clients and queued data. Audit direct deletes (including board deletion), imports, restore and outside writers before enforcement. Verify authenticated authority for CC rather than trusting a client-supplied writer string. Keep nesting gated until the engine, outboxes, bridge, Roadmap acknowledgments and legacy-write protections work together. Any production migration requires separate approval.

## Phase 3B — isolated database results

The fixture in `tests/task-db` creates a disposable loopback PostgreSQL cluster, creates separate password-authenticated PC, phone and CC sessions, and seeds one synthetic entry. The runner waits for PostgreSQL to report a blocked writer before committing the winning transaction. Run as a non-root user with PostgreSQL's initdb and pg_ctl on PATH, Python 3 and psycopg 3:

    python tests/task-db/check.py

Verified on PostgreSQL 16.2. The offline completion returned conflict at revision 10 after the phone reopened the task. Replaying a previously committed operation returned its original revision. Changing its intent under the same ID was rejected. Two simultaneous deliveries of one operation advanced the revision once. Rolling back removed the edit and its receipt together. CC's stale reflection conflicted and its fresh flag update preserved task state, source and notes.

The prototype covers existing flat tasks only. Dedicated PostgreSQL logins stand in for application authority. These results establish locking and receipt behavior, not hosted Supabase authentication, RLS parity or end-to-end phone behavior.

### Transition before enforcement

1. Prototype hosted-style actor resolution in isolation. Ordinary user credentials shared across apps cannot authenticate a CC writer by themselves. Test two owners and all grant paths.
2. Extend the client outbox with the original base revision, stable operation ID and separate confirmed snapshot. Keep unversioned pending writes as reviewable drafts. Never assign today's revision to yesterday's queued payload.
3. Exercise create/delete tombstones, bulk changes, imports, restores and board deletion. Migrate CC to a narrow flag operation and Roadmap to commit-based replies. Reject stale legacy whole-entry writes at the server before permitting nested editing.
4. Validate on the target PostgreSQL version with a restore rehearsal and rollback plan. Seek separate approval for any production migration.

## Phase 3C — owner and writer permissions

The disposable PostgreSQL suite now runs a second permission configuration after the concurrency tests. Run the same command above. The authenticated role has two entry points: read a single owned entry and submit a revision-checked checklist edit. The trusted test gateway selects the authenticated database role and supplies the owner's UUID as a transaction-local subject. The bridge has a separate login bound to one owner and can submit only a flag edit. Neither role has direct table grants.

On PostgreSQL 16.2 two owners independently edited the same board/item and reused an operation ID. An item present only under the second owner was absent from the first owner's reads and writes. Missing and malformed claims failed closed, including a request on a reused connection. A bridge update advanced only the assigned owner's revision. The suite checks function privileges for the gateway, anonymous, authenticated, bridge and retired device roles.

**Deployment boundary.** The fixture simulates an already authenticated gateway. It does not verify signed tokens, run PostgREST or exercise the hosted project's grants or RLS policies. The current browser bridge uses the Weekly Focus user's session and writes a full payload. Before deployment, a trusted server-side bridge would need to derive its owner binding from a verified account, keep its credential off the client and recompute the desired flag. The prototype's single-owner login demonstrates the restriction only. The current app and its offline queue still use their existing write paths.

**Next phase.** Prototype the client outbox transition with a stable operation ID, original base revision and confirmed snapshot. Test offline reopen, retry after lost acknowledgment and preservation of legacy unversioned drafts before enabling the new writes.
