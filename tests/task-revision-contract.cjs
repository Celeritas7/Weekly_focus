// Phase 3A reference transaction for one authenticated user's Weekly Focus entry.
// The synchronous fixture models one atomic server decision. It is never shipped.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../js/wf-task-engine.js");

function fixture() {
  let revision = 8;
  let payload = { notes: "keep", ccActive: false, subtasks: [{ id: "leaf", t: "Read", done: false, u: 1 }] };
  const receipts = new Map();
  function submit(writer, id, base, field, value) {
    const key = JSON.stringify([writer, id]);
    const intent = JSON.stringify([base, field, value]);
    const receipt = receipts.get(key);
    if (receipt) return receipt.intent === intent ? receipt.result : "id-reused";
    if (!id || !Number.isSafeInteger(base) || base < 0) return "missing-precondition";
    if (!((writer === "wf" && field === "done") || (writer === "cc" && field === "ccActive")) ||
        typeof value !== "boolean") return "refused";
    if (revision !== base) return "conflict";
    if (field === "ccActive") payload = { ...payload, ccActive: value };
    else {
      const edit = engine.command(payload.subtasks, { type: "done", id: "leaf", done: value });
      if (!edit.ok) return "blocked";
      payload = { ...payload, subtasks: edit.items };
    }
    const result = ++revision;
    receipts.set(key, { intent, result });
    return result;
  }
  return { submit, read: () => ({ revision, payload: structuredClone(payload) }) };
}

test("offline PC completion cannot overwrite Android completion followed by reopen", () => {
  const entry = fixture(), pcBase = entry.read().revision;
  assert.equal(entry.submit("wf", "phone-done", pcBase, "done", true), 9);
  assert.equal(entry.submit("wf", "phone-reopen", 9, "done", false), 10);
  assert.equal(entry.submit("wf", "pc-done", pcBase, "done", true), "conflict");
  assert.equal(entry.read().payload.subtasks[0].done, false);
  assert.equal(entry.read().revision, 10);
  assert.equal(entry.submit("wf", "phone-done", 8, "done", true), 9);
  assert.equal(entry.submit("wf", "phone-done", 10, "done", true), "id-reused");
  assert.equal(entry.read().revision, 10);
});

test("CC recomputes after a conflict and changes only ccActive", () => {
  const entry = fixture();
  entry.submit("wf", "edit", 8, "done", true);
  const before = entry.read();
  assert.equal(entry.submit("cc", "flag", 8, "ccActive", true), "conflict");
  assert.equal(entry.submit("cc", "flag-new", 9, "ccActive", true), 10);
  assert.deepEqual(entry.read().payload, { ...before.payload, ccActive: true });
});

test("legacy writes and direct edits by a consumer cannot replace the task", () => {
  const entry = fixture(), before = entry.read();
  assert.equal(entry.submit("wf", "legacy", null, "done", true), "missing-precondition");
  for (const writer of ["rm", "ak", "cc"])
    assert.equal(entry.submit(writer, "request", 8, "done", true), "refused");
  assert.deepEqual(entry.read(), before);
});
