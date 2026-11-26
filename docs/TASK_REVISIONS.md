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

### Phase 3D — browser outbox prototype

The revision-aware outbox in `js/wf-revision-outbox.mjs` uses separate account/board storage and serializes tab writes with Web Locks. Capture the base from the view where the edit was made. Pulls update the confirmed snapshot independently. Conflicts and unversioned legacy task drafts survive reconnect and reload. After a committed response, pull the authoritative snapshot before using the new revision for another edit. Storage errors propagate to the caller. The existing app sender is still in use until the server and all shared writers are ready.

Run the PostgreSQL suite with `WF_BROWSER_QUEUE=1`, Python Playwright installed and `CHROMIUM_BIN` set to a Chromium executable. Two Chromium contexts exercise the client against real PostgreSQL transactions on loopback. No hosted account or phone is used.

### Batch A — shared writers and recovery

The second stacked PR extends the disposable server with an atomic batch endpoint. The browser queue can persist an explicit list of changes, each with its original observed base. Observe revision zero only for a confirmed absent item. Clients must route batch operations to the batch endpoint and single edits to the narrow task endpoint. Review drafts retain the complete input, including refused imports. Both endpoints take the same owner/board transaction lock. This deliberately favors correctness over throughput in the prototype.

- Import uses create-if-absent. Repeated delivery reuses a receipt. Different imports aimed at existing identities conflict. A true imported CC flag requires reconciliation by the trusted bridge.
- Bulk completion, delete and restore either commit together or roll back together. An item tombstone retains its payload. Closing a board requires an exact inventory of its active items and prevents late recreation, including new keys.
- The Roadmap adapter needs the original request ID and observed revision. A lost commit response or failed hub reply retries with the same ID. The CC adapter refetches its observations after a conflict and writes only its flag.
- These adapters and database fixtures are isolated from the current production senders. The live hub must supply a stable request ID and original revision, and the trusted CC reader and hosted endpoints still need to be provisioned and verified. Before enabling the new paths, integrate the review UI and cut over every writer together with server-side rejection of old writes. Closed-board recovery, existing-item import reconciliation, hosted limits and physical device acceptance remain rollout work.

### Batch B — sync rollout readiness

**Decision: keep the current sync path active.** Read-only catalog checks confirmed owner-based row policies on the existing entry table and direct write privileges for signed-in users. Owner isolation does not check the original revision of an offline edit. The current sender and bridge still submit whole payloads. The new queue and narrow writer adapters remain prototypes. Existing owner-guard and history triggers must be preserved and verified during integration.

The disposable database runner now backs up its populated fixture with pg_dump and restores it into a new empty database in one transaction. It compares all fixture records, including payloads, revisions, receipts, deleted entries and closed boards, checks a direct-write restriction and retries a committed operation with an authenticated fixture session. Roles already exist in this cluster. This tests database-level recovery of synthetic task state. A full hosted-project restore, auth/role recovery, real backup verification and client-side draft recovery are separate checks. CI includes PostgreSQL 17.6 to match the hosted engine version.

**Next implementation:** connect the new task sender, pull and conflict-review paths to revision-aware endpoints in an isolated app deployment. Route the trusted CC writer and Roadmap acknowledgments through the same commit boundary. Exercise the existing owner/history triggers and old clients before proposing a production migration.

**Physical acceptance on the isolated deployment:** start from the same unfinished test task on both devices. Go offline on desktop and complete it. On the online phone, complete it and then reopen it. Reconnect desktop and verify the phone's reopen survives, the desktop edit appears for review, and retrying adds no second completion. Repeat with devices reversed. Production activation requires separate approval.

### Isolated app sync preview

With the same local prerequisites as the database rehearsal, run
`WF_SYNC_PILOT_PORT=8768 python tests/task-db/check.py` and open
`http://localhost:8768`. The runner creates a temporary database and serves the
Weekly Focus UI with one synthetic task. Keep the process running during the
check. Use **Open sample task** and its normal completion checkbox. For an
Android phone connected to the development computer by USB with debugging
enabled, `adb reverse tcp:8768 tcp:8768` makes that same localhost URL available
in Android Chrome. Each device has its own outbox. Stop the runner with Ctrl+C.

Disconnect one browser after opening the sample and complete the task there.
Complete and reopen it on the connected device, then reconnect the first.
The review strip shows the saved and pending values. **Keep saved task** discards
only that draft. **Apply my edit** sends a new intent based on the reviewed
revision. **Sync now** pulls changes from the other device.

The preview covers the single flat checklist toggle; authentication is synthetic.
The preview server binds to loopback, serves a restricted asset set and accepts
only this task operation. Preview assets are outside the production shell and
the production app receives no preview seed. The browser suite runs this
scenario twice with the two device roles exchanged.

### Branch archive and restore

In the isolated sync preview, open the sample task's full card and expand
**Archive / restore tasks**. Archiving removes the branch from active progress.
Restoring an unfinished branch reopens completed ancestors in the same
revision. An independently archived child stays archived. The operation keeps
the task ID, notes, source and completion history. It uses the existing queue,
conflict review and replay receipts.

On a regular board the full card lists previously archived branch roots under
**Archived branches**. Archive writes require the revision-aware transport,
currently enabled in the isolated preview only.

### Manual repeat in the isolated sync preview

Complete the sample checklist, then choose **Start next checklist**. The preview
shows the number of finished runs and the last run's completed/total count.
The revision-checked operation records the finished task IDs and titles, then
reopens the same tasks in one transaction. Task notes, ratings and existing
history stay on the tasks. An offline request waits for confirmation. A stale
request goes to review and requires a fresh choice after reviewing the saved run.

This phase supports explicitly repeatable, flat Weekly Focus checklists.
Scheduling, nested or shared recurring tasks, reminder dispatch and live-board
activation are separate work. The test database uses synthetic records only.

### Nested repeat checklists in the sync pilot

The sample now includes a parent, a child and an archived branch. Complete
the active child, complete its parent and select **Start next checklist**.
The completed run records one leaf. Both active rows reopen. Archived and
deleted branches keep their values, and reopening a child during a run also
reopens its completed ancestors. Cycles, missing parents, ambiguous IDs and
shared-source checklists cannot start a run. Scheduling and live-board
activation remain separate work.
