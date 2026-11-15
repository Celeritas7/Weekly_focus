/* Task storage compatibility. Pure JSON transforms; no database or browser writes. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WFTaskData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var WRITER_VERSION = 1;
  function record(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function copy(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function canonical(x) {
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    if (record(x)) return "{" + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canonical(x[k]); }).join(",") + "}";
    return JSON.stringify(x);
  }
  function legacyId(text) {
    var s = String(text || ""), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return "l_" + h.toString(36);
  }
  function normalize(items, contextNormalizer) {
    return (Array.isArray(items) ? items : []).filter(record).map(function (raw) {
      var s = copy(raw);
      // Overlay known defaults; retain source, notes, ratings, history and future fields.
      return Object.assign(s, {
        id: s.id || legacyId(s.t), t: s.t || "", done: !!s.done, u: s.u || 0,
        del: !!s.del, when: s.when || "", md: s.md || "b", urg: !!s.urg,
        dl: !!s.dl, loc: s.loc || "", tag: s.tag || "",
        ctx: contextNormalizer ? contextNormalizer(s.ctx) : (Array.isArray(s.ctx) ? s.ctx : []),
        lat: !!s.lat, latAt: s.latAt || 0, rv: s.rv || "", src: s.src || null
      });
    });
  }
  function inspect(items) {
    var issues = [], seen = new Set();
    if (items == null) return issues;
    if (!Array.isArray(items)) return [{ code: "invalid-list" }];
    items.forEach(function (s, index) {
      if (!record(s)) { issues.push({ code: "invalid-record", index: index }); return; }
      var id = s.id || legacyId(s.t);
      if ((typeof id !== "string" && typeof id !== "number") || !String(id)) issues.push({ code: "invalid-id", index: index });
      if (seen.has(String(id))) issues.push({ code: "duplicate-id", id: id, index: index });
      seen.add(String(id));
    });
    return issues;
  }
  function writeIssue(entry) {
    if (!entry) return "";
    if (entry.taskSchemaVersion != null && (!Number.isInteger(entry.taskSchemaVersion) || entry.taskSchemaVersion > WRITER_VERSION || entry.taskSchemaVersion < 1)) return "This task format needs a newer app. Update before editing.";
    if (inspect(entry.subtasks).length) return "This checklist has ambiguous or invalid records. Export a backup before repairing it; edits are paused.";
    if ((entry.subtasks || []).some(function (s) { return s.parentId != null || s.archived === true || s.occurrenceId != null; })) return "Nested or recurring task editing is not enabled yet. This checklist is kept unchanged.";
    return "";
  }
  function tie(a, b) {
    // Deterministic fallback for equal legacy clocks. Retain the previous union rules.
    // An ordered revision/command protocol is still needed for simultaneous reopen/done.
    var first = canonical(a) <= canonical(b) ? a : b, second = first === a ? b : a;
    return Object.assign(Object.create(null), copy(second), copy(first), {
      t: first.t || second.t, done: a.done || b.done, del: a.del || b.del,
      when: first.when || second.when, md: first.md !== "b" ? first.md : second.md,
      urg: a.urg || b.urg, dl: a.dl || b.dl, loc: first.loc || second.loc,
      tag: first.tag || second.tag, ctx: first.ctx.length ? first.ctx : second.ctx,
      lat: a.lat || b.lat, latAt: first.latAt || second.latAt, rv: first.rv || second.rv,
      src: first.src || second.src
    });
  }
  function merge(a, b, contextNormalizer) {
    // Ambiguous records must never be collapsed into one task. Callers hold writes.
    if (inspect(a).length || inspect(b).length) {
      var left = Array.isArray(a) ? a : [], right = Array.isArray(b) ? b : [];
      var counts = new Map(), added = new Map(), out = copy(left);
      left.forEach(function (s) { var key = canonical(s); counts.set(key, (counts.get(key) || 0) + 1); });
      right.forEach(function (s) {
        var key = canonical(s), n = (added.get(key) || 0) + 1; added.set(key, n);
        if (n > (counts.get(key) || 0)) out.push(copy(s));
      });
      return out;
    }
    var by = new Map();
    normalize(a, contextNormalizer).concat(normalize(b, contextNormalizer)).forEach(function (s) {
      var key = String(s.id), ex = by.get(key);
      if (!ex) { by.set(key, s); return; }
      var newest = s.u > ex.u ? s : ex, older = newest === s ? ex : s;
      by.set(key, s.u === ex.u ? tie(ex, s) : Object.assign(Object.create(null), older, newest, { src: newest.src || older.src }));
    });
    return Array.from(by.values()).map(copy);
  }
  function signature(items, contextNormalizer) {
    // Include every field. Sort only the outer list: checklist order is presentation,
    // but an ordered array inside an extension field can have semantic meaning.
    return normalize(items, contextNormalizer).map(canonical).sort().join("\n");
  }
  return Object.freeze({ writerVersion: WRITER_VERSION, normalize: normalize, merge: merge,
    inspect: inspect, writeIssue: writeIssue, signature: signature, legacyId: legacyId,
    canonical: canonical, copy: copy });
});
