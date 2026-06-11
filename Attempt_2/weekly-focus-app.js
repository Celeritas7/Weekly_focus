/* ============================================================
   Weekly Focus — app logic (vanilla, self-contained)
   Screen-first focus cockpit. Sample data baked in so it's
   always interactive; real PROJECT_STATUS.md / folder parsing
   kept for live use (window.__wfp.parseStatus / parseListing).
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- icons ---------------- */
  var IC = {
    chev: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevR: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.85 5.9 6.5.8-4.8 4.5 1.25 6.4L12 17.7 6.2 20.6l1.25-6.4L2.65 9.3l6.5-.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V4h12v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 17h10v4H7z"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v5h5"/><path d="M5.5 13a7 7 0 1 0 1.5-6.5L4 10"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>'
  };

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function stripHash(s) { return s.replace(/^[#]+\s*/, ""); }
  function skipFolder(n) { return n.charAt(0) === "_" || n.charAt(0) === "."; }
  function hueFor(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function dedupeTree(nodes) {
    var seen = {}, out = [];
    for (var i = 0; i < nodes.length; i++) { var n = nodes[i]; if (!seen[n.name]) { seen[n.name] = 1; dedupeTree(n.children); out.push(n); } }
    nodes.length = 0; for (var j = 0; j < out.length; j++) nodes.push(out[j]);
  }

  /* ---------------- ring builder ---------------- */
  function ringSVG(pct, size, sw, cls) {
    var r = (size - sw) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
    var ctr = size / 2;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle class="' + cls.t + '" cx="' + ctr + '" cy="' + ctr + '" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' +
      '<circle class="' + cls.f + '" cx="' + ctr + '" cy="' + ctr + '" r="' + r + '" fill="none" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>';
  }

  /* ---------------- parsers (for real data) ---------------- */
  function statusToGroup(c) {
    if (c.indexOf("\uD83D\uDFE2") >= 0) return "Active";
    if (c.indexOf("\uD83D\uDD35") >= 0) return "Quiet";
    if (c.indexOf("\uD83D\uDFE1") >= 0) return "Stale";
    if (c.indexOf("\uD83D\uDD27") >= 0) return "Maintenance";
    if (c.indexOf("\u23F8") >= 0) return "Paused";
    if (c.indexOf("\u26AB") >= 0) return null;
    return "Quiet";
  }
  function maturityToPri(m) { if (/full[- ]?stack/i.test(m)) return "H"; if (/build setup/i.test(m)) return "M"; return "L"; }
  function parseStatus(text) {
    var lines = text.split(/\r?\n/), cat = null, apps = [];
    for (var i = 0; i < lines.length; i++) {
      var h = lines[i].match(/^##\s+(.+?)\s*$/);
      if (h) { cat = h[1].trim(); continue; }
      var t = lines[i].trim();
      if (t.charAt(0) !== "|") continue;
      var parts = t.split("|"); if (parts[0].trim() === "") parts.shift(); if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
      var cells = parts.map(function (c) { return c.trim(); });
      if (cells.length < 5) continue;
      if (/^project$/i.test(cells[0]) || /^:?-{2,}:?$/.test(cells[0])) continue;
      var group = statusToGroup(cells[4]); if (!group) continue;
      apps.push({ name: cells[0], category: cat || "Other", group: group, maturity: cells[2], priAuto: maturityToPri(cells[2]) });
    }
    return apps;
  }
  function parseListing(text) {
    var lines = text.split(/\r?\n/), roots = [], stack = [], skipIndent = -1;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i]; if (!raw.trim()) continue;
      var indent = raw.match(/^\s*/)[0].length, name = raw.trim();
      if (skipIndent >= 0) { if (indent > skipIndent) continue; else skipIndent = -1; }
      if (skipFolder(name)) { skipIndent = indent; continue; }
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      var depth = stack.length;
      var node = { name: depth === 0 ? stripHash(name).toUpperCase() : stripHash(name), children: [] };
      if (stack.length) stack[stack.length - 1].node.children.push(node); else roots.push(node);
      stack.push({ indent: indent, node: node });
    }
    dedupeTree(roots);
    return roots;
  }

  /* ---------------- sample data ---------------- */
  var SAMPLE_STATUS = [
    "## General Purpose",
    "| Project | What it is | Maturity | Last activity | Status |",
    "| FocusFlow | pomodoro + day planner | full-stack | 2026-06-05 | \uD83D\uDFE2 Active |",
    "| LedgerLite | personal finance tracker | build setup | 2026-05-28 | \uD83D\uDFE2 Active |",
    "| NoteVault | encrypted notes | prototype | 2026-04-10 | \uD83D\uDD35 Quiet |",
    "| HabitGrid | habit streaks | build setup | 2026-05-01 | \uD83D\uDFE1 Stale |",
    "## Mechanical",
    "| Project | What it is | Maturity | Last activity | Status |",
    "| VisionTrack | object tracking | full-stack | 2026-06-06 | \uD83D\uDFE2 Active |",
    "| CADhelper | parametric tooling | prototype | 2026-03-22 | \uD83D\uDD35 Quiet |",
    "| RoboArm | servo control | build setup | 2026-05-15 | \uD83D\uDD27 Maintenance |",
    "## Language Study",
    "| Project | What it is | Maturity | Last activity | Status |",
    "| KanjiDrill | spaced repetition | full-stack | 2026-06-04 | \uD83D\uDFE2 Active |",
    "| VerbConjugator | grammar drills | prototype | 2026-02-01 | \uD83D\uDFE1 Stale |"
  ].join("\n");
  var SAMPLE_DIR = [
    "#AI_and_Maths", "  Mathematics", "    Calculus", "    Linear Algebra", "    Probability",
    "  AI", "    Transformers", "    Reinforcement Learning",
    "#Languages", "  Japanese", "    Kanji", "    Grammar", "    Listening", "  Spanish", "    Vocabulary",
    "#Engineering", "  Control Systems", "  Signal Processing"
  ].join("\n");

  /* seed curation that makes the demo feel alive */
  function sampleEntries() {
    return {
      "app:FocusFlow": { active: true, pri: "H", target: true, objective: "Ship the day-planner view to beta",
        subtasks: [s("Drag-reorder tasks", true), s("Persist to localStorage", true), s("Keyboard shortcuts", false), s("Empty-state polish", false)] },
      "app:VisionTrack": { active: true, pri: "H", target: true, objective: "Get tracking stable at 30fps",
        subtasks: [s("Kalman filter pass", true), s("Handle occlusion", false), s("Benchmark on test set", false)], notes: "Drift shows up after ~40s \u2014 likely the smoothing window." },
      "app:LedgerLite": { active: true, pri: "M", target: true, objective: "CSV import working end-to-end",
        subtasks: [s("Parse common bank formats", true), s("Category auto-rules", false)] },
      "app:KanjiDrill": { active: true, pri: "H", subtasks: [s("Add JLPT N3 deck", false)] },
      "study:LANGUAGES/Japanese/Kanji": { active: true, target: true, objective: "Finish N4 set", subtasks: [s("Review batch 1\u20133", true), s("Batch 4\u20135", false)] },
      "study:AI_AND_MATHS/Mathematics/Linear Algebra": { active: true, objective: "Eigen-everything intuition" }
    };
  }
  function s(t, done) { return { id: subUid(), t: t, done: !!done }; }

  /* ---------------- state + persistence ---------------- */
  var K = { entries: "wf2_entries", exp: "wf2_exp", meta: "wf2_meta", targets: "wf2_targets", seeded: "wf2_seeded", inv: "wf2_inv" };
  var state = { apps: null, domains: null };
  var entries = load(K.entries);
  var expanded = load(K.exp);
  var meta = load(K.meta);          // { weekOf, eowDone, eowCarry, eowNotes }
  var targetOrder = loadArr(K.targets);
  var detailOpen = {};

  /* cloud state (see CLOUD SYNC section) */
  var CLOUD_KEY = "wf2_cloud", OUTBOX_KEY = "wf2_outbox", BOARD_ITEM = "__board";
  // Hardcoded so a fresh device (incl. phone) syncs board "my_week" with zero setup.
  // The URL + publishable/anon key are safe in client code; the Cloud panel is an optional override.
  var CLOUD_DEFAULTS = {
    url: "https://wylxvmkcrexwfpjpbhyy.supabase.co",
    key: "sb_publishable_e3pDOuxIdstaC7s0a680kQ_R10TrAyv",
    board: "my_week"
  };
  var cloud = Object.assign({}, CLOUD_DEFAULTS, load(CLOUD_KEY));  // saved override wins
  var outbox = load(OUTBOX_KEY);    // queued upserts, flushed when online
  var hasLocalSource = false;       // true once this device loads inventory from disk/paste
  var flushing = false, sb = null;

  function load(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }
  function loadArr(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
  function save() {
    try {
      localStorage.setItem(K.entries, JSON.stringify(entries));
      localStorage.setItem(K.exp, JSON.stringify(expanded));
      localStorage.setItem(K.meta, JSON.stringify(meta));
      localStorage.setItem(K.targets, JSON.stringify(targetOrder));
    } catch (e) {}
  }
  function subUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function getEntry(k) { return entries[k] || {}; }
  function patch(k, p) { entries[k] = Object.assign({}, entries[k], p); save(); cloudPushEntry(k, entries[k]); }

  /* ---- real-data inventory: persist what's loaded from files/paste ---- */
  function saveInv() {
    try { localStorage.setItem(K.inv, JSON.stringify({ apps: state.apps, domains: state.domains })); } catch (e) {}
    hasLocalSource = true; cloudPushApps(); cloudPushStudy();
  }
  function loadInv() {
    try { var v = JSON.parse(localStorage.getItem(K.inv)); return (v && (v.apps || v.domains)) ? v : null; } catch (e) { return null; }
  }

  /* ---------------- model accessors ---------------- */
  function isActive(app) { var o = entries["app:" + app.name]; return (o && typeof o.active === "boolean") ? o.active : app.group === "Active"; }
  function priOf(key, app) { var o = entries[key]; return (o && o.pri) || (app ? app.priAuto : null); }
  function effPri(app) { return priOf("app:" + app.name, app); }
  function priRankOf(key) { var o = entries[key]; return (o && o.pri) ? PRI_RANK[o.pri] : 3; }
  function studyPath(dom, names) { return dom + "/" + names.join("/"); }
  function isActiveStudy(p) { return getEntry("study:" + p).active === true; }
  function eachNode(dom, cb) {
    function rec(node, anc) { var names = anc.concat([node.name]); cb(node, anc, studyPath(dom.name, names)); for (var i = 0; i < node.children.length; i++) rec(node.children[i], names); }
    for (var i = 0; i < dom.children.length; i++) rec(dom.children[i], []);
  }
  function collectActiveStudy() {
    var out = [];
    (state.domains || []).forEach(function (dom) { eachNode(dom, function (node, anc, path) { if (isActiveStudy(path)) out.push({ domain: dom.name, ancestors: anc, node: node, path: path }); }); });
    return out;
  }
  function countLeaves() { var n = 0; (state.domains || []).forEach(function (dom) { eachNode(dom, function (node) { if (!node.children.length) n++; }); }); return n; }

  var APP_CATS = ["General Purpose", "Mechanical", "Language Study", "Other"];
  var CAT_CLASS = { "General Purpose": "cat-gp", "Mechanical": "cat-mech", "Language Study": "cat-lang", "Other": "cat-other" };
  var PRI_RANK = { H: 0, M: 1, L: 2 };

  /* ---------------- subtask progress ---------------- */
  function subs(k) { var a = getEntry(k).subtasks; return Array.isArray(a) ? a : []; }
  function subProgress(k) { var a = subs(k); if (!a.length) return null; var d = a.filter(function (x) { return x.done; }).length; return { done: d, total: a.length, pct: d / a.length }; }

  /* ---------------- targets (The Five) ---------------- */
  var MAX_TARGETS = 5;
  function isTarget(k) { return targetOrder.indexOf(k) >= 0; }
  function addTarget(k) { if (isTarget(k) || targetOrder.length >= MAX_TARGETS) return false; targetOrder.push(k); save(); cloudPushBoard(); return true; }
  function removeTarget(k) { var i = targetOrder.indexOf(k); if (i >= 0) { targetOrder.splice(i, 1); patch(k, { targetDone: false }); save(); cloudPushBoard(); } }
  function targetDone(k) { return getEntry(k).targetDone === true; }
  function activeKeys() {
    var ks = {};
    (state.apps || []).forEach(function (a) { if (isActive(a)) ks["app:" + a.name] = 1; });
    collectActiveStudy().forEach(function (a) { ks["study:" + a.path] = 1; });
    return ks;
  }
  function pruneTargets() { var ks = activeKeys(); targetOrder = targetOrder.filter(function (k) { return ks[k]; }); }
  function labelFor(k) {
    if (k.indexOf("app:") === 0) { var name = k.slice(4); return { name: name, crumb: catOfApp(name) }; }
    var path = k.slice(6), parts = path.split("/"); var leaf = parts.pop();
    return { name: leaf, crumb: parts.join(" \u203a ") };
  }
  function catOfApp(name) { var a = (state.apps || []).filter(function (x) { return x.name === name; })[0]; return a ? a.category : ""; }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderAll() { pruneTargets(); renderPulse(); renderFive(); renderApps(); renderStudy(); renderMeta(); }

  function renderPulse() {
    var done = targetOrder.filter(targetDone).length, total = targetOrder.length;
    var pct = total ? done / total : 0;
    var activeApps = (state.apps || []).filter(isActive).length;
    var activeStudy = collectActiveStudy().length;
    var el = $("pulse");
    var msg;
    if (!total) msg = "Pick up to five targets below \u2014 the things that actually have to move this week.";
    else if (done === total) msg = "<b>Every target cleared.</b> Re-curate for next week, or print the sheet.";
    else msg = "<b>" + done + " of " + total + "</b> targets done. Stay on the five \u2014 everything else is just noise.";
    el.innerHTML =
      '<div class="ring">' + ringSVG(pct, 96, 9, { t: "track", f: "fill" }) +
        '<div class="center"><span class="pct">' + Math.round(pct * 100) + '%</span><span class="pctlbl">Week</span></div></div>' +
      '<div class="pulse-copy"><h2>This Week\'s Focus</h2><p>' + msg + '</p>' +
        '<div class="pulse-stats">' +
          '<div class="pstat"><span class="n">' + done + '/' + total + '</span><span class="l">Targets</span></div>' +
          '<div class="pstat apps"><span class="n">' + activeApps + '</span><span class="l">Apps active</span></div>' +
          '<div class="pstat study"><span class="n">' + activeStudy + '</span><span class="l">Topics active</span></div>' +
        '</div></div>';
  }

  function renderFive() {
    var grid = $("fiveGrid"); grid.innerHTML = "";
    targetOrder.forEach(function (k, i) {
      var lab = labelFor(k), done = targetDone(k), prog = subProgress(k);
      var card = document.createElement("div");
      card.className = "tcard" + (done ? " done" : "");
      card.setAttribute("data-tkey", k);
      var meta = lab.crumb ? esc(lab.crumb) : (k.indexOf("app:") === 0 ? "App" : "Study");
      if (prog) meta += " \u00b7 " + prog.done + "/" + prog.total;
      card.innerHTML =
        '<span class="tnum">TARGET ' + (i + 1) + '</span>' +
        '<button class="tcheck' + (done ? " on" : "") + '" data-act="tdone" title="Mark done"></button>' +
        '<div class="ttitle">' + esc(lab.name) + '</div>' +
        '<div class="tmeta">' + meta + '</div>' +
        '<button class="tdrop" data-act="tdrop" title="Remove from focus">\u00d7</button>';
      grid.appendChild(card);
    });
    if (targetOrder.length < MAX_TARGETS) {
      var add = document.createElement("div");
      add.className = "tcard empty"; add.setAttribute("data-act", "tpick");
      add.innerHTML = '<span class="plus">+</span><span class="etxt">Add target</span>';
      grid.appendChild(add);
    }
    $("fiveCount").textContent = targetOrder.length + "/" + MAX_TARGETS;
  }

  /* ---- shared item card (active apps + active study) ---- */
  function itemCard(key, kind, nameHtml, crumbHtml, app) {
    var open = !!detailOpen[key], prog = subProgress(key);
    var li = document.createElement("div");
    var pri = priOf(key, app);
    var priCls = pri ? (" pri-" + pri) : "";
    li.className = "item" + priCls + (open ? " open" : "");
    li.setAttribute("data-key", key); li.setAttribute("data-kind", kind);
    // progress ring only when there ARE subtasks; sits on the right so names align
    var ring = prog
      ? '<div class="miniring" title="' + prog.done + ' of ' + prog.total + ' subtasks done">' + ringSVG(prog.pct, 26, 3.5, { t: "mt", f: "mf" }) + '<span class="mn">' + prog.done + '/' + prog.total + '</span></div>'
      : '';
    var starOn = isTarget(key), starFull = !starOn && targetOrder.length >= MAX_TARGETS;
    li.innerHTML =
      '<div class="item-row">' +
        '<div class="item-grip" data-act="open">' +
          '<div class="iwrap-name">' + (crumbHtml ? '<div class="icrumb">' + crumbHtml + '</div>' : "") + '<div class="iname">' + nameHtml + '</div></div>' +
        '</div>' +
        '<div class="item-actions">' + ring +
          '<button class="star' + (starOn ? " on" : "") + '" data-act="star"' + (starFull ? " disabled" : "") + ' title="' + (starOn ? "In The Five" : starFull ? "The Five is full" : "Add to The Five") + '">' + IC.star + '</button>' +
          '<button class="caret-btn" data-act="open">' + IC.chev + '</button>' +
          '<button class="tgl on" data-act="off" title="Move to backlog"><span class="knob"></span></button>' +
        '</div>' +
      '</div>' +
      detailHtml(key, app);
    return li;
  }
  function priName(p) { return p === "H" ? "High" : p === "M" ? "Medium" : "Low"; }
  function detailHtml(key, app) {
    var e = getEntry(key), rows = subs(key).map(function (x) {
      return '<li data-sid="' + esc(x.id) + '"><button class="sub-check' + (x.done ? " on" : "") + '" data-act="subtoggle" aria-label="done"></button>' +
        '<input class="sub-text" data-act="subedit" value="' + esc(x.t || "") + '" placeholder="subtask">' +
        '<button class="sub-del" data-act="subdel" title="Delete">\u00d7</button></li>';
    }).join("");
    var priCtl = "";
    var pri = priOf(key, app);
    priCtl = '<div class="pri-row"><span class="pri-lbl">Priority</span>' +
      '<div class="pri-seg">' + ["H", "M", "L"].map(function (p) {
        return '<button class="pseg pseg-' + p + (p === pri ? " on" : "") + '" data-pri="' + p + '">' + priName(p) + '</button>';
      }).join("") + '</div></div>';
    return '<div class="detail">' + priCtl +
      '<input class="obj" data-act="obj" placeholder="Objective \u2014 what does done look like?" value="' + esc(e.objective || "") + '">' +
      '<ul class="subs">' + rows + '</ul>' +
      '<div class="sub-add"><input class="sub-new" data-act="subnew" placeholder="Add a checklist subtask\u2026"><button class="sub-addbtn" data-act="subadd">Add</button></div>' +
      '<div class="notes-block"><span class="notes-lbl">\u270e Notes</span>' +
      '<textarea class="notes" data-act="notes" placeholder="Longer notes \u2014 thinking, blockers, links\u2026">' + esc(e.notes || "") + '</textarea></div>' +
    '</div>';
  }

  /* ---- APPS column ---- */
  function renderApps() {
    var host = $("appsActive"), back = $("appsBacklog");
    host.innerHTML = ""; back.innerHTML = "";
    if (!state.apps) { host.innerHTML = emptyZone("No apps loaded. Click <b>Load sample</b> or paste your PROJECT_STATUS.md."); $("appsN").textContent = "0"; $("appsBacklogWrap").style.display = "none"; return; }
    var active = state.apps.filter(isActive), backlog = state.apps.filter(function (a) { return !isActive(a); });
    $("appsN").textContent = active.length;
    if (!active.length) host.innerHTML = emptyZone("Nothing active yet \u2014 flip on apps from the backlog below.");
    else groupByCat(active, true).forEach(function (g) {
      host.appendChild(catHead(g.cat, g.items.length));
      g.items.forEach(function (a) { host.appendChild(itemCard("app:" + a.name, "app", esc(a.name), "", a)); });
    });
    // backlog
    $("appsBacklogWrap").style.display = backlog.length ? "" : "none";
    $("appsBacklogN").textContent = backlog.length;
    if (backlog.length) {
      groupByCat(backlog, false).forEach(function (g) {
        back.appendChild(catHead(g.cat, g.items.length));
        var ul = document.createElement("ul"); ul.className = "brows";
        g.items.forEach(function (a) {
          var li = document.createElement("li"); li.className = "brow"; li.setAttribute("data-key", "app:" + a.name); li.setAttribute("data-kind", "app");
          li.innerHTML = '<button class="tgl tgl-sm" data-act="on" title="Bring into This Week"><span class="knob"></span></button><span class="bname">' + esc(a.name) + '</span>';
          ul.appendChild(li);
        });
        back.appendChild(ul);
      });
    }
  }
  function groupByCat(apps, sortPri) {
    var cats = APP_CATS.slice();
    apps.forEach(function (a) { if (cats.indexOf(a.category) < 0) cats.push(a.category); });
    return cats.map(function (cat) {
      var items = apps.filter(function (a) { return a.category === cat; });
      items.sort(sortPri
        ? function (a, b) { return (PRI_RANK[effPri(a)] - PRI_RANK[effPri(b)]) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }
        : function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
      return { cat: cat, items: items };
    }).filter(function (g) { return g.items.length; });
  }
  function catHead(cat, n) {
    var d = document.createElement("div"); d.className = "cat-head " + (CAT_CLASS[cat] || "cat-other");
    d.innerHTML = '<span class="cat-dot"></span>' + esc(cat) + ' <span class="cat-n">' + n + '</span>';
    return d;
  }
  function emptyZone(html) { var d = '<div class="empty-zone">' + html + '</div>'; return d; }

  /* ---- STUDY column ---- */
  function renderStudy() {
    var host = $("studyActive"), tree = $("studyTree");
    host.innerHTML = ""; tree.innerHTML = "";
    if (!state.domains) { host.innerHTML = emptyZone("No topics loaded. Click <b>Load sample</b> or paste your Database folder listing."); $("studyN").textContent = "0"; $("studyTreeWrap").style.display = "none"; return; }
    var active = collectActiveStudy();
    $("studyN").textContent = active.length;
    if (!active.length) host.innerHTML = emptyZone("No topics active yet \u2014 open a folder below and flip one on.");
    else {
      var byDom = {}; active.forEach(function (a) { (byDom[a.domain] = byDom[a.domain] || []).push(a); });
      (state.domains || []).forEach(function (d) {
        var arr = byDom[d.name]; if (!arr) return;
        arr.sort(function (x, y) { return (priRankOf("study:" + x.path) - priRankOf("study:" + y.path)) || x.node.name.toLowerCase().localeCompare(y.node.name.toLowerCase()); });
        var ch = document.createElement("div"); ch.className = "cat-head"; ch.style.color = "oklch(0.55 0.13 " + hueFor(d.name) + ")";
        ch.innerHTML = '<span class="cat-dot"></span>' + esc(d.name) + ' <span class="cat-n">' + arr.length + '</span>';
        host.appendChild(ch);
        arr.forEach(function (a) {
          var crumb = a.ancestors.length ? esc(a.ancestors.join(" \u203a ")) : esc(a.domain);
          host.appendChild(itemCard("study:" + a.path, "study", esc(a.node.name), crumb, null));
        });
      });
    }
    // library tree
    $("studyTreeWrap").style.display = "";
    $("studyTreeN").textContent = countLeaves();
    (state.domains || []).forEach(function (d) {
      var ch = document.createElement("div"); ch.className = "cat-head"; ch.style.color = "oklch(0.55 0.13 " + hueFor(d.name) + ")";
      ch.innerHTML = '<span class="cat-dot"></span>' + esc(d.name);
      tree.appendChild(ch);
      d.children.forEach(function (c) { renderTreeNode(d, c, [], 1, tree); });
    });
  }
  function renderTreeNode(dom, node, anc, depth, host) {
    var names = anc.concat([node.name]), path = studyPath(dom.name, names), hasKids = node.children.length > 0;
    var row = document.createElement("div");
    row.style.paddingLeft = (4 + (depth - 1) * 16) + "px";
    if (hasKids) {
      var open = !!expanded[path];
      row.className = "trow tfolder"; row.setAttribute("data-exp", path);
      row.innerHTML = '<button class="tcaret' + (open ? " open" : "") + '" data-act="exp">' + IC.chevR + '</button><span class="tname">' + esc(node.name) + '<span class="kid-n">' + node.children.length + '</span></span>';
      host.appendChild(row);
      if (open) node.children.forEach(function (c) { renderTreeNode(dom, c, names, depth + 1, host); });
    } else {
      if (isActiveStudy(path)) return;
      row.className = "trow"; row.setAttribute("data-key", "study:" + path); row.setAttribute("data-kind", "study");
      row.innerHTML = '<span class="tcaret-sp"></span><button class="tgl tgl-sm" data-act="on" title="Study this week"><span class="knob"></span></button><span class="tname">' + esc(node.name) + '</span>';
      host.appendChild(row);
    }
  }

  /* ---- meta (week + eow) ---- */
  function renderMeta() {
    $("weekInput").value = meta.weekOf || "";
    $("eowDone").value = meta.eowDone || "";
    $("eowCarry").value = meta.eowCarry || "";
    $("eowNotes").value = meta.eowNotes || "";
  }

  /* ============================================================
     PICKER MODAL
     ============================================================ */
  function openPicker() {
    var body = $("pickBody"); body.innerHTML = "";
    var rows = [];
    (state.apps || []).filter(isActive).forEach(function (a) {
      rows.push({ key: "app:" + a.name, name: a.name, crumb: a.category, tag: "App", color: catColor(a.category) });
    });
    collectActiveStudy().forEach(function (a) {
      rows.push({ key: "study:" + a.path, name: a.node.name, crumb: a.ancestors.length ? a.ancestors.join(" \u203a ") : a.domain, tag: "Study", color: "oklch(0.55 0.13 " + hueFor(a.domain) + ")" });
    });
    if (!rows.length) { body.innerHTML = '<div class="modal-empty">No active items yet.<br>Flip on an app or study topic first, then pick your targets from them.</div>'; }
    else rows.forEach(function (r) {
      var taken = isTarget(r.key);
      var b = document.createElement("button");
      b.className = "pick" + (taken ? " taken" : ""); b.setAttribute("data-pick", r.key);
      b.innerHTML = '<span class="pdot" style="background:' + r.color + '"></span>' +
        '<span class="ptxt"><span class="pname">' + esc(r.name) + '</span><br><span class="pcrumb">' + esc(r.crumb) + '</span></span>' +
        '<span class="ptag" style="background:' + r.color + '">' + r.tag + '</span>';
      body.appendChild(b);
    });
    $("pickModal").classList.add("open");
  }
  function closePicker() { $("pickModal").classList.remove("open"); }
  function catColor(cat) { return ({ "General Purpose": "var(--cat-gp)", "Mechanical": "var(--cat-mech)", "Language Study": "var(--cat-lang)" })[cat] || "var(--cat-other)"; }

  /* ============================================================
     EVENTS
     ============================================================ */
  function keyOf(el) { var n = el.closest("[data-key]"); return n ? n.getAttribute("data-key") : null; }

  document.addEventListener("click", function (e) {
    var act = e.target.closest("[data-act]");
    // picker rows
    var pk = e.target.closest("[data-pick]");
    if (pk) { var k = pk.getAttribute("data-pick"); if (addTarget(k)) { renderAll(); openPicker(); } else toast("The Five is full \u2014 remove one first."); return; }
    // priority segmented control (in detail)
    var seg = e.target.closest("[data-pri]");
    if (seg) { patch(keyOf(seg), { pri: seg.getAttribute("data-pri") }); renderApps(); renderStudy(); return; }
    if (!act) return;
    var a = act.getAttribute("data-act");

    if (a === "tpick") { openPicker(); return; }
    if (a === "pickclose" || act.id === "pickModal") { closePicker(); return; }
    if (a === "tdone") { var tk = act.closest("[data-tkey]").getAttribute("data-tkey"); patch(tk, { targetDone: !targetDone(tk) }); renderPulse(); renderFive(); toastMaybeDone(); return; }
    if (a === "tdrop") { removeTarget(act.closest("[data-tkey]").getAttribute("data-tkey")); renderAll(); return; }

    var key = keyOf(act);
    if (a === "open") { detailOpen[key] = !detailOpen[key]; renderApps(); renderStudy(); return; }
    if (a === "off") { patch(key, { active: false }); removeTarget(key); detailOpen[key] = false; renderAll(); return; }
    if (a === "on") { patch(key, { active: true }); renderAll(); return; }
    if (a === "star") {
      if (isTarget(key)) { removeTarget(key); } else if (!addTarget(key)) { toast("The Five is full \u2014 remove one first."); return; }
      renderAll(); return;
    }
    if (a === "exp") { var p = act.closest("[data-exp]").getAttribute("data-exp"); expanded[p] = !expanded[p]; save(); renderStudy(); return; }
    if (a === "subtoggle") {
      var sid = e.target.closest("[data-sid]").getAttribute("data-sid");
      var arr = subs(key).map(function (x) { return x.id === sid ? Object.assign({}, x, { done: !x.done }) : x; });
      patch(key, { subtasks: arr }); renderApps(); renderStudy(); renderPulse(); renderFive(); return;
    }
    if (a === "subdel") {
      var sid2 = e.target.closest("[data-sid]").getAttribute("data-sid");
      patch(key, { subtasks: subs(key).filter(function (x) { return x.id !== sid2; }) }); renderApps(); renderStudy(); renderPulse(); renderFive(); return;
    }
    if (a === "subadd") { addSub(act, key); return; }
  });

  document.addEventListener("keydown", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-act") === "subnew" && e.key === "Enter") { e.preventDefault(); addSub(e.target, keyOf(e.target)); }
    if (e.key === "Escape") closePicker();
  });

  function addSub(fromEl, key) {
    var box = fromEl.closest(".sub-add").querySelector(".sub-new");
    var v = (box.value || "").trim(); if (!v) return;
    patch(key, { subtasks: subs(key).concat([{ id: subUid(), t: v, done: false }]) });
    renderApps(); renderStudy(); renderPulse(); renderFive();
    // refocus the (re-rendered) input
    var node = document.querySelector('[data-key="' + cssEsc(key) + '"] .sub-new'); if (node) node.focus();
  }
  function cssEsc(s) { return s.replace(/(["\\])/g, "\\$1"); }

  // live text inputs
  document.addEventListener("input", function (e) {
    var a = e.target.getAttribute && e.target.getAttribute("data-act"); if (!a) return;
    var key = keyOf(e.target);
    if (a === "obj") patch(key, { objective: e.target.value });
    else if (a === "notes") patch(key, { notes: e.target.value });
    else if (a === "subedit") {
      var sid = e.target.closest("[data-sid]").getAttribute("data-sid");
      patch(key, { subtasks: subs(key).map(function (x) { return x.id === sid ? Object.assign({}, x, { t: e.target.value }) : x; }) });
    }
    else if (a === "week") { meta.weekOf = e.target.value; save(); cloudPushBoard(); }
    else if (a === "eowDone") { meta.eowDone = e.target.value; save(); cloudPushBoard(); }
    else if (a === "eowCarry") { meta.eowCarry = e.target.value; save(); cloudPushBoard(); }
    else if (a === "eowNotes") { meta.eowNotes = e.target.value; save(); cloudPushBoard(); }
  });

  // priority change handled via segmented control click (see document click handler)

  /* ---- backlog disclosure ---- */
  function wireDisclosure(headId, wrapId) {
    $(headId).addEventListener("click", function () { $(wrapId).classList.toggle("open"); });
  }

  /* ---- toolbar ---- */
  function loadSample() {
    state.apps = parseStatus(SAMPLE_STATUS);
    state.domains = parseListing(SAMPLE_DIR);
    if (!localStorage.getItem(K.seeded)) {
      entries = Object.assign(sampleEntries(), entries);
      targetOrder = ["app:FocusFlow", "app:VisionTrack", "app:LedgerLite", "study:LANGUAGES/Japanese/Kanji"];
      expanded = { "LANGUAGES/Japanese": true, "AI_AND_MATHS/Mathematics": true };
      localStorage.setItem(K.seeded, "1");
      save();
    }
    renderAll();
  }

  /* ---- toast ---- */
  var toastT;
  function toast(msg) { var el = $("toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, 2200); }
  function toastMaybeDone() { if (targetOrder.length && targetOrder.every(targetDone)) toast("\uD83C\uDF89 All five targets cleared this week."); }

  /* ============================================================
     DATA IN — connect files (Chrome/Edge) or paste; persists locally
     ============================================================ */
  var supportsFS = (typeof window.showOpenFilePicker === "function");
  var fileHandle = null, dirHandle = null;
  function dStatus(html, warn) { var el = $("dStatus"); if (!el) return; el.innerHTML = html; el.className = "dstatus" + (warn ? " warn" : ""); }

  function idb() { return new Promise(function (res, rej) { var r = indexedDB.open("wf2", 1); r.onupgradeneeded = function () { r.result.createObjectStore("h"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  async function idbSet(k, v) { var db = await idb(); return new Promise(function (res, rej) { var tx = db.transaction("h", "readwrite"); tx.objectStore("h").put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }
  async function idbGet(k) { var db = await idb(); return new Promise(function (res, rej) { var tx = db.transaction("h", "readonly"); var rq = tx.objectStore("h").get(k); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); }
  async function verifyPerm(h) { if (!h) return false; var o = { mode: "read" }; try { if ((await h.queryPermission(o)) === "granted") return true; if ((await h.requestPermission(o)) === "granted") return true; } catch (e) {} return false; }

  var MAXDEPTH = 4;
  async function readNode(handle, depth) {
    var children = [];
    for await (var entry of handle.values()) {
      if (entry.kind !== "directory" || skipFolder(entry.name)) continue;
      var node = { name: depth === 0 ? stripHash(entry.name).toUpperCase() : stripHash(entry.name), children: [] };
      if (depth < MAXDEPTH) node.children = await readNode(entry, depth + 1);
      children.push(node);
    }
    children.sort(function (a, b) { return a.name.localeCompare(b.name); });
    dedupeTree(children);
    return children;
  }
  async function readStatusFile() { var f = await fileHandle.getFile(); state.apps = parseStatus(await f.text()); saveInv(); renderAll(); }
  async function readDirHandle() { state.domains = await readNode(dirHandle, 0); saveInv(); renderAll(); }

  function wireData() {
    $("btnData").onclick = function () { $("dataModal").classList.add("open"); refreshDataUI(); };
    $("dataClose").onclick = function () { $("dataModal").classList.remove("open"); };
    $("dataModal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });

    $("dFile").onclick = async function () {
      if (!supportsFS) return dStatus("This browser can\u2019t open files directly \u2014 use <b>Paste</b> below. (Chrome / Edge support live file reading.)", true);
      try {
        var picked = await window.showOpenFilePicker({ types: [{ description: "Markdown / text", accept: { "text/markdown": [".md"], "text/plain": [".md", ".txt"] } }] });
        fileHandle = picked[0]; await idbSet("status", fileHandle); await readStatusFile();
        $("dRefresh").disabled = false;
        dStatus("Apps loaded from <b>" + esc(fileHandle.name) + "</b> \u2014 " + state.apps.filter(isActive).length + " active. Close this and curate your week.");
      } catch (e) { if (e.name !== "AbortError") dStatus("Couldn\u2019t read that file: " + esc(e.message), true); }
    };
    $("dDir").onclick = async function () {
      if (!supportsFS) return dStatus("This browser can\u2019t open folders directly \u2014 use <b>Paste</b> below. (Chrome / Edge support live folder reading.)", true);
      try {
        dirHandle = await window.showDirectoryPicker(); await idbSet("db", dirHandle); await readDirHandle();
        $("dRefresh").disabled = false;
        dStatus("Study topics loaded from <b>" + esc(dirHandle.name) + "/</b>. Close this and flip on what you\u2019re studying.");
      } catch (e) { if (e.name !== "AbortError") dStatus("Couldn\u2019t read that folder: " + esc(e.message), true); }
    };
    $("dRefresh").onclick = async function () {
      var got = [];
      try {
        if (fileHandle && (await verifyPerm(fileHandle))) { await readStatusFile(); got.push("apps"); }
        if (dirHandle && (await verifyPerm(dirHandle))) { await readDirHandle(); got.push("study"); }
        dStatus("Refreshed " + (got.join(" + ") || "nothing") + " \u00b7 " + new Date().toLocaleTimeString());
      } catch (e) { dStatus("Refresh failed: " + esc(e.message), true); }
    };
    $("dBuild").onclick = function () {
      var s = $("dTaStatus").value.trim(), d = $("dTaDir").value.trim(), done = [];
      if (s) { state.apps = parseStatus(s); done.push(state.apps.length + " apps"); }
      if (d) { state.domains = parseListing(d); done.push(state.domains.length + " study domains"); }
      if (!done.length) return dStatus("Paste into at least one box first.", true);
      saveInv(); renderAll();
      dStatus("Built from pasted data: " + done.join(" \u00b7 ") + ". Close this and curate your week.");
    };
  }
  function refreshDataUI() {
    if (!supportsFS) { dStatus("Live file reading needs <b>Chrome</b> or <b>Edge</b>. Here, use <b>Paste</b> below \u2014 it always works.", true); ["dFile", "dDir", "dRefresh"].forEach(function (id) { $(id).disabled = true; }); }
    else { $("dRefresh").disabled = !(fileHandle || dirHandle); }
  }
  async function restoreHandles() {
    if (!supportsFS) return;
    try { fileHandle = (await idbGet("status")) || null; dirHandle = (await idbGet("db")) || null; } catch (e) {}
  }

  /* ============================================================
     CLOUD SYNC — Supabase anon, board-keyed (no auth, RLS off).
     Mirrors the Roadmap model: a fixed default user_id is filled by
     the column default server-side, so the client never sends user_id
     and never signs in. Connection is hardcoded (see CLOUD_DEFAULTS)
     so a fresh device syncs board "my_week" with zero setup; the Cloud
     panel is an optional override. Same tables + item_key format.
     Board-level state (The Five order + week/EOW notes) rides on a
     synthetic entry keyed "__board" so no schema change is needed.
     ============================================================ */
  function cloudConfigured() { return !!(cloud && cloud.url && cloud.key && cloud.board); }
  function syncReady() { return !!(sb && cloudConfigured()); }
  function looksSecret(k) { return /^sb_secret_/i.test(k) || /service_role/i.test(k); }
  function saveCloud() { try { localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud)); } catch (e) {} }
  function saveOutbox() { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (e) {} }

  function ensureClient() {
    if (sb) return sb;
    if (!cloudConfigured() || typeof window.supabase === "undefined") return null;
    // anon client — no sign-in; reads & writes go through as the anon role
    sb = window.supabase.createClient(cloud.url, cloud.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    return sb;
  }
  function dropClient() { sb = null; }

  function queue(qkey, op) { outbox[qkey] = op; saveOutbox(); flushOutbox(); updateCloudStatus(); }
  function cloudPushEntry(key, payload) {
    if (!cloudConfigured()) return;
    queue("entry:" + key, { table: "weekly_focus_entries", onConflict: "user_id,board_id,item_key", row: { board_id: cloud.board, item_key: key, payload: payload, updated_at: new Date().toISOString() } });
  }
  function cloudPushBoard() { if (!cloudConfigured()) return; cloudPushEntry(BOARD_ITEM, { targetOrder: targetOrder, meta: meta }); }
  function cloudPushApps() { if (!cloudConfigured() || !state.apps) return; queue("inv:apps", { table: "weekly_focus_inventory", onConflict: "user_id,board_id", row: { board_id: cloud.board, apps: state.apps, updated_at: new Date().toISOString() } }); }
  function cloudPushStudy() { if (!cloudConfigured() || !state.domains) return; queue("inv:study", { table: "weekly_focus_inventory", onConflict: "user_id,board_id", row: { board_id: cloud.board, study: state.domains, updated_at: new Date().toISOString() } }); }

  async function flushOutbox() {
    if (!syncReady() || flushing) return;
    flushing = true;
    var keys = Object.keys(outbox);
    for (var i = 0; i < keys.length; i++) {
      var op = outbox[keys[i]];
      // never send user_id — the column default fills the fixed owner (matches Roadmap)
      try { var r = await sb.from(op.table).upsert(op.row, { onConflict: op.onConflict }); if (r.error) throw r.error; delete outbox[keys[i]]; saveOutbox(); }
      catch (e) { break; }   // offline / transient → stay queued
    }
    flushing = false; updateCloudStatus();
  }
  async function cloudPullEntries() {
    if (!syncReady()) return;
    try {
      var r = await sb.from("weekly_focus_entries").select("item_key,payload").eq("board_id", cloud.board);
      if (r.error) throw r.error;
      var map = {}; (r.data || []).forEach(function (row) { map[row.item_key] = row.payload || {}; });
      // pending local writes win over remote
      Object.keys(outbox).forEach(function (qk) { if (qk.indexOf("entry:") === 0) { var op = outbox[qk]; map[op.row.item_key] = op.row.payload; } });
      // board-level state rides on a synthetic item
      if (map[BOARD_ITEM]) { var b = map[BOARD_ITEM]; delete map[BOARD_ITEM]; if (Array.isArray(b.targetOrder)) targetOrder = b.targetOrder; if (b.meta) meta = b.meta; }
      entries = map; save(); renderAll(); updateCloudStatus();
    } catch (e) { updateCloudStatus(); }
  }
  async function cloudPullInventory(force) {
    if (!syncReady()) return false;
    try {
      var r = await sb.from("weekly_focus_inventory").select("apps,study").eq("board_id", cloud.board).limit(1);
      if (r.error) throw r.error;
      var rows = r.data || [];
      if (rows.length && (force || !hasLocalSource)) {
        if (rows[0].apps) state.apps = rows[0].apps;
        if (rows[0].study) state.domains = rows[0].study;
        try { localStorage.setItem(K.inv, JSON.stringify({ apps: state.apps, domains: state.domains })); } catch (e) {}
        renderAll();
      }
      return !!rows.length;
    } catch (e) { return false; }
  }
  function initialSync() {
    cloudPushApps(); cloudPushStudy(); cloudPushBoard();
    Object.keys(entries).forEach(function (k) { cloudPushEntry(k, entries[k]); });
    flushOutbox().then(function () { cloudPullInventory(false).then(cloudPullEntries); });
  }
  function pendingCount() { return Object.keys(outbox).length; }
  function updateCloudStatus() {
    var el = $("cloudPill"); if (!el) return;
    if (!cloudConfigured()) { el.className = "cloud-pill off"; el.textContent = "\u2601 Cloud off"; return; }
    var n = pendingCount();
    if (!navigator.onLine) { el.className = "cloud-pill warn"; el.textContent = "\u2601 Offline" + (n ? " \u00b7 " + n : ""); }
    else if (n) { el.className = "cloud-pill warn"; el.textContent = "\u2601 Syncing " + n + "\u2026"; }
    else { el.className = "cloud-pill ok"; el.textContent = "\u2601 Synced"; }
  }
  function startCloud() {
    ensureClient(); updateCloudStatus();
    if (syncReady()) initialSync();   // push local + pull board on load (no sign-in needed)
    setInterval(function () { if (document.visibilityState === "visible" && navigator.onLine && syncReady()) { flushOutbox(); cloudPullInventory(false); cloudPullEntries(); } }, 15000);
    window.addEventListener("online", function () { if (syncReady()) { flushOutbox(); cloudPullEntries(); } updateCloudStatus(); });
    window.addEventListener("offline", updateCloudStatus);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && syncReady()) { flushOutbox(); cloudPullEntries(); } });
  }
  function cloudSetStatus(html, warn) { var el = $("cloudStatus"); if (!el) return; el.innerHTML = html; el.className = "dstatus" + (warn ? " warn" : ""); }
  function fillCloud() { if (cloud.url) $("cfUrl").value = cloud.url; if (cloud.key) $("cfKey").value = cloud.key; $("cfBoard").value = cloud.board || ""; }
  function wireCloud() {
    $("btnCloud").onclick = function () { $("cloudModal").classList.add("open"); fillCloud(); updateCloudStatus(); };
    $("cloudClose").onclick = function () { $("cloudModal").classList.remove("open"); };
    $("cloudModal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });
    $("cloudSave").onclick = function () {
      var next = {
        url: ($("cfUrl").value.trim() || CLOUD_DEFAULTS.url),
        key: ($("cfKey").value.trim() || CLOUD_DEFAULTS.key),
        board: ($("cfBoard").value.trim() || CLOUD_DEFAULTS.board)
      };
      if (next.key && looksSecret(next.key)) { cloudSetStatus("That looks like a <b>secret</b> key. Use the <b>publishable</b> key (<code>sb_publishable_\u2026</code>), never a secret / service_role key.", true); return; }
      var changed = !cloud || cloud.url !== next.url || cloud.key !== next.key;
      cloud = next; saveCloud();
      if (changed) dropClient();
      ensureClient(); updateCloudStatus();
      if (syncReady()) { initialSync(); cloudSetStatus("Cloud connected. Board <b>" + esc(cloud.board) + "</b> - syncing across your devices."); }
      else cloudSetStatus("Saved, but the Supabase client could not start (offline, or the CDN is blocked). It will retry on reload.", true);
    };
  }

  function init() {
    wireDisclosure("appsBacklogHead", "appsBacklogWrap");
    wireDisclosure("studyTreeHead", "studyTreeWrap");
    $("btnSample").onclick = loadSample;
    $("btnPrint").onclick = function () { window.print(); };
    $("btnReset").onclick = function () {
      if (!confirm("Reset this week? Clears your curation, targets, objectives and notes — your loaded Apps/Study inventory stays.")) return;
      entries = {}; targetOrder = []; detailOpen = {}; meta = {}; localStorage.removeItem(K.seeded);
      save();
      var inv = loadInv();
      if (inv) { state.apps = inv.apps || null; state.domains = inv.domains || null; renderAll(); }
      else { loadSample(); }
      toast("Week reset.");
    };
    $("weekInput").addEventListener("input", function (e) { meta.weekOf = e.target.value; save(); });
    $("pickClose").onclick = closePicker;
    $("pickModal").addEventListener("click", function (e) { if (e.target === this) closePicker(); });
    wireData();
    wireCloud();

    // boot: prefer real inventory loaded earlier on this device; else sample so it's always interactive
    var inv = loadInv();
    if (inv) { state.apps = inv.apps || null; state.domains = inv.domains || null; hasLocalSource = true; renderAll(); }
    else { loadSample(); }
    restoreHandles();
    startCloud();   // no-op until you connect a Supabase project in the Cloud panel
  }

  // expose parsers for real data wiring
  window.__wfp = {
    parseStatus: parseStatus, parseListing: parseListing,
    setData: function (a, d) { if (a) state.apps = a; if (d) state.domains = d; saveInv(); renderAll(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
