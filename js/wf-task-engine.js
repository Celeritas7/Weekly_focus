/* Nested task rules. Pure and immutable; storage/ownership/reminders belong to adapters. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./wf-task-data.js"));
  else root.WFTaskEngine = factory(root.WFTaskData);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Data) {
  "use strict";
  if (!Data) throw new Error("Task data module is required");
  function analyze(items) {
    var issues = Data.inspect(items), nodes = Data.normalize(items), byId = new Map(), children = new Map();
    nodes.forEach(function (n) { byId.set(String(n.id), n); children.set(String(n.id), []); });
    nodes.forEach(function (n) {
      if (n.parentId == null) return;
      var parent = String(n.parentId);
      if (!byId.has(parent)) issues.push({ code: "missing-parent", id: n.id, parentId: n.parentId });
      else children.get(parent).push(String(n.id));
    });
    // Iterative walks handle imported order and deep trees without call-stack overflow.
    var finished = new Set();
    nodes.forEach(function (n) {
      var id = String(n.id), path = new Set();
      while (byId.has(id) && !finished.has(id)) {
        if (path.has(id)) { issues.push({ code: "cycle", id: id }); break; }
        path.add(id); var parent = byId.get(id).parentId;
        if (parent == null) break;
        id = String(parent);
      }
      path.forEach(function (key) { finished.add(key); });
    });
    var order = [], active = new Set(), actionable = new Set();
    if (!issues.length) {
      var stack = nodes.filter(function (n) { return n.parentId == null; }).map(function (n) { return String(n.id); }).reverse();
      while (stack.length) {
        var key = stack.pop(), node = byId.get(key), parentKey = node.parentId == null ? null : String(node.parentId);
        order.push(key);
        if (!node.del && !node.archived && (parentKey === null || active.has(parentKey))) {
          active.add(key);
          if (!node.lat && (parentKey === null || actionable.has(parentKey))) actionable.add(key);
        }
        var kids = children.get(key);
        for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    return { nodes: nodes, byId: byId, children: children, order: order, active: active, actionable: actionable, issues: issues };
  }
  function descendants(graph, id) {
    var out = [], stack = (graph.children.get(String(id)) || []).slice().reverse();
    while (stack.length) {
      var key = stack.pop();
      if (!graph.active.has(key)) continue;
      out.push(key); var kids = graph.children.get(key);
      for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }
  function completion(items, id) {
    var g = analyze(items), key = String(id), blocked = [];
    if (!g.issues.length && g.active.has(key)) blocked = descendants(g, key).filter(function (k) { return !g.byId.get(k).done; });
    return { allowed: !g.issues.length && g.active.has(key) && !blocked.length, blockerIds: blocked, issues: g.issues,
      reason: g.issues.length ? "Repair the checklist references first." : !g.active.has(key) ? "This task is archived, deleted or unavailable." : blocked.length ? "Finish the nested subtasks first." : "" };
  }
  function progress(items, id) {
    var g = analyze(items), scoped = id != null, key = String(id);
    var result = { done: 0, total: 0, pct: null, kind: "none", blockerIds: [], issues: g.issues };
    if (scoped && !g.byId.has(key)) result.issues.push({ code: "missing-task", id: id });
    if (result.issues.length) { result.kind = "unresolved"; return result; }
    if (scoped && !g.active.has(key)) { result.kind = "inactive"; return result; }
    var ids = scoped ? descendants(g, key) : g.order.filter(function (k) { return g.active.has(k); });
    // Wrappers do not turn into new work units when their last child is archived.
    var leaves = ids.filter(function (k) { return !g.children.get(k).length; });
    result.total = leaves.length;
    result.done = leaves.filter(function (k) { return g.byId.get(k).done; }).length;
    result.blockerIds = ids.filter(function (k) { return !g.byId.get(k).done; });
    result.pct = result.total ? result.done / result.total : null;
    result.kind = result.total ? "checklist" : (scoped ? g.children.get(key).length > 0 : g.nodes.length > 0) ? "empty-active" : "none";
    return result;
  }
  function failed(items, reason, blockers, issues) {
    return { ok: false, items: Data.copy(items), changedIds: [], reason: reason, blockerIds: blockers || [], issues: issues || [] };
  }
  function transition(before, proposed, options) {
    var old = analyze(before), inputIssues = Data.inspect(proposed), opts = options || {};
    if (inputIssues.length) return failed(before, "Repair the checklist references first.", [], inputIssues);
    var next = analyze((proposed || []).map(function (n) {
      var previous = old.byId.get(String(n.id || Data.legacyId(n.t)));
      // Omission by an older editor cannot erase provenance, history or relationships.
      return Object.assign(Object.create(null), previous || {}, Data.copy(n));
    }));
    if (old.issues.length || next.issues.length) return failed(before, "Repair the checklist references first.", [], old.issues.concat(next.issues));
    if (old.nodes.some(function (n) { return !next.byId.has(String(n.id)); })) return failed(before, "Keep removed tasks as tombstones so their identity and history survive.");
    var blocked = new Set();
    next.nodes.forEach(function (n) {
      var key = String(n.id), previous = old.byId.get(key);
      if (!n.done || (previous && previous.done)) return;
      // Hidden branches cannot be marked done through bulk or forged UI actions.
      if (!next.active.has(key)) { blocked.add(key); return; }
      descendants(next, key).forEach(function (child) { if (!next.byId.get(child).done) blocked.add(child); });
    });
    if (blocked.size) return failed(before, "Finish the active nested subtasks before completing their parent.", Array.from(blocked));
    // Propagate unfinished descendants upward once, bottom-up. Never auto-complete.
    next.order.slice().reverse().forEach(function (key) {
      var n = next.byId.get(key);
      if (!next.active.has(key) || n.done || n.parentId == null) return;
      var parent = next.byId.get(String(n.parentId));
      if (parent && next.active.has(String(parent.id))) parent.done = false;
    });
    var clock = Number(opts.now == null ? Date.now() : opts.now);
    if (!Number.isFinite(clock) || clock < 0) return failed(before, "Invalid task edit time.");
    next.nodes.concat(old.nodes).forEach(function (n) { var u = Number(n.u); if (Number.isFinite(u)) clock = Math.max(clock, u + 1); });
    var changed = [];
    next.nodes.forEach(function (n) {
      var previous = old.byId.get(String(n.id));
      if (!previous || Data.canonical(previous) !== Data.canonical(n)) { n.u = clock; changed.push(n.id); }
    });
    return { ok: true, items: next.nodes, changedIds: changed, blockerIds: [], issues: [], reason: "" };
  }
  function command(items, action, options) {
    var g = analyze(items), op = action || {}, key = String(op.id), node = g.byId.get(key);
    if (g.issues.length) return failed(items, "Repair the checklist references first.", [], g.issues);
    if (op.type === "add") {
      if (!op.item || !op.item.id || g.byId.has(String(op.item.id))) return failed(items, "A new task needs its own stable ID.");
      if (op.item.parentId != null && !g.active.has(String(op.item.parentId))) return failed(items, "The parent task is unavailable.");
      return transition(items, g.nodes.concat([Data.copy(op.item)]), options);
    }
    if (!node) return failed(items, "This task no longer exists.");
    if (op.type !== "restore" && !g.active.has(key)) return failed(items, "Restore this branch before editing it.");
    if (op.type === "restore" && (node.del || (node.parentId != null && !g.active.has(String(node.parentId))))) return failed(items, "Restore the parent branch first; deleted records need explicit recovery.");
    var patch;
    if (op.type === "done") patch = { done: !!op.done };
    else if (op.type === "archive") patch = { archived: true };
    else if (op.type === "restore") patch = { archived: false };
    else if (op.type === "remove") patch = { del: true };
    else if (op.type === "reparent") {
      if (op.parentId != null && !g.active.has(String(op.parentId))) return failed(items, "The parent task is unavailable.");
      patch = { parentId: op.parentId == null ? null : op.parentId };
    } else return failed(items, "Unknown task action.");
    return transition(items, g.nodes.map(function (n) { return String(n.id) === key ? Object.assign(n, patch) : n; }), options);
  }
  return Object.freeze({ analyze: analyze, completion: completion, progress: progress, transition: transition, command: command });
});
