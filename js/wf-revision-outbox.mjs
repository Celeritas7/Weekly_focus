// Revision transport is opt-in. Instantiate only for a verified account/board
// with a revision-aware endpoint; the legacy whole-row sender cannot drain it.
export function openTaskOutbox(owner, board, transport) {
  if (!owner || !board) throw new Error("An account and board are required");
  const key = "wf_revision_outbox_v1:" + JSON.stringify([owner, board]);

  async function access(work, write = true) {
    return navigator.locks.request(key, () => {
      const raw = localStorage.getItem(key);
      const state = raw === null ? { snapshots: [], operations: [] } : JSON.parse(raw);
      const result = work(state);
      if (write) localStorage.setItem(key, JSON.stringify(state));
      return result;
    });
  }

  async function observe(item, revision, payload) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid revision");
    await access(state => {
      const snapshot = state.snapshots.find(row => row.item === item);
      if (!snapshot) state.snapshots.push({ item, revision, payload });
      else if (snapshot.revision < revision) Object.assign(snapshot, { revision, payload });
    });
  }

  async function enqueue(item, base, intent, id = crypto.randomUUID()) {
    return access(state => {
      const snapshot = state.snapshots.find(row => row.item === item);
      if (!Number.isSafeInteger(base) || base < 0 || !snapshot || base > snapshot.revision)
        throw new Error("Edit requires an observed revision");
      const existing = state.operations.find(op => op.id === id);
      if (existing) {
        if (existing.item !== item || existing.base !== base ||
            JSON.stringify(existing.intent) !== JSON.stringify(intent)) throw new Error("Operation ID reused");
        return id;
      }
      state.operations.push({ id, item, base, intent, status: "pending" });
      return id;
    });
  }

  // Take a copy. Never consume or mutate the original persisted legacy queue.
  async function preserveLegacy(rows) {
    await access(state => {
      for (const [source, row] of Object.entries(rows)) {
        const item = row.row?.item_key ?? row.match?.item_key;
        const legacyBoard = row.row?.board_id ?? row.match?.board_id;
        if (legacyBoard !== board || row.table !== "weekly_focus_entries" ||
            !/^(app|study|office):/.test(item)) continue;
        if (state.operations.some(op => op.source === source &&
            JSON.stringify(op.intent) === JSON.stringify(row))) continue;
        state.operations.push({ id: crypto.randomUUID(), item, source, intent: row, status: "legacy-draft" });
      }
    });
  }

  async function flush() {
    return navigator.locks.request(key + ":send", async () => {
      const pending = await access(s => s.operations.filter(op => op.status === "pending"), false);
      for (const op of pending) {
        // A lost response leaves the original ID, base and intent on disk.
        const reply = await transport({ owner, board, ...op });
        const committed = ["applied", "replayed"].includes(reply.status);
        if (committed && (!Number.isSafeInteger(reply.version) || reply.version !== op.base + 1))
          throw new Error("Invalid acknowledgment");
        if (!committed && !["conflict", "blocked", "missing", "refused", "id-reused",
                            "missing-precondition", "exists", "deleted"].includes(reply.status))
          throw new Error("Unknown task response");
        await access(state => {
          if (committed) state.operations = state.operations.filter(row => row.id !== op.id);
          else Object.assign(state.operations.find(row => row.id === op.id),
                             { status: "review", reason: reply.status, version: reply.version });
        });
      }
    });
  }
  return { observe, enqueue, preserveLegacy, flush, inspect: () => access(s => s, false) };
}
