/* ============================================================
   Weekly Focus — app logic (vanilla, self-contained)
   Source of truth: Supabase (when connected) + localStorage cache.
   Inventory (apps + study topics) is managed ENTIRELY IN-APP:
   add / rename / re-group / delete. No files, no sample data, no
   boot-time overwrite — nothing silently erases your week.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- icons ---------------- */
  var IC = {
    chev: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.85 5.9 6.5.8-4.8 4.5 1.25 6.4L12 17.7 6.2 20.6l1.25-6.4L2.65 9.3l6.5-.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4.5"/><path d="M5 4.5c4.2-2 6.3 2 10.5 0V13c-4.2 2-6.3-2-10.5 0z"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 1.5M9.5 2.5h5"/></svg>'
  };

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function hueFor(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }

  /* ---------------- ring builder ---------------- */
  function ringSVG(pct, size, sw, cls) {
    var r = (size - sw) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
    var ctr = size / 2;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle class="' + cls.t + '" cx="' + ctr + '" cy="' + ctr + '" r="' + r + '" fill="none" stroke-width="' + sw + '"/>' +
      '<circle class="' + cls.f + '" cx="' + ctr + '" cy="' + ctr + '" r="' + r + '" fill="none" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>';
  }

  /* ============================================================
     STATE + PERSISTENCE
     ============================================================ */
  var K = { entries: "wf2_entries", meta: "wf2_meta", targets: "wf2_targets", inv: "wf2_inv" };
  var state = { apps: [], study: [], office: [] };
  var itemIndex = {};               // id -> item (across apps + study)
  var invTs = "";                   // last-applied inventory timestamp (last-write-wins across devices)
  var entries = {};                 // id -> { active, pri, objective, subtasks[], notes, targetDone } — loaded from Supabase
  var meta = {};                    // { weekOf, eowDone, eowCarry, eowNotes } — loaded from Supabase
  var targetOrder = [];             // The Five — loaded from Supabase
  var detailOpen = {};

  /* cloud state — the connection is baked into the build (config.js), NOT localStorage,
     so it can never be lost to storage eviction. Supabase is the source of truth. */
  var CLOUD_KEY = "wf2_cloud", OUTBOX_KEY = "wf2_outbox", BOARD_ITEM = "__board";
  var cloud = (window.WF_CONFIG && WF_CONFIG.url)
    ? { url: WF_CONFIG.url, key: WF_CONFIG.key, board: WF_CONFIG.board || "my-week" }
    : load(CLOUD_KEY);
  /* which board is selected is a tiny UI preference (NOT your data — that lives in
     Supabase). If it's ever evicted you just land back on the default board. */
  try { var _ab = localStorage.getItem("wf2_active_board"); if (_ab && window.WF_CONFIG) cloud.board = _ab; } catch (e) {}
  var outbox = {};                  // in-memory write queue — never persisted to localStorage
  var flushing = false, sb = null, session = null, authSub = null;
  var lastCloudSig = "";            // signature of the last-rendered board — skip no-op re-renders
  var boardU = 0;                   // last local board write (ms) — stale pulls must not undo a fresh star
  var firstPull = true;             // animate the entrance only on the very first cloud load

  function load(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }
  function loadArr(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
  /* Data is never written to localStorage — it lives in Supabase. save() is a no-op;
     every mutation is pushed to the database through the cloudPush* helpers below. */
  function save() {}
  function getEntry(k) { return entries[k] || {}; }
  function patch(k, p) { entries[k] = Object.assign({}, entries[k], p); save(); cloudPushEntry(k, entries[k]); }

  /* ---------------- inventory (in-app, Supabase-backed) ---------------- */
  function rebuildIndex() { itemIndex = {}; state.apps.forEach(function (a) { itemIndex[a.id] = a; }); state.study.forEach(function (s) { itemIndex[s.id] = s; }); (state.office || []).forEach(function (o) { itemIndex[o.id] = o; }); }
  function itemById(id) { return itemIndex[id] || null; }
  function kindOf(id) { return id.indexOf("study:") === 0 ? "study" : id.indexOf("office:") === 0 ? "office" : "app"; }
  function arrFor(kind) { return kind === "study" ? state.study : kind === "office" ? state.office : state.apps; }

  /* Convert legacy file-shaped inventory (apps w/ category, study as folder tree)
     into the flat in-app shape. IDs are kept identical to the old item_keys
     (app:Name / study:DOM/.../Leaf) so existing curation reattaches untouched. */
  function normalizeInventory(rawApps, rawStudy) {
    var seedActive = {};
    var apps = (rawApps || []).map(function (a) {
      if (a && a.id) return { id: a.id, name: a.name, group: a.group || "Other" };
      if (a && a.group === "Active") seedActive["app:" + a.name] = true;       // old status column
      return { id: "app:" + a.name, name: a.name, group: a.category || "Other" };
    });
    var study = [];
    if (Array.isArray(rawStudy) && rawStudy.length && rawStudy[0] && !rawStudy[0].children) {
      study = rawStudy.map(function (s) { return s.id ? { id: s.id, name: s.name, group: s.group || "Other" } : { id: "study:" + s.name, name: s.name, group: s.group || "Other" }; });
    } else if (Array.isArray(rawStudy)) {
      rawStudy.forEach(function (dom) {                                         // old folder tree → flat leaves
        (function rec(node, anc) {
          var names = anc.concat([node.name]);
          if (!node.children || !node.children.length) {
            var path = dom.name + "/" + names.join("/");
            study.push({ id: "study:" + path, name: node.name, group: dom.name });
          } else node.children.forEach(function (c) { rec(c, names); });
        });
        (dom.children || []).forEach(function (c) {
          (function rec(node, anc) {
            var names = anc.concat([node.name]);
            if (!node.children || !node.children.length) study.push({ id: "study:" + dom.name + "/" + names.join("/"), name: node.name, group: dom.name });
            else node.children.forEach(function (k) { rec(k, names); });
          })(c, []);
        });
      });
    }
    return { apps: apps, study: study, seedActive: seedActive };
  }

  function setInventory(rawApps, rawStudy, applySeed) {
    var n = normalizeInventory(rawApps, rawStudy);
    state.apps = n.apps; state.study = n.study; rebuildIndex();
    if (applySeed) Object.keys(n.seedActive).forEach(function (id) { if (entries[id] == null || entries[id].active == null) entries[id] = Object.assign({ active: true }, entries[id]); });
  }
  function saveInv(pushUp) {
    invTs = nowISO();
    if (pushUp !== false) cloudPushInv();   // inventory lives in Supabase, not localStorage
  }
  /* No local inventory cache any more — the inventory is pulled from Supabase on
     sign-in. Kept as a no-op so existing call sites stay valid. */
  function loadInvLocal() { return false; }

  /* ---------------- CRUD ---------------- */
  function addItem(kind, name, group) {
    name = (name || "").trim(); if (!name) return null;
    group = (group || "").trim() || (kind === "app" ? "Other" : "General");
    var id = kind + ":" + uid();
    arrFor(kind).push({ id: id, name: name, group: group }); rebuildIndex();
    patch(id, { active: true });               // new items land in This Week
    saveInv(); renderAll(); return id;
  }
  function renameItem(id, name) { var it = itemById(id); if (!it) return; it.name = (name || "").trim() || it.name; saveInv(); }
  function regroupItem(id, group) { var it = itemById(id); if (!it) return; it.group = (group || "").trim() || it.group; saveInv(); renderAll(); }
  function deleteItem(id) {
    var arr = arrFor(kindOf(id)), i = arr.findIndex(function (x) { return x.id === id; });
    if (i >= 0) arr.splice(i, 1);
    rebuildIndex(); removeTarget(id); delete entries[id]; delete detailOpen[id];
    save(); saveInv(); cloudDeleteEntry(id); renderAll();
  }

  /* ---------------- model accessors ---------------- */
  function isActive(item) { var e = entries[item.id]; return !!(e && e.active === true); }
  function priOf(id) { var e = entries[id]; return (e && e.pri) || null; }
  function priRankOf(id) { var e = entries[id]; return (e && e.pri) ? PRI_RANK[e.pri] : 3; }
  function activeItems(kind) { return arrFor(kind).filter(isActive); }
  function backlogItems(kind) { return arrFor(kind).filter(function (x) { return !isActive(x); }); }

  var APP_CATS = ["General Purpose", "Mechanical", "Language Study", "Other"];
  var CAT_CLASS = { "General Purpose": "cat-gp", "Mechanical": "cat-mech", "Language Study": "cat-lang", "Other": "cat-other" };
  var PRI_RANK = { H: 0, M: 1, L: 2 };

  /* view: false = flat list, categories shown as tags on cards (default);
           true  = classic category sections. Persisted UI preference. */
  var VIEW_GROUPED = false;
  try { VIEW_GROUPED = localStorage.getItem("wf2_view_grouped") === "1"; } catch (e) {}

  /* ---------------- subtask progress ---------------- */
  function subs(k) { var a = getEntry(k).subtasks; return Array.isArray(a) ? a : []; }
  function subProgress(k) { var a = visibleSubs(subs(k)); if (!a.length) return null; var d = a.filter(function (x) { return x.done; }).length; return { done: d, total: a.length, pct: d / a.length }; }

  /* ---- subtask identity + cross-device merge ----
     Each subtask carries: { id, t, done, u (last-edit ms), del (tombstone) }.
     Merge is a union by id with per-subtask last-write-wins, so subtasks added on
     different devices both survive; a delete sets del+u (high) so it wins over a
     stale copy instead of being resurrected. Legacy subtasks (no id) get a stable
     id derived from their text so the same legacy item dedupes across devices. */
  function subLegacyId(t) { var s = String(t || ""), h = 5381; for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; } return "l_" + h.toString(36); }
  function normSubs(arr) {
    return (Array.isArray(arr) ? arr : []).map(function (s) {
      if (!s) return null;
      return { id: s.id || subLegacyId(s.t), t: s.t || "", done: !!s.done, u: s.u || 0, del: !!s.del, when: s.when || "", md: s.md || "b", urg: !!s.urg, dl: !!s.dl };
    }).filter(Boolean);
  }
  function mergeSubs(a, b) {
    var by = {}, order = [];
    function take(s) {
      var ex = by[s.id];
      if (!ex) { by[s.id] = s; order.push(s.id); return; }
      if ((s.u || 0) > (ex.u || 0)) by[s.id] = s;
      else if ((s.u || 0) === (ex.u || 0)) by[s.id] = { id: ex.id, t: ex.t || s.t, done: ex.done || s.done, u: ex.u, del: ex.del || s.del, when: ex.when || s.when, md: ex.md !== "b" ? ex.md : s.md, urg: ex.urg || s.urg, dl: ex.dl || s.dl };
    }
    normSubs(a).forEach(take); normSubs(b).forEach(take);
    return order.map(function (id) { return by[id]; });
  }
  function visibleSubs(arr) { return normSubs(arr).filter(function (s) { return !s.del; }); }
  function subsKey(arr) { return JSON.stringify(normSubs(arr).map(function (s) { return [s.id, s.t, s.done ? 1 : 0, s.del ? 1 : 0, s.u || 0, s.when || "", s.md || "b", s.urg ? 1 : 0, s.dl ? 1 : 0]; }).sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; })); }
  function subsDiffer(a, b) { return subsKey(a) !== subsKey(b); }

  /* ---------------- targets (The Five) ---------------- */
  var MAX_TARGETS = 5;
  function isTarget(k) { return targetOrder.indexOf(k) >= 0; }
  function addTarget(k) { if (isTarget(k) || targetOrder.length >= MAX_TARGETS) return false; targetOrder.push(k); save(); cloudPushBoard(); return true; }
  function removeTarget(k) { var i = targetOrder.indexOf(k); if (i >= 0) { targetOrder.splice(i, 1); if (entries[k]) patch(k, { targetDone: false }); save(); cloudPushBoard(); } }
  function targetDone(k) { return getEntry(k).targetDone === true; }
  function pruneTargets() { targetOrder = targetOrder.filter(function (k) { var it = itemById(k); return it && isActive(it); }); }
  function labelFor(k) { var it = itemById(k); return it ? { name: it.name, crumb: it.group } : { name: k, crumb: "" }; }

  /* ============================================================
     RENDER
     ============================================================ */
  /* ---- liveliness state (entrance, detail-open, ring count-up, drag) ---- */
  var ENTER = false;        // one-shot: entrance-animate the next full render
  var OPENING = null;       // id whose detail panel should play the open animation
  var lastPctShown = 0;     // previous hero-ring value, for the count-up + sweep
  var DRAG = { id: null, type: null, kind: null };

  function renderAll() {
    pruneTargets(); renderPulse(); renderFive(); renderCols(); renderMeta(); renderHome();
    if (ENTER) { ENTER = false; setTimeout(function () { var ns = document.querySelectorAll(".wf-enter"); for (var i = 0; i < ns.length; i++) ns[i].classList.remove("wf-enter"); }, 720); }
    lastCloudSig = boardSig();
  }

  function renderPulse() {
    var done = targetOrder.filter(targetDone).length, total = targetOrder.length;
    var pct = total ? done / total : 0;
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
          '<div class="pstat apps"><span class="n">' + activeItems("app").length + '</span><span class="l">Apps active</span></div>' +
          '<div class="pstat study"><span class="n">' + activeItems("study").length + '</span><span class="l">Topics active</span></div>' +
        '</div></div>';
    // count the percentage up, and sweep the ring from its previous value
    var pctEl = el.querySelector(".pct");
    if (pctEl) animateCount(pctEl, Math.round(lastPctShown * 100), Math.round(pct * 100));
    var fill = el.querySelector(".ring .fill");
    if (fill) { var rr = (96 - 9) / 2, cc = 2 * Math.PI * rr; fill.style.strokeDashoffset = (cc * (1 - lastPctShown)).toFixed(1); requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.strokeDashoffset = (cc * (1 - pct)).toFixed(1); }); }); }
    lastPctShown = pct;
  }

  function renderFive() {
    var grid = $("fiveGrid"); grid.innerHTML = "";
    if (ENTER) grid.classList.add("wf-enter");
    targetOrder.forEach(function (k, i) {
      var lab = labelFor(k), done = targetDone(k), prog = subProgress(k);
      var card = document.createElement("div");
      card.className = "tcard" + (done ? " done" : "");
      card.setAttribute("data-tkey", k);
      card.setAttribute("draggable", "true");
      var m = lab.crumb ? esc(lab.crumb) : (kindOf(k) === "app" ? "App" : "Study");
      if (prog) m += " \u00b7 " + prog.done + "/" + prog.total;
      var sv = visibleSubs(subs(k));
      var subList = sv.length ? '<ul class="tsubs" data-key="' + esc(k) + '">' + sv.map(function (x) {
        return '<li data-sid="' + esc(x.id) + '"><button class="sub-check' + (x.done ? " on" : "") + '" data-act="subtoggle" aria-label="done"></button><span class="tsub-text">' + esc(x.t || "subtask") + '</span></li>';
      }).join("") + '</ul>' : '';
      card.innerHTML =
        '<span class="tnum">TARGET ' + (i + 1) + '</span>' +
        '<button class="tcheck' + (done ? " on" : "") + '" data-act="tdone" title="Mark done"></button>' +
        '<div class="ttitle">' + esc(lab.name) + '</div>' +
        '<div class="tmeta">' + m + '</div>' +
        subList +
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

  /* ---- scheduled tasks: date (+ optional time) on Special subtasks ---- */
  var WF_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WF_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtTime(t) { var h = parseInt(t.slice(0, 2), 10), m = t.slice(3, 5), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + m + " " + ap; }
  function whenInfo(w) {
    var ds = w.slice(0, 10), tm = w.length > 10 ? w.slice(11, 16) : "";
    var d = new Date(ds + "T00:00:00"), now = new Date();
    if (isNaN(d)) return null;
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((d - today) / 86400000);
    var lbl = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday"
      : (diff > 1 && diff < 7) ? WF_DOW[d.getDay()] : WF_MON[d.getMonth()] + " " + d.getDate();
    var time = tm ? fmtTime(tm) : "";
    /* deadline zone (build 17): overdue, past its time today, or inside the
       final 3 hours before a timed deadline \u2192 the task turns ASAP-red. */
    var minsLeft = null, pastDue = diff < 0;
    if (diff === 0 && tm) {
      minsLeft = (parseInt(tm.slice(0, 2), 10) * 60 + parseInt(tm.slice(3, 5), 10)) - (now.getHours() * 60 + now.getMinutes());
      if (minsLeft < 0) pastDue = true;
    }
    var asap = pastDue || (diff === 0 && (!tm || minsLeft <= 180));
    return {
      diff: diff, day: d.getDate(), dow: WF_DOW[d.getDay()], time: time,
      hasTime: !!tm, minsLeft: minsLeft, pastDue: pastDue, asap: asap,
      label: lbl + (time ? " \u00b7 " + time : ""),
      rel: diff < 0 ? (-diff) + "d overdue" : pastDue ? "past due" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : "in " + diff + " days",
      cls: pastDue ? " over" : diff === 0 ? " today" : "",
      full: WF_DOW[d.getDay()] + ", " + WF_MON[d.getMonth()] + " " + d.getDate() + (time ? " at " + time : "")
    };
  }
  function whenChipHtml(x) {
    if (!x.when) return '<button class="sub-when add" data-act="whenedit" title="Add a date">' + IC.cal + '</button>';
    var v = whenView(x);
    if (!v) return '<button class="sub-when add" data-act="whenedit" title="Add a date">' + IC.cal + '</button>';
    return '<button class="sub-when' + (x.done ? " done" : v.cls) + '" data-act="whenedit" title="' + esc(v.w.full) + ' \u2014 click to change">' + esc(v.label) + '</button>';
  }
  /* ---- task metadata (build 17): mode tag + urgent flag ---- */
  var spReveal = {};   // per-card: temporarily reveal tasks hidden by the mode filter
  function subModeOk(md, mode) { md = md || "b"; return md === "b" || md === (mode === "office" ? "o" : "p"); }
  function subRank(x) {
    if (x.done) return 6;
    var v = whenView(x);
    if (v && v.w.pastDue) return 0;   // overdue outranks everything \u2014 even urgent
    if (x.urg) return 1;
    if (!v) return 5;
    return v.asap ? 2 : v.soon ? 3 : 4;
  }
  function subModeTag(x) {
    var md = x.md || "b";
    if (md === "b") return "";
    return '<span class="sub-mode ' + md + '">' + (md === "o" ? "Office" : "Personal") + "</span>";
  }
  function subFlagBtn(x) {
    return '<button class="sub-flag' + (x.urg ? " on" : "") + '" data-act="urgtoggle" title="' + (x.urg ? "Urgent \u2014 tap to clear" : "Mark urgent \u2014 pins it on top in red") + '">' + IC.flag + "</button>";
  }

  /* ---- dated view of a task. Countdown-deadline (dl) tasks escalate:
     "N days left" \u2014 amber inside 7 days, red/ASAP inside 2. ---- */
  function whenView(x) {
    if (!x.when) return null;
    var w = whenInfo(x.when); if (!w) return null;
    var v = { w: w, label: w.label, rel: w.rel, cls: w.cls, asap: w.asap, soon: false };
    if (x.dl && w.diff > 0) {
      v.label = w.diff + (w.diff === 1 ? " day left" : " days left");
      v.rel = v.label;
      if (w.diff <= 2) { v.asap = true; v.cls = " over"; }
      else if (w.diff <= 7) { v.soon = true; v.cls = " soon"; }
      else v.cls = "";
    }
    return v;
  }

  /* ---- mode hours: when single-mode tasks are live on the Today screen ---- */
  function modeHours() {
    var h = meta.hours || {};
    return { p: Array.isArray(h.p) ? h.p : ["19:00", "22:00"], o: Array.isArray(h.o) ? h.o : ["09:00", "18:00"] };
  }
  function hhmmNow() { var n = new Date(); return String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0"); }
  function inWindow(md) {
    if (!md || md === "b") return true;
    var r = modeHours()[md], n = hhmmNow();
    if (!r || !r[0] || !r[1]) return true;
    return r[0] <= r[1] ? (n >= r[0] && n <= r[1]) : (n >= r[0] || n <= r[1]);
  }
  function fmtRange(r) { return fmtTime(r[0]) + "\u2013" + fmtTime(r[1]); }
  function openHours() {
    var h = modeHours();
    $("hrOs").value = h.o[0]; $("hrOe").value = h.o[1];
    $("hrPs").value = h.p[0]; $("hrPe").value = h.p[1];
    $("hoursModal").classList.add("open");
  }
  function saveHours() {
    meta.hours = {
      o: [$("hrOs").value || "09:00", $("hrOe").value || "18:00"],
      p: [$("hrPs").value || "19:00", $("hrPe").value || "22:00"]
    };
    save(); cloudPushBoard();
    $("hoursModal").classList.remove("open");
    renderHome(); toast("Hours saved.");
  }

  /* ---- task sheet: date + time + mode + urgent in one tap-friendly editor ---- */
  var TSK = { key: null, sid: null, date: "", time: "", md: "b", urg: false, loc: "" };
  var TK_TIMES = ["", "09:00", "12:00", "15:00", "18:00", "21:00"];
  function openTaskSheet(key, sid) {
    var x = null; normSubs(subs(key)).forEach(function (s) { if (s.id === sid) x = s; });
    if (!x) return;
    TSK = { key: key, sid: sid, date: (x.when || "").slice(0, 10), time: (x.when || "").length > 10 ? x.when.slice(11, 16) : "", md: x.md || "b", urg: !!x.urg, dl: !!x.dl, loc: x.loc || "" };
    $("tkName").textContent = x.t || "task";
    renderTaskSheet();
    $("taskModal").classList.add("open");
  }
  function tkDateChips() {
    var out = [{ v: "", l: "No date" }], d = new Date();
    for (var i = 0; i < 7; i++) {
      out.push({ v: hIso(d), l: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function renderTaskSheet() {
    var dc = tkDateChips();
    var known = dc.some(function (c) { return c.v === TSK.date; });
    $("tkDates").innerHTML = dc.map(function (c) {
      return '<button type="button" class="chip' + (c.v === TSK.date ? " on" : "") + '" data-tkdate="' + c.v + '">' + c.l + "</button>";
    }).join("") + '<label class="chip pickc' + (!known && TSK.date ? " on" : "") + '">' + (!known && TSK.date ? esc(hFmt(TSK.date)) : "Pick\u2026") + '<input type="date" id="tkDateInput" value="' + esc(TSK.date) + '"></label>';
    var knownT = TK_TIMES.indexOf(TSK.time) >= 0;
    var dis = TSK.date ? "" : " disabled";
    $("tkTimes").innerHTML = TK_TIMES.map(function (t) {
      return '<button type="button" class="chip' + (t === TSK.time ? " on" : "") + '" data-tktime="' + t + '"' + dis + ">" + (t ? fmtTime(t) : "No time") + "</button>";
    }).join("") + '<label class="chip pickc' + (!knownT ? " on" : "") + '"' + dis + ">" + (!knownT && TSK.time ? fmtTime(TSK.time) : "Pick\u2026") + '<input type="time" id="tkTimeInput" value="' + esc(TSK.time) + '"' + dis + "></label>";
    $("tkMode").innerHTML = [["p", "Personal"], ["o", "Office"], ["b", "Both"]].map(function (m) {
      return '<button type="button" class="chip' + (TSK.md === m[0] ? " on" : "") + '" data-tkmd="' + m[0] + '">' + m[1] + "</button>";
    }).join("");
    var lel = $("tkLoc");
    if (lel) {
      var lsg = locSuggestions();
      if (TSK.loc && lsg.map(function (l) { return l.toLowerCase(); }).indexOf(TSK.loc.toLowerCase()) < 0) lsg.push(TSK.loc);
      lel.innerHTML = '<button type="button" class="chip' + (!TSK.loc ? " on" : "") + '" data-tkloc="">No place</button>' +
        lsg.map(function (l) { return '<button type="button" class="chip' + (l.toLowerCase() === TSK.loc.toLowerCase() ? " on" : "") + '" data-tkloc="' + esc(l) + '">' + esc(l) + "</button>"; }).join("") +
        '<button type="button" class="chip" data-tklocnew="1">+ New…</button>';
    }
    var ub = $("tkUrg");
    ub.classList.toggle("on", TSK.urg);
    ub.innerHTML = IC.flag + "<span>" + (TSK.urg ? "Urgent \u2014 pinned on top in red" : "Mark as urgent") + "</span>";
    var db = $("tkDl");
    if (db) {
      var dlOn = !!(TSK.dl && TSK.date);
      db.classList.toggle("on", dlOn);
      if (TSK.date) db.removeAttribute("disabled"); else db.setAttribute("disabled", "");
      db.innerHTML = IC.timer + "<span>" + (dlOn ? "Countdown on \u2014 escalates as the date nears" : TSK.date ? "Add countdown \u2014 escalate as the date nears" : "Pick a date to add a countdown") + "</span>";
    }
    var di = $("tkDateInput"); if (di) di.onchange = function () { TSK.date = di.value; if (!TSK.date) TSK.time = ""; renderTaskSheet(); };
    var ti = $("tkTimeInput"); if (ti) ti.onchange = function () { TSK.time = ti.value; renderTaskSheet(); };
  }
  function saveTaskSheet() {
    var when = TSK.date ? TSK.date + (TSK.time ? "T" + TSK.time : "") : "";
    patch(TSK.key, { subtasks: normSubs(subs(TSK.key)).map(function (x) { return x.id === TSK.sid ? Object.assign({}, x, { when: when, md: TSK.md, urg: TSK.urg, dl: !!(TSK.dl && TSK.date), loc: TSK.loc || "", u: Date.now() }) : x; }) });
    $("taskModal").classList.remove("open");
    renderCols(); renderHome();
    toast("Task updated.");
  }
  function wireTaskSheet() {
    var tm = $("taskModal"); if (!tm) return;
    tm.addEventListener("click", function (e) {
      if (e.target === tm) { tm.classList.remove("open"); return; }
      var b = e.target.closest("[data-tkdate],[data-tktime],[data-tkmd],[data-tkloc],[data-tklocnew]");
      if (!b) return;
      if (b.hasAttribute("data-tklocnew")) { var nl = (prompt("Place name (e.g. Home, Shin-\u014ckubo):") || "").trim(); if (nl) TSK.loc = addMetaLoc(nl); }
      else if (b.hasAttribute("data-tkloc")) TSK.loc = b.getAttribute("data-tkloc");
      else if (b.hasAttribute("data-tkdate")) { TSK.date = b.getAttribute("data-tkdate"); if (!TSK.date) TSK.time = ""; }
      else if (b.hasAttribute("data-tktime")) TSK.time = b.getAttribute("data-tktime");
      else TSK.md = b.getAttribute("data-tkmd");
      renderTaskSheet();
    });
    $("tkUrg").onclick = function () { TSK.urg = !TSK.urg; renderTaskSheet(); };
    var dlb = $("tkDl"); if (dlb) dlb.onclick = function () { TSK.dl = !TSK.dl; renderTaskSheet(); };
    $("tkSave").onclick = saveTaskSheet;
    $("tkClose").onclick = function () { $("taskModal").classList.remove("open"); };
  }

  /* ---- Special: life-admin errands, always visible, never in the columns ---- */
  function isSpecialItem(it) { return !!it && (it.group || "").trim().toLowerCase() === "special"; }
  function renderCols() { renderColumn("app"); renderColumn("study"); renderColumn("office"); renderSpecial(); }
  function spordOf(id) { var e = entries[id]; return (e && e.spord != null) ? e.spord : null; }
  function specialSorted() {
    var items = activeItems("app").concat(activeItems("study")).filter(isSpecialItem);
    items.sort(function (a, b) {
      var oa = spordOf(a.id), ob = spordOf(b.id);
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1; if (ob != null) return 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return items;
  }
  /* ---- Timeline mode (Special): day-grouped note log + dated tasks.
     Notes ride on a reserved "__timeline" entry row — synced like everything else. ---- */
  var TL_ITEM = "__timeline", IB_ITEM = "__inbox";
  var SP_VIEW = "cards"; try { SP_VIEW = localStorage.getItem("wf2_special_view") || (localStorage.getItem("wf2_special_tl") === "1" ? "tl" : "cards"); } catch (e) {}
  var TL_SHOW_DONE = false;
  var TL_LOC = ""; try { TL_LOC = localStorage.getItem("wf2_tl_loc") || ""; } catch (e) {}
  var TL_NEW_LOC = "";
  function ibItems() { var e = entries[IB_ITEM]; return (e && Array.isArray(e.items)) ? e.items : []; }
  function ibSave(items) { entries[IB_ITEM] = Object.assign({}, entries[IB_ITEM], { items: items, u: Date.now() }); save(); cloudPushEntry(IB_ITEM, entries[IB_ITEM]); }
  function nowLocalTs() { var d = new Date(); return tlDayKey(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function locSuggestions() {
    var seen = {}, out = [];
    function add(n) { n = (n || "").trim(); if (!n) return; var k = n.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(n); } }
    add("Home"); add("Out");
    metaLocs().forEach(function (n) { add(n); });
    placeList().forEach(function (p) { add(p.name); });
    tlNotes().forEach(function (n) { add(n.loc); });
    ibItems().forEach(function (n) { add(n.loc); });
    specialSorted().forEach(function (it) { normSubs(subs(it.id)).forEach(function (x) { add(x.loc); }); });
    return out;
  }
  function metaLocs() { return Array.isArray(meta.locs) ? meta.locs : []; }
  function addMetaLoc(name) {
    name = (name || "").trim(); if (!name) return "";
    var known = ["home", "out"];
    placeList().forEach(function (p) { known.push((p.name || "").toLowerCase()); });
    metaLocs().forEach(function (n) { known.push((n || "").toLowerCase()); });
    if (known.indexOf(name.toLowerCase()) < 0) {
      if (!Array.isArray(meta.locs)) meta.locs = [];
      meta.locs.push(name); save(); cloudPushBoard();
    }
    return name;
  }
  function locChipHtml(loc) {
    if (!loc) return "";
    return '<span class="tl-locchip" style="--sp-h:' + hueFor(loc) + '">' + esc(loc) + '</span>';
  }
  function tlNewLocSel() {
    var opts = locSuggestions();
    if (TL_NEW_LOC && opts.map(function (l) { return l.toLowerCase(); }).indexOf(TL_NEW_LOC.toLowerCase()) < 0) opts.push(TL_NEW_LOC);
    return '<select id="tlNewLoc" title="Place for this note"><option value="">\ud83d\udccd No place</option>' +
      opts.map(function (l) { return '<option value="' + esc(l) + '"' + (l === TL_NEW_LOC ? " selected" : "") + '>' + esc(l) + '</option>'; }).join("") +
      '<option value="__newloc__">\u2795 New place\u2026</option></select>';
  }
  function tlNotes() { var e = entries[TL_ITEM]; return (e && Array.isArray(e.notes)) ? e.notes : []; }
  function tlSave(notes) { entries[TL_ITEM] = Object.assign({}, entries[TL_ITEM], { notes: notes, u: Date.now() }); save(); cloudPushEntry(TL_ITEM, entries[TL_ITEM]); }
  function tlDayKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function tlDayLabel(k) {
    var t0 = new Date(), t1 = new Date(), y1 = new Date();
    t1.setDate(t1.getDate() + 1); y1.setDate(y1.getDate() - 1);
    if (k === tlDayKey(t0)) return "Today";
    if (k === tlDayKey(t1)) return "Tomorrow";
    if (k === tlDayKey(y1)) return "Yesterday";
    var p = k.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];
  }
  function paintTlSeg() {
    var c = $("spViewCards"), t = $("spViewTl"), i = $("spViewInbox");
    if (c) c.classList.toggle("on", SP_VIEW === "cards");
    if (t) t.classList.toggle("on", SP_VIEW === "tl");
    if (i) { i.classList.toggle("on", SP_VIEW === "inbox"); var n = ibItems().length; i.textContent = "Inbox" + (n ? " (" + n + ")" : ""); }
  }
  function renderTimeline(items, host) {
    var today = tlDayKey(new Date());
    var all = [], usedLocs = [], seenLoc = {};
    function markLoc(l) { l = (l || "").trim(); if (l && !seenLoc[l.toLowerCase()]) { seenLoc[l.toLowerCase()] = 1; usedLocs.push(l); } }
    tlNotes().forEach(function (n) { markLoc(n.loc); all.push({ type: "note", n: n, k: (n.ts || "").slice(0, 10) || today, done: !!n.done, loc: (n.loc || "").trim() }); });
    items.forEach(function (it) {
      visibleSubs(subs(it.id)).forEach(function (x) {
        if (!x.when) return;
        markLoc(x.loc);
        all.push({ type: "task", it: it, x: x, k: x.when.slice(0, 10), done: !!x.done, loc: (x.loc || "").trim() });
      });
    });
    if (TL_LOC && !seenLoc[TL_LOC.toLowerCase()]) TL_LOC = "";
    var groups = {}, pastHidden = 0, doneHidden = 0, locHidden = 0;
    all.forEach(function (r) {
      if (TL_LOC && r.loc.toLowerCase() !== TL_LOC.toLowerCase()) { locHidden++; return; }
      if (r.done && !TL_SHOW_DONE) { doneHidden++; return; }
      if (r.k < today && !TL_SHOW_DONE) { pastHidden++; return; }
      (groups[r.k] = groups[r.k] || []).push(r);
    });
    var keys = Object.keys(groups).sort();
    var hid = pastHidden + doneHidden;
    var locbar = usedLocs.length ? '<div class="tl-locbar"><button type="button" class="tl-locbtn' + (!TL_LOC ? " on" : "") + '" data-tlloc="">All places</button>' +
      usedLocs.map(function (l) { return '<button type="button" class="tl-locbtn' + (TL_LOC.toLowerCase() === l.toLowerCase() ? " on" : "") + '" data-tlloc="' + esc(l) + '" style="--sp-h:' + hueFor(l) + '"><span class="gdot"></span>' + esc(l) + '</button>'; }).join("") + '</div>' : "";
    var html = '<div class="tl">' +
      '<div class="tl-add"><input id="tlNew" placeholder="Log a note — lands under Today…">' + tlNewLocSel() + '<button id="tlAddBtn" type="button">Add</button>' +
      '<button class="tl-showdone' + (TL_SHOW_DONE ? " on" : "") + '" id="tlShowDone" type="button">' + (TL_SHOW_DONE ? "Hide done & past" : "Show done & past" + (hid ? " (" + hid + ")" : "")) + '</button></div>' + locbar;
    if (!keys.length) html += '<div class="tl-empty">' + (TL_LOC ? "Nothing at “" + esc(TL_LOC) + "” — switch place, or tag more tasks with it." : "Nothing on the timeline yet — log a note above, or put a date on a Special task and it shows up here.") + '</div>';
    keys.forEach(function (k) {
      var isPast = k < today;
      html += '<div class="tl-day' + (k === today ? " now" : isPast ? " past" : "") + '"><span class="tl-dot"></span><span class="tl-dl">' + tlDayLabel(k) + '</span></div>';
      groups[k].sort(function (a, b) {
        var ta = a.type === "note" ? (a.n.ts || "") : (a.x.when || "");
        var tb = b.type === "note" ? (b.n.ts || "") : (b.x.when || "");
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
      groups[k].forEach(function (r) {
        if (r.type === "note") {
          var tm = (r.n.ts || "").length > 10 ? (r.n.ts || "").slice(11, 16) : "";
          html += '<div class="tl-row note' + (r.n.done ? " done" : "") + '" data-nid="' + esc(r.n.id) + '">' +
            '<button class="sub-check' + (r.n.done ? " on" : "") + '" data-tlact="done" aria-label="done" title="Mark done"></button>' +
            '<span class="tl-txt">' + esc(r.n.t) + '</span>' +
            locChipHtml(r.loc) +
            (tm ? '<span class="tl-time">' + tm + '</span>' : '') +
            '<button class="sub-del" data-tlact="del" title="Delete note">×</button></div>';
        } else {
          var v = whenView(r.x), tmv = r.x.when.length > 10 ? r.x.when.slice(11, 16) : "";
          html += '<div class="tl-row task' + (r.x.done ? " done" : "") + '" data-key="' + esc(r.it.id) + '" data-sid="' + esc(r.x.id) + '" style="--sp-h:' + hueFor(r.it.name) + '">' +
            '<button class="sub-check' + (r.x.done ? " on" : "") + '" data-act="subtoggle" aria-label="done" title="Mark done"></button>' +
            '<span class="tl-txt">' + esc(r.x.t || "task") + '</span>' +
            locChipHtml(r.loc) +
            '<span class="tl-src">' + esc(r.it.name) + '</span>' +
            (tmv ? '<span class="tl-time">' + tmv + '</span>' : (v && !r.x.done ? '<span class="tl-chip' + (v.w.pastDue ? " od" : "") + '">' + esc(v.rel) + '</span>' : '')) +
            '</div>';
        }
      });
    });
    html += '</div>';
    host.innerHTML = html;
  }
  /* ---- Inbox: a holding pool for pasted tasks awaiting place + day ---- */
  function renderInbox(host) {
    var items = ibItems(), sugg = locSuggestions();
    function locSel(cur, id) {
      var opts = sugg.slice();
      if (cur && opts.map(function (l) { return l.toLowerCase(); }).indexOf(cur.toLowerCase()) < 0) opts.push(cur);
      return '<select class="ib-loc" data-ibid="' + esc(id) + '"><option value="">\ud83d\udccd No place</option>' +
        opts.map(function (l) { return '<option value="' + esc(l) + '"' + (l === cur ? " selected" : "") + '>' + esc(l) + '</option>'; }).join("") +
        '<option value="__newloc__">\u2795 New place\u2026</option></select>';
    }
    var html = '<div class="ib">' +
      '<div class="ib-paste"><textarea id="ibPaste" rows="4" placeholder="Paste or type tasks — one per line. They wait here until you give them a place and a day."></textarea>' +
      '<button id="ibAddBtn" type="button">Add to inbox</button></div>';
    if (!items.length) html += '<div class="tl-empty">Inbox is empty — paste a brain-dump above; assign each line a place and a day when you’re ready.</div>';
    items.forEach(function (n) {
      html += '<div class="ib-row" data-ibrow="' + esc(n.id) + '">' +
        '<span class="ib-txt">' + esc(n.t) + '</span>' +
        locSel((n.loc || ""), n.id) +
        '<input type="date" class="ib-date" data-ibid="' + esc(n.id) + '" value="' + esc(n.day || "") + '" title="Day (optional — blank lands under Today)">' +
        '<button class="ib-send" data-ibact="send" type="button" title="Move onto the timeline">→ Timeline</button>' +
        '<button class="sub-del" data-ibact="del" type="button" title="Delete">×</button></div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  function wireTimeline() {
    var host = $("specialHost"); if (!host) return;
    function tlAddFromInput() {
      var inp = $("tlNew"); if (!inp) return;
      var t = (inp.value || "").trim(); if (!t) return;
      var sel = $("tlNewLoc"); if (sel) TL_NEW_LOC = sel.value;
      var notes = tlNotes().slice();
      notes.push({ id: uid(), t: t, ts: nowLocalTs(), done: false, loc: TL_NEW_LOC || "" });
      tlSave(notes); renderSpecial();
      var again = $("tlNew"); if (again) again.focus();
    }
    host.addEventListener("click", function (e) {
      if (e.target.id === "tlAddBtn") { tlAddFromInput(); return; }
      if (e.target.closest && e.target.closest("#tlShowDone")) { TL_SHOW_DONE = !TL_SHOW_DONE; renderSpecial(); return; }
      var lc = e.target.closest && e.target.closest("[data-tlloc]");
      if (lc) { TL_LOC = lc.getAttribute("data-tlloc") || ""; try { localStorage.setItem("wf2_tl_loc", TL_LOC); } catch (x3) {} renderSpecial(); return; }
      if (e.target.id === "ibAddBtn") {
        var ta2 = $("ibPaste"); if (!ta2) return;
        var lines = (ta2.value || "").split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!lines.length) return;
        var cur = ibItems().slice();
        lines.forEach(function (t) { cur.push({ id: uid(), t: t }); });
        ibSave(cur); renderSpecial();
        toast(lines.length + (lines.length === 1 ? " task" : " tasks") + " in the inbox.");
        return;
      }
      var ib = e.target.closest && e.target.closest("[data-ibact]");
      if (ib) {
        var row2 = ib.closest("[data-ibrow]"); if (!row2) return;
        var iid = row2.getAttribute("data-ibrow"), act2 = ib.getAttribute("data-ibact");
        if (act2 === "del") { ibSave(ibItems().filter(function (x) { return x.id !== iid; })); renderSpecial(); return; }
        if (act2 === "send") {
          var it2 = null; ibItems().forEach(function (x) { if (x.id === iid) it2 = x; });
          if (!it2) return;
          var notes2 = tlNotes().slice();
          notes2.push({ id: uid(), t: it2.t, ts: it2.day || nowLocalTs(), done: false, loc: it2.loc || "" });
          tlSave(notes2);
          ibSave(ibItems().filter(function (x) { return x.id !== iid; }));
          SP_VIEW = "tl"; try { localStorage.setItem("wf2_special_view", "tl"); } catch (x4) {}
          renderSpecial();
          toast("On the timeline — " + (it2.day ? tlDayLabel(it2.day) : "today") + ".");
          return;
        }
      }
      var nb = e.target.closest && e.target.closest("[data-tlact]"); if (!nb) return;
      var row = nb.closest("[data-nid]"); if (!row) return;
      var nid = row.getAttribute("data-nid"), act = nb.getAttribute("data-tlact");
      var notes = tlNotes().slice();
      if (act === "done") notes = notes.map(function (n) { return n.id === nid ? Object.assign({}, n, { done: !n.done }) : n; });
      if (act === "del") notes = notes.filter(function (n) { return n.id !== nid; });
      tlSave(notes); renderSpecial();
    });
    host.addEventListener("keydown", function (e) { if (e.target.id === "tlNew" && e.key === "Enter") { e.preventDefault(); tlAddFromInput(); } });
    host.addEventListener("change", function (e) {
      var t = e.target;
      if (t.id === "tlNewLoc") {
        if (t.value === "__newloc__") { var nlt = (prompt("New place name (e.g. Motoyawata):") || "").trim(); TL_NEW_LOC = nlt ? addMetaLoc(nlt) : TL_NEW_LOC; renderSpecial(); return; }
        TL_NEW_LOC = t.value; return;
      }
      if (t.classList && t.classList.contains("ib-loc")) { var id1 = t.getAttribute("data-ibid"); var lv = t.value; if (lv === "__newloc__") { lv = (prompt("New place name (e.g. Motoyawata):") || "").trim(); if (!lv) { renderSpecial(); return; } lv = addMetaLoc(lv); } ibSave(ibItems().map(function (x) { return x.id === id1 ? Object.assign({}, x, { loc: lv }) : x; })); renderSpecial(); return; }
      if (t.classList && t.classList.contains("ib-date")) { var id2 = t.getAttribute("data-ibid"); ibSave(ibItems().map(function (x) { return x.id === id2 ? Object.assign({}, x, { day: t.value }) : x; })); return; }
    });
    function setView(v) {
      SP_VIEW = v;
      try { localStorage.setItem("wf2_special_view", v); } catch (x) {}
      renderSpecial();
    }
    var c = $("spViewCards"), t = $("spViewTl"), i = $("spViewInbox");
    if (c) c.onclick = function () { setView("cards"); };
    if (t) t.onclick = function () { setView("tl"); };
    if (i) i.onclick = function () { setView("inbox"); };
  }

  function renderSpecial() {
    var sec = $("specialSec"), host = $("specialHost"); if (!sec || !host) return;
    var items = specialSorted();
    sec.style.display = (items.length || tlNotes().length || ibItems().length || document.body.classList.contains("special-mode")) ? "" : "none";
    paintTlSeg();
    var asb2 = $("addSpecialBtn"); if (asb2) asb2.style.display = SP_VIEW === "cards" ? "" : "none";
    if (SP_VIEW === "tl") {
      var ag0 = $("spAgenda"); if (ag0) ag0.style.display = "none";
      renderTimeline(items, host);
      var cnt0 = $("specialCount"); if (cnt0) cnt0.textContent = "";
      return;
    }
    if (SP_VIEW === "inbox") {
      var ag1 = $("spAgenda"); if (ag1) ag1.style.display = "none";
      renderInbox(host);
      var cnt1 = $("specialCount"); if (cnt1) cnt1.textContent = "";
      return;
    }
    renderAgenda(items);
    host.innerHTML = "";
    var totDone = 0, tot = 0;
    items.forEach(function (it) {
      var id = it.id, sv = visibleSubs(subs(id)), done = sv.filter(function (x) { return x.done; }).length;
      totDone += done; tot += sv.length;
      var open = !!detailOpen[id];
      var card = document.createElement("div");
      card.className = "sp-card" + (open ? " open" : "");
      card.setAttribute("data-key", id); card.setAttribute("data-kind", kindOf(id));
      card.style.setProperty("--sp-h", hueFor(it.name));
      var mode = getMode();
      var svMatch = sv.filter(function (x) { return subModeOk(x.md, mode); });
      var hiddenN = sv.length - svMatch.length;
      var svShown = (spReveal[id] ? sv : svMatch).slice().sort(function (a, b) { return subRank(a) - subRank(b); });
      var rows = svShown.map(function (x) {
        var v = !x.done ? whenView(x) : null;
        var od = !!(v && v.w.pastDue);
        var liCls = x.done ? "" : od ? " od" : x.urg ? " urg" : (v && v.asap ? " asap" : "");
        var metaBits = subModeTag(x) + (x.when ? whenChipHtml(x) : "");
        return '<li data-sid="' + esc(x.id) + '" class="spli' + liCls + '"><button class="sub-check' + (x.done ? " on" : "") + '" data-act="subtoggle" aria-label="done"></button>' +
          '<span class="sub-text-editable' + (x.t ? "" : " empty") + '" data-act="subedit-start" title="Click to edit">' + (x.t ? esc(x.t) : "subtask") + '</span>' +
          (x.when ? "" : whenChipHtml(x)) + subFlagBtn(x) +
          '<button class="sub-del sub-delete-btn" data-act="subdel" title="Delete">\u00d7</button>' +
          (metaBits ? '<span class="sub-meta">' + metaBits + "</span>" : "") + "</li>";
      }).join("");
      if (hiddenN > 0) rows += '<li class="sub-hidden-note"><button data-act="spreveal">' + (spReveal[id] ? "Hide" : "Show") + " " + hiddenN + " " + (mode === "office" ? "personal" : "office") + " task" + (hiddenN === 1 ? "" : "s") + "</button></li>";
      card.innerHTML =
        '<div class="sp-head">' +
          '<span class="sp-grip" title="Drag to reorder">\u22ee\u22ee</span>' +
          '<span class="sp-name" data-act="open">' + esc(it.name) + '</span>' +
          (sv.length ? '<span class="sp-count' + (done === sv.length ? " all" : "") + '">' + done + "/" + sv.length + '</span>' : '') +
          '<button class="caret-btn" data-act="open">' + IC.chev + '</button>' +
        '</div>' +
        (open
          ? detailHtml(id)
          : '<ul class="subs sp-subs">' + rows + '</ul>' +
            '<div class="sub-add"><input class="sub-new" data-act="subnew" placeholder="Add a task\u2026"><button class="sub-addbtn" data-act="subadd">Add</button></div>');
      host.appendChild(card);
    });
    var cnt = $("specialCount"); if (cnt) cnt.textContent = tot ? totDone + "/" + tot : "";
  }

  /* ---- Coming up: urgent tasks first (ASAP), then dated tasks soonest first ---- */
  function renderAgenda(items) {
    var ag = $("spAgenda"); if (!ag) return;
    var mode = getMode(), rows = [];
    items.forEach(function (it) {
      visibleSubs(subs(it.id)).forEach(function (x) {
        if (x.done || !subModeOk(x.md, mode)) return;
        var v = whenView(x);
        if (!v && !x.urg) return;
        rows.push({ key: it.id, card: it.name, hue: hueFor(it.name), sub: x, v: v });
      });
    });
    rows.sort(function (a, b) {
      function rk(r) { var od = r.v && r.v.w.pastDue ? 0 : r.sub.urg ? 1 : 2; return od; }
      var ra = rk(a), rb = rk(b);
      if (ra !== rb) return ra - rb;
      var aw = a.sub.when || "9999", bw = b.sub.when || "9999";
      return aw < bw ? -1 : aw > bw ? 1 : 0;
    });
    ag.style.display = rows.length ? "" : "none";
    ag.innerHTML = rows.map(function (r) {
      var v = r.v, w = v && v.w, urg = !!r.sub.urg;
      var od = !!(w && w.pastDue);
      var cls = od ? " odrow" : urg ? " urgrow" : v.cls;
      var cal = w ? '<span class="ag-cal' + (urg && !od ? " flagged" : "") + '"><i>' + w.dow + '</i><b>' + w.day + '</b></span>'
                  : '<span class="ag-cal flag">' + IC.flag + '</span>';
      return '<div class="ag-item' + cls + '" data-key="' + esc(r.key) + '" data-sid="' + esc(r.sub.id) + '" style="--sp-h:' + r.hue + '">' +
        cal +
        '<div class="ag-txt"><span class="ag-name">' + esc(r.sub.t || "task") + '</span>' +
        '<span class="ag-src">' + esc(r.card) + (w && w.time ? ' \u00b7 ' + w.time : '') + '</span></div>' +
        '<span class="ag-chip">' + esc(od ? v.rel.toUpperCase() : urg ? "ASAP" : v.rel) + '</span>' +
        '<button class="sub-check" data-act="subtoggle" aria-label="done" title="Mark done"></button>' +
        '</div>';
    }).join("");
  }

  /* ---- a column (apps or study) ---- */
  function renderColumn(kind) {
    var ids = kind === "app"
      ? { host: "appsActive", back: "appsBacklog", wrap: "appsBacklogWrap", bn: "appsBacklogN", n: "appsN", noun: "app" }
      : kind === "office"
      ? { host: "officeActive", back: "officeBacklog", wrap: "officeBacklogWrap", bn: "officeBacklogN", n: "officeN", noun: "office task" }
      : { host: "studyActive", back: "studyBacklog", wrap: "studyBacklogWrap", bn: "studyBacklogN", n: "studyN", noun: "topic" };
    if (!$(ids.host)) return;
    var host = $(ids.host), back = $(ids.back);
    host.innerHTML = ""; back.innerHTML = "";
    if (ENTER) host.classList.add("wf-enter");
    var arr = arrFor(kind), active = activeItems(kind).filter(function (x) { return !isSpecialItem(x); }), backlog = backlogItems(kind);
    $(ids.n).textContent = active.length;

    if (!arr.length) host.innerHTML = emptyZone("No " + ids.noun + "s yet. Tap <b>+ Add " + ids.noun + "</b> below to create your first one." + (cloudConfigured() ? "" : "<br><span class='ez-dim'>Connect <b>Cloud</b> to sync across your devices.</span>"));
    else if (!active.length) host.innerHTML = emptyZone("Nothing active. Switch a " + ids.noun + " on from the backlog, or add a new one.");
    else if (VIEW_GROUPED) groupItems(active, kind, true).forEach(function (g) {
      host.appendChild(catHead(kind, g.group, g.items.length));
      g.items.forEach(function (it) { host.appendChild(itemCard(it.id)); });
    });
    else flatSortActive(active).forEach(function (it) { host.appendChild(itemCard(it.id)); });

    $(ids.wrap).style.display = backlog.length ? "" : "none";
    $(ids.bn).textContent = backlog.length;
    function brow(it) {
      var li = document.createElement("li"); li.className = "brow"; li.setAttribute("data-key", it.id); li.setAttribute("draggable", "true");
      li.innerHTML = '<button class="tgl tgl-sm" data-act="on" title="Bring into This Week"><span class="knob"></span></button>' +
        '<span class="bname">' + esc(it.name) + '</span>' +
        (VIEW_GROUPED ? '' : gtagHtml(kind, it.group)) +
        '<button class="brow-del" data-act="del" title="Delete forever">' + IC.trash + '</button>';
      return li;
    }
    if (backlog.length) {
      if (VIEW_GROUPED) groupItems(backlog, kind, false).forEach(function (g) {
        back.appendChild(catHead(kind, g.group, g.items.length));
        var ul = document.createElement("ul"); ul.className = "brows";
        g.items.forEach(function (it) { ul.appendChild(brow(it)); });
        back.appendChild(ul);
      });
      else {
        var ul2 = document.createElement("ul"); ul2.className = "brows";
        backlog.slice().sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); })
          .forEach(function (it) { ul2.appendChild(brow(it)); });
        back.appendChild(ul2);
      }
    }
  }
  function groupItems(arr, kind, sortPri) {
    var groups = [];
    if (kind === "app") groups = APP_CATS.slice();
    arr.forEach(function (a) { if (groups.indexOf(a.group) < 0) groups.push(a.group); });
    if (kind !== "app") groups.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return groups.map(function (gr) {
      var items = arr.filter(function (a) { return a.group === gr; });
      items.sort(sortPri
        ? function (a, b) {
            var sa = isTarget(a.id) ? 0 : 1, sb2 = isTarget(b.id) ? 0 : 1;   // starred first
            if (sa !== sb2) return sa - sb2;
            var fa = getEntry(a.id).upd ? 0 : 1, fb = getEntry(b.id).upd ? 0 : 1;   // flagged next
            if (fa !== fb) return fa - fb;
            var oa = ordOf(a.id), ob = ordOf(b.id);
            if (oa != null && ob != null) return oa - ob;
            if (oa != null) return -1; if (ob != null) return 1;
            return (priRankOf(a.id) - priRankOf(b.id)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          }
        : function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
      return { group: gr, items: items };
    }).filter(function (g) { return g.items.length; });
  }
  function catHead(kind, group, n) {
    var d = document.createElement("div");
    if (kind === "app") { d.className = "cat-head " + (CAT_CLASS[group] || "cat-other"); }
    else { d.className = "cat-head"; d.style.color = "oklch(0.55 0.13 " + hueFor(group) + ")"; }
    d.innerHTML = '<span class="cat-dot"></span>' + esc(group) + ' <span class="cat-n">' + n + '</span>';
    return d;
  }
  function emptyZone(html) { return '<div class="empty-zone">' + html + '</div>'; }

  /* flat view: starred (The Five) first in Five order, then flagged (pending
     update), then manual order, then priority, then name */
  function flatSortActive(arr) {
    return arr.slice().sort(function (a, b) {
      var sa = isTarget(a.id) ? 0 : 1, sb2 = isTarget(b.id) ? 0 : 1;
      if (sa !== sb2) return sa - sb2;
      if (!sa) return targetOrder.indexOf(a.id) - targetOrder.indexOf(b.id);
      var fa = getEntry(a.id).upd ? 0 : 1, fb = getEntry(b.id).upd ? 0 : 1;
      if (fa !== fb) return fa - fb;
      var oa = ordOf(a.id), ob = ordOf(b.id);
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1; if (ob != null) return 1;
      return (priRankOf(a.id) - priRankOf(b.id)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }

  /* small category tag shown on cards in flat view */
  function gtagHtml(kind, group) {
    if (!group || (group || "").trim().toLowerCase() === "special") return "";
    var cls = kind === "app" ? (CAT_CLASS[group] || "cat-other") : "";
    var style = kind === "app" ? "" : ' style="color:oklch(0.55 0.13 ' + hueFor(group) + ')"';
    return '<span class="gtag ' + cls + '"' + style + '><span class="gdot"></span>' + esc(group) + '</span>';
  }

  /* ---- shared item card ---- */
  function itemCard(id) {
    var open = !!detailOpen[id], prog = subProgress(id), pri = priOf(id);
    var li = document.createElement("div");
    li.className = "item" + (pri ? " pri-" + pri : "") + (open ? " open" : "");
    li.setAttribute("data-key", id); li.setAttribute("data-kind", kindOf(id));
    if (!open) li.setAttribute("draggable", "true");   // collapsed cards drag; open ones are being edited
    var ring = prog
      ? '<div class="miniring" title="' + prog.done + ' of ' + prog.total + ' subtasks done">' + ringSVG(prog.pct, 26, 3.5, { t: "mt", f: "mf" }) + '<span class="mn">' + prog.done + '/' + prog.total + '</span></div>'
      : '';
    var starOn = isTarget(id), starFull = !starOn && targetOrder.length >= MAX_TARGETS;
    var updOn = !!getEntry(id).upd;
    var it = itemById(id);
    li.innerHTML =
      '<div class="item-row">' +
        '<div class="item-grip" data-act="open">' +
          '<div class="iwrap-name"><div class="iname">' + esc(it ? it.name : id) + '</div>' + (!VIEW_GROUPED && it ? gtagHtml(kindOf(id), it.group) : '') + '</div>' +
        '</div>' +
        '<div class="item-actions">' + ring +
          '<button class="updflag' + (updOn ? " on" : "") + '" data-act="flagupd" title="' + (updOn ? "Update pending — click to clear" : "Flag a pending update / prompt for Claude") + '">' + IC.flag + '</button>' +
          '<button class="star' + (starOn ? " on" : "") + '" data-act="star"' + (starFull ? " disabled" : "") + ' title="' + (starOn ? "In The Five" : starFull ? "The Five is full" : "Add to The Five") + '">' + IC.star + '</button>' +
          '<button class="caret-btn" data-act="open">' + IC.chev + '</button>' +
          '<button class="tgl on" data-act="off" title="Move to backlog"><span class="knob"></span></button>' +
        '</div>' +
      '</div>' +
      detailHtml(id);
    return li;
  }
  function priName(p) { return p === "H" ? "High" : p === "M" ? "Medium" : "Low"; }
  function detailHtml(id) {
    var e = getEntry(id), it = itemById(id), pri = priOf(id);
    var rows = visibleSubs(subs(id)).map(function (x) {   // backfill ids so data-sid matches the handlers
      var t = x.t || "";
      return '<li data-sid="' + esc(x.id) + '"><button class="sub-check' + (x.done ? " on" : "") + '" data-act="subtoggle" aria-label="done"></button>' +
        '<span class="sub-text-editable' + (t ? "" : " empty") + '" data-act="subedit-start" title="Click to edit">' + (t ? esc(t) : "subtask") + '</span>' +
        (isSpecialItem(it) ? whenChipHtml(x) : '') +
        '<button class="sub-del sub-delete-btn" data-act="subdel" title="Delete">\u00d7</button></li>';
    }).join("");
    var priCtl = '<div class="pri-row"><span class="pri-lbl">Priority</span>' +
      '<div class="pri-seg">' + ["H", "M", "L"].map(function (p) {
        return '<button class="pseg pseg-' + p + (p === pri ? " on" : "") + '" data-pri="' + p + '">' + priName(p) + '</button>';
      }).join("") + '</div></div>';
    var listId = "grp-" + kindOf(id);
    var linksRow = '<div class="links-block"><span class="notes-lbl">\u2197 Quick links</span>' +
      '<textarea class="hlinks" data-act="links" placeholder="One per line: Label | https://url">' + esc(linksToText(it && it.links)) + '</textarea></div>';
    var manage = '<div class="manage-row">' +
      '<input class="mg-name" data-act="rename" value="' + esc(it ? it.name : "") + '" placeholder="Name">' +
      '<input class="mg-group" data-act="group" list="' + listId + '" value="' + esc(it ? it.group : "") + '" placeholder="Group">' +
      '<button class="mg-del" data-act="del" title="Delete forever">' + IC.trash + '</button>' +
      '</div>';
    return '<div class="detail' + (id === OPENING ? ' opening' : '') + '">' + priCtl +
      '<input class="obj" data-act="obj" placeholder="Objective \u2014 what does done look like?" value="' + esc(e.objective || "") + '">' +
      '<ul class="subs">' + rows + '</ul>' +
      '<div class="sub-add"><input class="sub-new" data-act="subnew" placeholder="Add a checklist subtask\u2026"><button class="sub-addbtn" data-act="subadd">Add</button></div>' +
      '<div class="notes-block"><span class="notes-lbl">\u270e Notes</span>' +
      '<textarea class="notes" data-act="notes" placeholder="Longer notes \u2014 thinking, blockers, links\u2026">' + esc(e.notes || "") + '</textarea></div>' +
      linksRow +
      manage +
    '</div>';
  }

  function refreshGroupLists() {
    [["grp-app", "app"], ["grp-study", "study"], ["grp-office", "office"]].forEach(function (pair) {
      var dl = $(pair[0]); if (!dl) return;
      var groups = {}; if (pair[1] === "app") APP_CATS.forEach(function (g) { groups[g] = 1; });
      arrFor(pair[1]).forEach(function (it) { groups[it.group] = 1; });
      dl.innerHTML = Object.keys(groups).map(function (g) { return '<option value="' + esc(g) + '">'; }).join("");
    });
  }

  /* ---- meta (week + eow) ---- */
  function renderMeta() {
    $("weekInput").value = meta.weekOf || "";
    $("eowDone").value = meta.eowDone || "";
    $("eowCarry").value = meta.eowCarry || "";
    $("eowNotes").value = meta.eowNotes || "";
  }

  /* ============================================================
     TARGET PICKER
     ============================================================ */
  function openPicker() {
    var body = $("pickBody"); body.innerHTML = "";
    var rows = [];
    activeItems("app").forEach(function (a) { if (isSpecialItem(a)) return; rows.push({ key: a.id, name: a.name, crumb: a.group, tag: "App", color: catColor(a.group) }); });
    activeItems("study").forEach(function (s) { if (isSpecialItem(s)) return; rows.push({ key: s.id, name: s.name, crumb: s.group, tag: "Study", color: "oklch(0.55 0.13 " + hueFor(s.group) + ")" }); });
    activeItems("office").forEach(function (o) { if (isSpecialItem(o)) return; rows.push({ key: o.id, name: o.name, crumb: o.group, tag: "Office", color: "var(--office)" }); });
    if (!rows.length) { body.innerHTML = '<div class="modal-empty">No active items yet.<br>Switch on an app or topic first, then pick your targets from them.</div>'; }
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
     ADD-ITEM MODAL
     ============================================================ */
  var addKind = "app";
  function openAdd(kind) {
    addKind = kind;
    $("addTitle").textContent = kind === "app" ? "Add app" : kind === "office" ? "Add office task" : "Add topic";
    $("addName").value = ""; $("addGroup").value = "";
    $("addName").setAttribute("placeholder", kind === "app" ? "e.g. LedgerLite" : kind === "office" ? "e.g. Quarterly deck" : "e.g. Kanji");
    $("addGroup").setAttribute("placeholder", kind === "app" ? "Category (e.g. General Purpose)" : kind === "office" ? "Area (e.g. Meetings)" : "Subject (e.g. Japanese)");
    $("addGroup").setAttribute("list", "grp-" + kind);
    $("addModal").classList.add("open");
    setTimeout(function () { $("addName").focus(); }, 30);
  }
  function closeAdd() { $("addModal").classList.remove("open"); }
  function commitAdd() {
    var name = $("addName").value.trim(); if (!name) { $("addName").focus(); return; }
    addItem(addKind, name, $("addGroup").value);
    toast((addKind === "app" ? "App" : addKind === "office" ? "Office task" : "Topic") + " added \u2014 it\u2019s active this week.");
    $("addName").value = ""; $("addGroup").value = ""; $("addName").focus();
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function keyOf(el) { var n = el.closest("[data-key]"); return n ? n.getAttribute("data-key") : null; }

  document.addEventListener("click", function (e) {
    var pk = e.target.closest("[data-pick]");
    if (pk) { var k = pk.getAttribute("data-pick"); if (addTarget(k)) { renderAll(); openPicker(); } else toast("The Five is full \u2014 remove one first."); return; }
    var seg = e.target.closest("[data-pri]");
    if (seg) { patch(keyOf(seg), { pri: seg.getAttribute("data-pri") }); renderCols(); return; }
    var act = e.target.closest("[data-act]");
    if (!act) return;
    var a = act.getAttribute("data-act");

    if (a === "tpick") { openPicker(); return; }
    if (a === "pickclose") { closePicker(); return; }
    if (a === "tdone") {
      var tk = act.closest("[data-tkey]").getAttribute("data-tkey");
      var wasAll = targetOrder.length && targetOrder.every(targetDone);
      patch(tk, { targetDone: !targetDone(tk) });
      renderPulse(); renderFive();
      var nowAll = targetOrder.length && targetOrder.every(targetDone);
      if (nowAll && !wasAll) celebrate();
      toastMaybeDone(); return;
    }
    if (a === "tdrop") { removeTarget(act.closest("[data-tkey]").getAttribute("data-tkey")); renderAll(); return; }

    var key = keyOf(act);
    if (a === "open") { detailOpen[key] = !detailOpen[key]; OPENING = detailOpen[key] ? key : null; renderCols(); OPENING = null; return; }
    if (a === "off") { patch(key, { active: false }); removeTarget(key); detailOpen[key] = false; renderAll(); return; }
    if (a === "on") { patch(key, { active: true }); renderAll(); return; }
    if (a === "flagupd") { var wasUpd = !!getEntry(key).upd; patch(key, { upd: !wasUpd }); toast(wasUpd ? "Update flag cleared." : "Flagged \u2014 pending update for Claude."); renderAll(); return; }
    if (a === "star") {
      if (isTarget(key)) { removeTarget(key); } else if (!addTarget(key)) { toast("The Five is full \u2014 remove one first."); return; }
      renderAll(); return;
    }
    if (a === "del") {
      var it = itemById(key); if (!it) return;
      if (confirm("Delete \u201c" + it.name + "\u201d permanently? This removes it and its notes/subtasks from every device.")) deleteItem(key);
      return;
    }
    if (a === "subtoggle") {
      var sid = e.target.closest("[data-sid]").getAttribute("data-sid");
      var subs_norm = normSubs(subs(key));   // backfill ids
      patch(key, { subtasks: subs_norm.map(function (x) { return x.id === sid ? Object.assign({}, x, { done: !x.done, u: Date.now() }) : x; }) });
      renderCols(); renderPulse(); renderFive(); return;
    }
    if (a === "subdel") {
      var sid2 = e.target.closest("[data-sid]").getAttribute("data-sid");
      var subs_norm = normSubs(subs(key));   // backfill ids
      patch(key, { subtasks: subs_norm.map(function (x) { return x.id === sid2 ? Object.assign({}, x, { del: true, u: Date.now() }) : x; }) }); renderCols(); renderPulse(); renderFive(); return;
    }
    if (a === "subedit-start") { startSubEdit(act, key); return; }
    if (a === "whenedit") { var wli = act.closest("[data-sid]"); if (wli) openTaskSheet(key, wli.getAttribute("data-sid")); return; }
    if (a === "urgtoggle") {
      var uli = act.closest("[data-sid]");
      if (uli) {
        var usid = uli.getAttribute("data-sid");
        patch(key, { subtasks: normSubs(subs(key)).map(function (x) { return x.id === usid ? Object.assign({}, x, { urg: !x.urg, u: Date.now() }) : x; }) });
        renderCols(); renderHome();
      }
      return;
    }
    if (a === "spreveal") { spReveal[key] = !spReveal[key]; renderCols(); return; }
    if (a === "subadd") { addSub(act, key); return; }
  });

  document.addEventListener("keydown", function (e) {
    var a = e.target.getAttribute && e.target.getAttribute("data-act");
    if (a === "subnew" && e.key === "Enter") { e.preventDefault(); addSub(e.target, keyOf(e.target)); }
    if (e.target.id === "addName" && e.key === "Enter") { e.preventDefault(); commitAdd(); }
    if (e.key === "Escape") { closePicker(); closeAdd(); }
  });

  function addSub(fromEl, key) {
    var box = fromEl.closest(".sub-add").querySelector(".sub-new");
    var v = (box.value || "").trim(); if (!v) return;
    patch(key, { subtasks: subs(key).concat([{ id: uid(), t: v, done: false, u: Date.now() }]) });
    renderCols(); renderPulse(); renderFive();
    var node = document.querySelector('[data-key="' + cssEsc(key) + '"] .sub-new'); if (node) node.focus();
  }
  function cssEsc(s) { return s.replace(/(["\\])/g, "\\$1"); }

  /* click-to-edit a subtask: swap the text span for an input.
     Enter / blur commits (stamps u); Escape cancels without saving. */
  function startSubEdit(span, key) {
    var li = span.closest("[data-sid]"); if (!li) return;
    var sid = li.getAttribute("data-sid"), cur = "";
    normSubs(subs(key)).forEach(function (x) { if (x.id === sid) cur = x.t || ""; });   // backfill ids
    var input = document.createElement("input");
    input.className = "sub-text-edit"; input.value = cur; input.placeholder = "subtask";
    var settled = false;
    function finish(saveIt) {
      if (settled) return; settled = true;
      if (saveIt && input.value !== cur) { var subs_norm = normSubs(subs(key)); patch(key, { subtasks: subs_norm.map(function (x) { return x.id === sid ? Object.assign({}, x, { t: input.value, u: Date.now() }) : x; }) }); }
      renderCols();
    }
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
    span.replaceWith(input); input.focus(); input.select();
  }

  /* live text inputs */
  document.addEventListener("input", function (e) {
    var a = e.target.getAttribute && e.target.getAttribute("data-act"); if (!a) return;
    var key = keyOf(e.target);
    if (a === "obj") patch(key, { objective: e.target.value });
    else if (a === "notes") patch(key, { notes: e.target.value });
    else if (a === "rename") renameItem(key, e.target.value);
    else if (a === "links") { var itk = itemById(key); if (itk) { itk.links = parseLinksText(e.target.value); saveInv(); renderHome(); } }
    else if (a === "week") { meta.weekOf = e.target.value; save(); cloudPushBoard(); }
    else if (a === "eowDone") { meta.eowDone = e.target.value; save(); cloudPushBoard(); }
    else if (a === "eowCarry") { meta.eowCarry = e.target.value; save(); cloudPushBoard(); }
    else if (a === "eowNotes") { meta.eowNotes = e.target.value; save(); cloudPushBoard(); }
  });
  /* group changes apply on commit (change), not each keystroke, to avoid re-render churn */
  document.addEventListener("change", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-act") === "group") { var key = keyOf(e.target); if (key) { detailOpen[key] = true; regroupItem(key, e.target.value); } }
  });

  /* ---- disclosure ---- */
  function wireDisclosure(headId, wrapId) { var h = $(headId); if (h) h.addEventListener("click", function () { $(wrapId).classList.toggle("open"); }); }

  /* ---- toast ---- */
  var toastT;
  function toast(msg) { var el = $("toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, 2200); }
  function toastMaybeDone() { if (targetOrder.length && targetOrder.every(targetDone)) toast("\uD83C\uDF89 All five targets cleared this week."); }

  /* ============================================================
     CLOUD SYNC — Supabase Auth + RLS, outbox two-way sync.
     Inventory is one row per board (apps + study jsonb columns).
     Per-item curation is one row per item_key. Board-level state
     (The Five + week/EOW notes) rides on a synthetic "__board" row.
     ============================================================ */
  function cloudConfigured() { return !!(cloud && cloud.url && cloud.key && cloud.board); }
  function signedIn() { return !!(session && session.user); }
  function syncReady() { return !!(sb && cloudConfigured() && signedIn()); }
  function looksSecret(k) { return /^sb_secret_/i.test(k) || /service_role/i.test(k); }
  function saveCloud() {}    // connection is baked into config.js — nothing to persist
  function saveOutbox() {}   // the outbox is in-memory only

  function ensureClient() {
    if (sb) return sb;
    if (!cloudConfigured() || typeof window.supabase === "undefined") return null;
    sb = window.supabase.createClient(cloud.url, cloud.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "wf2_sb_auth" }
    });
    window.__wfSb = sb;   // shared with wf-cc-bridge-v2.js so it uses this signed-in session

    var sub = sb.auth.onAuthStateChange(function (event, sess) {
      session = sess || null;
      renderAuthUI(); updateCloudStatus();
      var cm = $("cloudModal"); if (cm && cm.classList.contains("open")) cloudSetStatus(cloudSummary());
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && syncReady()) initialSync();
      else if (event === "TOKEN_REFRESHED" && syncReady()) flushOutbox();
    });
    authSub = sub && sub.data ? sub.data.subscription : null;
    return sb;
  }
  function dropClient() { if (authSub) { try { authSub.unsubscribe(); } catch (e) {} authSub = null; } sb = null; session = null; }

  function queue(qkey, op) { outbox[qkey] = op; saveOutbox(); flushOutbox(); updateCloudStatus(); }
  function cloudPushEntry(key, payload) {
    if (!cloudConfigured()) return;
    queue("entry:" + key, { table: "weekly_focus_entries", onConflict: "user_id,board_id,item_key", row: { board_id: cloud.board, item_key: key, payload: payload, updated_at: nowISO() } });
  }
  function cloudDeleteEntry(key) {
    if (!cloudConfigured()) return;
    delete outbox["entry:" + key];                    // drop any pending upsert for it
    queue("del:" + key, { method: "delete", table: "weekly_focus_entries", match: { board_id: cloud.board, item_key: key } });
  }
  function cloudPushBoard() { boardU = Date.now(); cloudPushEntry(BOARD_ITEM, { targetOrder: targetOrder, meta: meta, u: boardU }); }
  function cloudPushInv() {
    if (!cloudConfigured()) return;
    queue("inv", { table: "weekly_focus_inventory", onConflict: "user_id,board_id", row: { board_id: cloud.board, apps: state.apps, study: state.study, office: state.office || [], updated_at: invTs || nowISO() } });
  }

  async function flushOutbox() {
    if (!syncReady() || flushing) return;
    flushing = true;
    var uidv = session.user.id, keys = Object.keys(outbox);
    for (var i = 0; i < keys.length; i++) {
      var op = outbox[keys[i]];
      try {
        var r;
        if (op.method === "delete") r = await sb.from(op.table).delete().match(Object.assign({ user_id: uidv }, op.match));
        else r = await sb.from(op.table).upsert(Object.assign({ user_id: uidv }, op.row), { onConflict: op.onConflict });
        if (r.error) throw r.error;
        delete outbox[keys[i]]; saveOutbox();
      } catch (e) { continue; }
    }
    flushing = false; updateCloudStatus();
  }

  function boardSig() { return JSON.stringify({ e: entries, t: targetOrder, m: meta }); }
  // Preserve in-progress typing across a sync-driven re-render: the never-saved
  // "Add subtask" box, plus whatever field is focused (value + caret).
  function syncRender() {
    var active = document.activeElement, snaps = [];
    document.querySelectorAll("input[data-act], textarea[data-act]").forEach(function (el) {
      var a = el.getAttribute("data-act"), focused = el === active;
      if (a !== "subnew" && !focused) return;
      var kEl = el.closest("[data-key]"), sEl = el.closest("[data-sid]");
      var ss = null, se = null; try { ss = el.selectionStart; se = el.selectionEnd; } catch (e) {}
      snaps.push({ a: a, key: kEl ? kEl.getAttribute("data-key") : null, sid: sEl ? sEl.getAttribute("data-sid") : null, val: el.value, focused: focused, ss: ss, se: se });
    });
    renderAll();
    snaps.forEach(function (s) {
      var els = document.querySelectorAll('[data-act="' + s.a + '"]'), el = null;
      for (var i = 0; i < els.length; i++) {
        var kEl = els[i].closest("[data-key]"), sEl = els[i].closest("[data-sid]");
        if ((kEl ? kEl.getAttribute("data-key") : null) === s.key && (sEl ? sEl.getAttribute("data-sid") : null) === s.sid) { el = els[i]; break; }
      }
      if (!el) return;
      if (el.value !== s.val) el.value = s.val;
      if (s.focused) { try { el.focus(); if (s.ss != null) el.setSelectionRange(s.ss, s.se); } catch (e) {} }
    });
    lastCloudSig = boardSig();
  }

  async function cloudPullEntries() {
    if (!syncReady()) return;
    try {
      var r = await sb.from("weekly_focus_entries").select("item_key,payload").eq("board_id", cloud.board);
      if (r.error) throw r.error;
      var rows = r.data || [];
      if (!rows.length && (state.apps.length || state.study.length || Object.keys(entries).length)) {
        // empty cloud board + this device has data → seed cloud (never wipe local)
        cloudPushInv(); cloudPushBoard(); Object.keys(entries).forEach(function (k) { cloudPushEntry(k, entries[k]); }); flushOutbox(); updateCloudStatus(); return;
      }
      var map = {}, remoteSubsBy = {};
      rows.forEach(function (row) { var p = row.payload || {}; map[row.item_key] = p; remoteSubsBy[row.item_key] = normSubs(p.subtasks); });
      Object.keys(outbox).forEach(function (qk) {                 // pending local writes win (scalars); subtasks merged below
        if (qk.indexOf("entry:") === 0) map[outbox[qk].row.item_key] = outbox[qk].row.payload;
        if (qk.indexOf("del:") === 0) { delete map[qk.slice(4)]; delete remoteSubsBy[qk.slice(4)]; }
      });
      if (map[BOARD_ITEM]) { var b = map[BOARD_ITEM]; delete map[BOARD_ITEM]; if ((b.u || 0) >= boardU) { if (Array.isArray(b.targetOrder)) targetOrder = b.targetOrder; if (b.meta) meta = b.meta; boardU = b.u || 0; } }
      Object.keys(map).forEach(function (k) {                     // union-merge subtasks: remote ∪ local-current
        if (k === BOARD_ITEM) return;
        var remoteSubs = remoteSubsBy[k] || [];
        var merged = mergeSubs(remoteSubs, normSubs((entries[k] || {}).subtasks));
        map[k] = Object.assign({}, map[k], { subtasks: merged });
        if (subsDiffer(remoteSubs, merged)) cloudPushEntry(k, map[k]);   // converge server; gate prevents push storms
      });
      entries = map; save();
      // Only touch the DOM when the board actually changed — otherwise the 15s
      // poll / tab-return needlessly rebuilds everything and flashes. Animate the
      // entrance only on the first load, never on a routine background sync.
      if (firstPull || boardSig() !== lastCloudSig) {
        if (firstPull) { firstPull = false; ENTER = true; }
        syncRender();
      }
      updateCloudStatus();
    } catch (e) { updateCloudStatus(); }
  }
  async function cloudPullInventory(force) {
    if (!syncReady()) return false;
    try {
      var r = await sb.from("weekly_focus_inventory").select("apps,study,office,updated_at").eq("board_id", cloud.board).limit(1);
      if (r.error) throw r.error;
      var rows = r.data || []; if (!rows.length) return false;
      var remoteTs = rows[0].updated_at || "";
      var hasInvPending = !!outbox["inv"];
      if (force || (!hasInvPending && (!invTs || remoteTs > invTs))) {
        setInventory(rows[0].apps, rows[0].study, false);
        state.office = Array.isArray(rows[0].office) ? rows[0].office : []; rebuildIndex();
        invTs = remoteTs || nowISO();
        ENTER = true; syncRender(); refreshGroupLists();
      }
      return true;
    } catch (e) { return false; }
  }
  function initialSync() {
    // CLOUD-FIRST: a fresh device adopts the cloud copy; a device with local
    // data keeps it and seeds the cloud only if the board is empty.
    var fresh = !state.apps.length && !state.study.length && !state.office.length;
    cloudPullInventory(fresh).then(cloudPullEntries).then(flushOutbox);
  }
  function pendingCount() { return Object.keys(outbox).length; }
  function updateCloudStatus() {
    var el = $("cloudPill"); if (!el) return;
    var banner = $("signinBanner");
    if (banner) banner.style.display = (cloudConfigured() && !signedIn()) ? "" : "none";
    if (!cloudConfigured()) { el.className = "cloud-pill off"; el.textContent = "\u2601 Cloud off"; return; }
    if (!signedIn()) { el.className = "cloud-pill auth"; el.textContent = "\u2601 Sign in"; return; }
    var n = pendingCount();
    if (!navigator.onLine) { el.className = "cloud-pill warn"; el.textContent = "\u2601 Offline" + (n ? " \u00b7 " + n : ""); }
    else if (n) { el.className = "cloud-pill warn"; el.textContent = "\u2601 Syncing " + n + "\u2026"; }
    else { el.className = "cloud-pill ok"; el.textContent = "\u2601 Synced"; }
  }
  function renderAuthUI() {
    var inEl = $("authSignedIn"), outEl = $("authSignedOut"); if (!inEl || !outEl) return;
    if (signedIn()) { inEl.style.display = ""; outEl.style.display = "none"; var who = $("authWho"); if (who) who.textContent = session.user.email || "your account"; }
    else { inEl.style.display = "none"; outEl.style.display = ""; }
  }
  function startCloud() {
    ensureClient(); renderAuthUI(); updateCloudStatus();
    setInterval(function () { if (document.visibilityState === "visible" && navigator.onLine && syncReady()) { flushOutbox(); cloudPullInventory(false); cloudPullEntries(); } }, 15000);
    window.addEventListener("online", function () { if (syncReady()) { flushOutbox(); cloudPullInventory(false); cloudPullEntries(); } updateCloudStatus(); });
    window.addEventListener("offline", updateCloudStatus);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && syncReady()) { flushOutbox(); cloudPullInventory(false); cloudPullEntries(); } });
  }
  function cloudSetStatus(html, warn) { var el = $("cloudStatus"); if (!el) return; el.innerHTML = html; el.className = "dstatus" + (warn ? " warn" : ""); }
  function cloudSummary() {
    if (!cloudConfigured()) return "Cloud is off. Enter your project details above, then <b>Save connection</b>.";
    if (!signedIn()) return "Connected to board <b>" + esc(cloud.board) + "</b> \u2014 not signed in on this device yet. Send yourself a magic link below and open it <b>on this device</b>.";
    var n = pendingCount();
    return "Syncing board <b>" + esc(cloud.board) + "</b> as <b>" + esc(session.user.email || "you") + "</b>." + (n ? " " + n + " change" + (n > 1 ? "s" : "") + " waiting to upload." : " Everything is up to date.");
  }
  function urlLooksRight(u) { return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(u); }
  async function testConnection() {
    try {
      var r = await fetch(cloud.url + "/auth/v1/health", { headers: { apikey: cloud.key } });
      if (r.status === 401 || r.status === 403) return { ok: false, msg: "Reached your project, but it <b>rejected the key</b>. Copy the <b>anon / publishable</b> key again from Supabase \u2192 Settings \u2192 API." };
      if (!r.ok) return { ok: false, msg: "The project answered HTTP " + r.status + " \u2014 double-check the Project URL." };
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: "Couldn\u2019t reach <b>" + esc(cloud.url) + "</b>. That\u2019s usually a typo \u2014 compare it letter-by-letter with Supabase \u2192 Settings \u2192 API (it must look like <code>https://abcdwxyz12345678ijkl.supabase.co</code>)." };
    }
  }
  async function saveConnection() {
    var next = { url: $("cfUrl").value.trim().replace(/\/+$/, ""), key: $("cfKey").value.trim(), board: ($("cfBoard").value.trim() || "my-week") };
    if (next.key && looksSecret(next.key)) { cloudSetStatus("That looks like a <b>secret</b> key. Use the <b>publishable</b> (<code>sb_publishable_\u2026</code>) or legacy <b>anon</b> (<code>eyJ\u2026</code>) key \u2014 never a secret / service_role key.", true); return false; }
    if (!next.url || !next.key) { cloudSetStatus("Enter your Supabase Project URL and key, then save.", true); return false; }
    if (!urlLooksRight(next.url)) { cloudSetStatus("That doesn\u2019t look like a Supabase project URL. It must be exactly the <b>Project URL</b> from Settings \u2192 API, like <code>https://abcdwxyz12345678ijkl.supabase.co</code> \u2014 check it for typos.", true); return false; }
    var changed = !cloud || cloud.url !== next.url || cloud.key !== next.key;
    cloud = next; saveCloud();
    if (changed) dropClient();
    cloudSetStatus("Checking the connection\u2026");
    var t = await testConnection();
    if (!t.ok) { cloudSetStatus(t.msg, true); updateCloudStatus(); return false; }
    ensureClient(); renderAuthUI(); updateCloudStatus();
    if (syncReady()) { initialSync(); cloudSetStatus("Connection verified \u2713 \u2014 board <b>" + esc(cloud.board) + "</b> is syncing."); }
    else cloudSetStatus("Connection verified \u2713 Now send yourself a <b>magic link</b> below and open it <b>on this device</b> to start syncing board <b>" + esc(cloud.board) + "</b>.");
    return true;
  }
  function fillCloud() {}   // connection fields are gone — the build is pre-wired via config.js
  function wireCloud() {
    var _bc = $("btnCloud"); if (_bc) _bc.onclick = function () { $("cloudModal").classList.add("open"); renderAuthUI(); updateCloudStatus(); cloudSetStatus(cloudSummary()); };
    $("cloudClose").onclick = function () { $("cloudModal").classList.remove("open"); };
    $("cloudModal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });
    var bsi = $("bannerSignIn"); if (bsi) bsi.onclick = function () { $("cloudModal").classList.add("open"); renderAuthUI(); updateCloudStatus(); cloudSetStatus(cloudSummary()); var ce = $("cfEmail"); if (ce) ce.focus(); };
    $("cloudSignIn").onclick = async function () {
      ensureClient(); if (!sb) { cloudSetStatus("Couldn\u2019t load the Supabase client (offline?). Check your connection and try again.", true); return; }
      var email = ($("cfEmail").value || "").trim();
      if (!email) { cloudSetStatus("Enter your email to get a magic link.", true); return; }
      try { var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: window.location.href } }); if (r.error) throw r.error; cloudSetStatus("Magic link sent to <b>" + esc(email) + "</b>. Open it <b>on this device, in this browser</b> to finish signing in and load your week."); }
      catch (e) { cloudSetStatus("Couldn\u2019t send the link: " + esc(e.message || String(e)), true); }
    };
    $("cloudPull").onclick = function () {
      if (!syncReady()) { cloudSetStatus("Connect and sign in first \u2014 then Pull fetches your other device\u2019s data.", true); return; }
      cloudSetStatus("Pulling latest from the cloud\u2026");
      cloudPullInventory(true).then(function (got) { return cloudPullEntries().then(function () { return got; }); }).then(function (got) {
        cloudSetStatus(got ? "Up to date \u2014 inventory and tasks refreshed from the cloud." : "The cloud board is empty. Add apps/topics on any signed-in device and they\u2019ll appear here.", !got);
      });
    };
    $("cloudSignOut").onclick = async function () {
      if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
      session = null; renderAuthUI(); updateCloudStatus();
      cloudSetStatus("Signed out. Your local copy stays on this device; sync pauses until you sign in again.");
    };
  }

  /* ============================================================
     LIVELINESS — ring count-up, confetti, drag-and-drop
     ============================================================ */
  function ordOf(id) { var e = entries[id]; return (e && typeof e.ord === "number") ? e.ord : null; }

  function animateCount(el, from, to) {
    from = from || 0; if (from === to) { el.textContent = to + "%"; return; }
    var start = null, dur = 520;
    requestAnimationFrame(function step(ts) {
      if (start == null) start = ts;
      var p = Math.min(1, (ts - start) / dur), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased) + "%";
      if (p < 1) requestAnimationFrame(step); else el.textContent = to + "%";
    });
  }

  function celebrate() {
    var colors = ["var(--brand)", "var(--study)", "var(--on)", "var(--pri-m)", "var(--pri-h)", "var(--cat-gp)"];
    for (var i = 0; i < 90; i++) {
      (function (i) {
        var p = document.createElement("div"); p.className = "confetti-piece";
        var size = 7 + Math.random() * 7, dur = 1.6 + Math.random() * 1.4, delay = Math.random() * 0.25;
        p.style.left = (Math.random() * 100) + "vw";
        p.style.width = size + "px"; p.style.height = (size * 1.5) + "px";
        p.style.background = colors[i % colors.length];
        p.style.borderRadius = (Math.random() < 0.4 ? "50%" : "2px");
        p.style.transform = "translateY(-20px) rotate(" + (Math.random() * 360) + "deg)";
        p.style.animation = "wf-confetti " + dur + "s cubic-bezier(.25,.6,.4,1) " + delay + "s forwards";
        document.body.appendChild(p);
        setTimeout(function () { p.remove(); }, (dur + delay) * 1000 + 200);
      })(i);
    }
  }

  /* Insertion point: the not-dragging element nearest *after* the pointer. */
  function afterEl(container, coord, axis, selector) {
    var els = Array.prototype.slice.call(container.querySelectorAll(selector + ":not(.dragging)"));
    var best = { dist: -Infinity, el: null };
    els.forEach(function (el) {
      var box = el.getBoundingClientRect();
      var c = axis === "x" ? coord - box.left - box.width / 2 : coord - box.top - box.height / 2;
      if (c < 0 && c > best.dist) best = { dist: c, el: el };
    });
    return best.el;
  }
  function clearHot() { var ns = document.querySelectorAll(".dropzone-hot"); for (var i = 0; i < ns.length; i++) ns[i].classList.remove("dropzone-hot"); }

  function reorderActiveItem(kind, dragId, beforeId) {
    var it0 = itemById(dragId); if (!it0) return; var grp = it0.group;
    var pool = VIEW_GROUPED
      ? activeItems(kind).filter(function (x) { return x.group === grp; })
      : activeItems(kind).filter(function (x) { return !isSpecialItem(x); });
    pool = flatSortActive(pool);   // mirrors render order in both views
    var ids = pool.map(function (x) { return x.id; });
    var from = ids.indexOf(dragId); if (from >= 0) ids.splice(from, 1);
    var at = ids.length;
    if (beforeId && itemById(beforeId) && (!VIEW_GROUPED || itemById(beforeId).group === grp)) { var bi = ids.indexOf(beforeId); if (bi >= 0) at = bi; }
    ids.splice(at, 0, dragId);
    ids.forEach(function (id, i) { entries[id] = Object.assign({}, entries[id], { ord: i }); cloudPushEntry(id, entries[id]); });
    save();
  }

  /* Flat / Groups view toggle */
  function wireViewToggle() {
    var f = $("viewFlatBtn"), g = $("viewGroupBtn");
    if (!f || !g) return;
    function paint() { f.classList.toggle("on", !VIEW_GROUPED); g.classList.toggle("on", VIEW_GROUPED); }
    function set(v) {
      VIEW_GROUPED = v;
      try { localStorage.setItem("wf2_view_grouped", v ? "1" : "0"); } catch (e) {}
      paint(); renderColumn("app"); renderColumn("study"); renderColumn("office");
    }
    f.onclick = function () { set(false); };
    g.onclick = function () { set(true); };
    paint();
  }

  /* ---- Special: pointer-based reorder (works on touch too) ---- */
  function wireSpecialDrag() {
    var host = $("specialHost"); if (!host) return;
    var dragEl = null;
    host.addEventListener("pointerdown", function (e) {
      var g = e.target.closest(".sp-grip"); if (!g) return;
      dragEl = g.closest(".sp-card"); if (!dragEl) return;
      dragEl.classList.add("dragging");
      try { g.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    host.addEventListener("pointermove", function (e) {
      if (!dragEl) return;
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var card = over && over.closest ? over.closest(".sp-card") : null;
      if (!card || card === dragEl || card.parentNode !== host) return;
      var r = card.getBoundingClientRect();
      var before = (e.clientY < r.top + r.height / 2) || (e.clientY < r.bottom && e.clientX < r.left + r.width / 2);
      host.insertBefore(dragEl, before ? card : card.nextSibling);
    });
    function endSpDrag() {
      if (!dragEl) return;
      dragEl.classList.remove("dragging"); dragEl = null;
      var ids = Array.prototype.map.call(host.querySelectorAll(".sp-card[data-key]"), function (n) { return n.getAttribute("data-key"); });
      ids.forEach(function (id, i) { entries[id] = Object.assign({}, entries[id], { spord: i }); cloudPushEntry(id, entries[id]); });
      save(); renderSpecial();
    }
    host.addEventListener("pointerup", endSpDrag);
    host.addEventListener("pointercancel", endSpDrag);
  }

  function wireDragDrop() {
    document.addEventListener("dragstart", function (e) {
      if (!e.target.closest) return;
      var t = e.target.closest("[data-tkey]");
      if (t && t.getAttribute("draggable") === "true") { DRAG = { id: t.getAttribute("data-tkey"), type: "target", kind: null }; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", DRAG.id); } catch (x) {} t.classList.add("dragging"); return; }
      var it = e.target.closest(".item[data-key]") || e.target.closest(".brow[data-key]");
      if (it && it.getAttribute("draggable") === "true") {
        var id = it.getAttribute("data-key"); DRAG = { id: id, type: "item", kind: kindOf(id) };
        e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", id); } catch (x) {} it.classList.add("dragging");
        var w = $(DRAG.kind === "app" ? "appsBacklogWrap" : "studyBacklogWrap"); if (w) { w.style.display = ""; w.classList.add("drag-reveal"); }
      }
    });
    document.addEventListener("dragend", function () {
      var d = document.querySelectorAll(".dragging"); for (var i = 0; i < d.length; i++) d[i].classList.remove("dragging");
      var r = document.querySelectorAll(".drag-reveal"); for (var j = 0; j < r.length; j++) r[j].classList.remove("drag-reveal");
      clearHot(); var wasItem = DRAG.type === "item"; DRAG = { id: null, type: null, kind: null };
      if (wasItem) { renderCols(); }
    });

    // The Five — drag to reorder
    var grid = $("fiveGrid");
    grid.addEventListener("dragover", function (e) { if (DRAG.type !== "target") return; e.preventDefault(); });
    grid.addEventListener("drop", function (e) {
      if (DRAG.type !== "target") return; e.preventDefault();
      var before = afterEl(grid, e.clientX, "x", ".tcard[data-tkey]");
      var cur = targetOrder.slice(), from = cur.indexOf(DRAG.id); if (from < 0) return; cur.splice(from, 1);
      var at = before ? cur.indexOf(before.getAttribute("data-tkey")) : cur.length; if (at < 0) at = cur.length;
      cur.splice(at, 0, DRAG.id); targetOrder = cur; save(); cloudPushBoard(); renderFive();
    });

    // Active columns — drop to activate (if needed) + reorder
    [["appsActive", "app"], ["studyActive", "study"]].forEach(function (pair) {
      var host = $(pair[0]), kind = pair[1];
      host.addEventListener("dragover", function (e) { if (DRAG.type !== "item" || DRAG.kind !== kind) return; e.preventDefault(); host.classList.add("dropzone-hot"); });
      host.addEventListener("dragleave", function (e) { if (!host.contains(e.relatedTarget)) host.classList.remove("dropzone-hot"); });
      host.addEventListener("drop", function (e) {
        if (DRAG.type !== "item" || DRAG.kind !== kind) return; e.preventDefault(); host.classList.remove("dropzone-hot");
        var before = afterEl(host, e.clientY, "y", ".item[data-key]");
        if (!isActive(itemById(DRAG.id))) patch(DRAG.id, { active: true });
        reorderActiveItem(kind, DRAG.id, before ? before.getAttribute("data-key") : null);
        ENTER = false; renderAll();
      });
    });

    // Backlog — drop to deactivate
    [["appsBacklogWrap", "app"], ["studyBacklogWrap", "study"]].forEach(function (pair) {
      var zone = $(pair[0]), kind = pair[1]; if (!zone) return;
      zone.addEventListener("dragover", function (e) { if (DRAG.type !== "item" || DRAG.kind !== kind) return; e.preventDefault(); zone.classList.add("dropzone-hot"); });
      zone.addEventListener("dragleave", function (e) { if (!zone.contains(e.relatedTarget)) zone.classList.remove("dropzone-hot"); });
      zone.addEventListener("drop", function (e) {
        if (DRAG.type !== "item" || DRAG.kind !== kind) return; e.preventDefault(); zone.classList.remove("dropzone-hot");
        patch(DRAG.id, { active: false }); removeTarget(DRAG.id); detailOpen[DRAG.id] = false;
        if (entries[DRAG.id]) delete entries[DRAG.id].ord;
        renderAll();
      });
    });
  }

  /* ============================================================
     BOARDS — multiple named focus contexts. Each board_id keeps its
     own inventory + per-item priorities/targets in Supabase, so
     switching boards swaps your whole focus. Zero schema change:
     board_id is already part of every row's primary key.
     ============================================================ */
  function updateBoardUI() { var el = $("boardName"); if (el) el.textContent = cloud.board || "my-week"; }

  function switchBoard(name) {
    name = (name || "").trim(); if (!name || name === cloud.board) { closeBoardMenu(); return; }
    cloud.board = name;
    try { localStorage.setItem("wf2_active_board", name); } catch (e) {}
    state = { apps: [], study: [], office: [] }; itemIndex = {}; rebuildIndex();
    entries = {}; targetOrder = []; meta = {}; detailOpen = {}; outbox = {}; invTs = "";
    ENTER = true; updateBoardUI(); refreshGroupLists(); renderAll(); updateCloudStatus(); closeBoardMenu();
    if (syncReady()) initialSync();           // pulls THIS board's inventory + entries
  }

  function createBoard() {
    var name = (prompt("New board name (e.g. Job hunt, App dev, Study):") || "").trim();
    if (!name) return;
    switchBoard(name);
    if (syncReady()) { cloudPushInv(); flushOutbox(); }   // materialise the empty board so it lists
    toast("Board \u201c" + name + "\u201d created.");
  }

  async function deleteBoard(name) {
    if (!confirm("Delete board \u201c" + name + "\u201d and everything in it? This can\u2019t be undone.")) return;
    if (syncReady()) {
      try { await sb.from("weekly_focus_inventory").delete().match({ user_id: session.user.id, board_id: name }); } catch (e) {}
      try { await sb.from("weekly_focus_entries").delete().match({ user_id: session.user.id, board_id: name }); } catch (e) {}
    }
    if (cloud.board === name) switchBoard((window.WF_CONFIG && WF_CONFIG.board) || "my-week");
    else openBoardMenu();
    toast("Board \u201c" + name + "\u201d deleted.");
  }

  async function listBoards() {
    var set = {}; set[cloud.board] = 1;
    if (syncReady()) {
      try { var r = await sb.from("weekly_focus_inventory").select("board_id"); (r.data || []).forEach(function (x) { set[x.board_id] = 1; }); } catch (e) {}
    }
    return Object.keys(set).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  }

  function closeBoardMenu() { var m = $("boardMenu"); if (m) m.hidden = true; }
  async function openBoardMenu() {
    var m = $("boardMenu"); if (!m) return;
    m.innerHTML = '<div class="bm-load">Loading\u2026</div>'; m.hidden = false;
    var boards = await listBoards();
    m.innerHTML = "";
    boards.forEach(function (b) {
      var row = document.createElement("div"); row.className = "bm-item" + (b === cloud.board ? " on" : "");
      row.innerHTML = '<button class="bm-pick" data-board="' + esc(b) + '">' + (b === cloud.board ? "\u2713 " : "") + esc(b) + '</button>' +
        '<button class="bm-del" data-delboard="' + esc(b) + '" title="Delete board">' + IC.trash + '</button>';
      m.appendChild(row);
    });
    var add = document.createElement("button"); add.className = "bm-new"; add.id = "bmNew"; add.textContent = "+ New board";
    m.appendChild(add);
  }

  function wireBoards() {
    var btn = $("boardBtn"); if (!btn) return;
    btn.onclick = function (e) { e.stopPropagation(); var m = $("boardMenu"); if (m.hidden) openBoardMenu(); else closeBoardMenu(); };
    $("boardMenu").addEventListener("click", function (e) {
      var pick = e.target.closest("[data-board]"); if (pick) { switchBoard(pick.getAttribute("data-board")); return; }
      var del = e.target.closest("[data-delboard]"); if (del) { e.stopPropagation(); deleteBoard(del.getAttribute("data-delboard")); return; }
      if (e.target.id === "bmNew") { createBoard(); }
    });
    document.addEventListener("click", function (e) { var p = $("boardPick"); if (p && !p.contains(e.target)) closeBoardMenu(); });
  }


  /* ============================================================
     HOME SCREENS (build 16) — Today / Calendar / Routines tabs +
     Personal–Office mode. The Week tab is the untouched curation
     space; these screens are mode-filtered views over the same data.
     Storage map (NO new tables):
       mode            localStorage "wf2_mode"  (per device)
       last tab        localStorage "wf2_tab"   (per device)
       scheduled task  entries["sched:<YYYY-MM-DD>:<itemId>"] = { done }
       routine defs    meta.routines = [{ id, name, days[], mode, links[] }]
       routine state   entries["routine:<id>"] = { streak, doneDate, prev }
     ============================================================ */
  var MODE_KEY = "wf2_mode", TAB_KEY = "wf2_tab";
  function getMode() { try { return localStorage.getItem(MODE_KEY) || "personal"; } catch (e) { return "personal"; } }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }
  function modeOf(itemId) { return kindOf(itemId) === "office" ? "office" : "personal"; }

  var HIC = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.5-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.5 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-3 5.5-3 9a3 3 0 0 0 6 .2c1.2 1 2 2.5 2 4.3A5 5 0 0 1 7 16c0-5 5-7 5-14z"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3.5l3.5 3.5L8 19.5 3.5 20.5 4.5 16z"/></svg>'
  };

  function hIso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function hTodayIso() { return hIso(new Date()); }
  function hFmt(iso) { var d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }

  var hSel = hTodayIso(), hMonthMode = false, hAnchor = new Date(), schedKind = "app";

  /* ---- links: stored as [{label,url}]; edited as "Label | https://url" lines ---- */
  function parseLinksText(text) {
    return String(text || "").split("\n").map(function (line) {
      line = line.trim(); if (!line) return null;
      var i = line.indexOf("|");
      var label = i >= 0 ? line.slice(0, i).trim() : "", url = (i >= 0 ? line.slice(i + 1) : line).trim();
      if (!/^https?:\/\//i.test(url)) return null;
      return { label: label || url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0], url: url };
    }).filter(Boolean);
  }
  function linksToText(links) {
    return (Array.isArray(links) ? links : []).map(function (l) { return (l.label || "") + " | " + (l.url || ""); }).join("\n");
  }
  function linkChips(links) {
    return (Array.isArray(links) ? links : []).map(function (l) {
      return '<a class="linkchip" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + HIC.link + esc(l.label || "link") + "</a>";
    }).join("");
  }

  /* ---- scheduled tasks: entries["sched:<date>:<itemId>"] ---- */
  function schedList(dateIso, mode) {
    var pre = "sched:" + dateIso + ":", out = [];
    Object.keys(entries).forEach(function (k) {
      if (k.indexOf(pre) !== 0) return;
      var itemId = k.slice(pre.length);
      if (mode && modeOf(itemId) !== mode) return;
      out.push({ key: k, itemId: itemId, done: !!(entries[k] && entries[k].done) });
    });
    out.sort(function (a, b) { var an = labelFor(a.itemId).name.toLowerCase(), bn = labelFor(b.itemId).name.toLowerCase(); return an < bn ? -1 : an > bn ? 1 : 0; });
    return out;
  }

  function hTaskRow(o) {
    var it = itemById(o.itemId), k = kindOf(o.itemId);
    var chip = k === "study" ? "Study" : k === "office" ? "Office" : "App";
    return '<div class="trow' + (o.done ? " done" : "") + '">' +
      '<button class="hcheck' + (o.done ? " on" : "") + '" data-hact="' + o.act + '" data-hkey="' + esc(o.key || o.itemId) + '" aria-label="Toggle done">' + HIC.check + "</button>" +
      '<div class="tmain"><div class="hname">' + esc(labelFor(o.itemId).name) + "</div>" +
      '<div class="hsub"><span class="hchip ' + k + '">' + chip + "</span>" +
      (o.star ? '<span class="hstar" title="Weekly target">\u2605</span>' : "") +
      linkChips(it && it.links) + "</div></div>" +
      (o.removable ? '<button class="hdel" data-hact="sdel" data-hkey="' + esc(o.key) + '" aria-label="Remove">' + IC.trash + "</button>" : "") +
      "</div>";
  }

  /* ============================================================
     PLACES (build 17) — condition-based lists (e.g. Shin-Ōkubo
     shopping). A place = name + optional coords + checklist.
     It surfaces on Today when: planned for today (tap a plan chip)
     OR the device is detected within ~700 m of the spot.
       place defs   meta.places = [{ id, name, lat, lng, items:[{id,t}] }]
       place state  entries["place:<id>"] = { plan, done:{itemId:true} }
     Geo: one position fix when the app opens / on the 📍 button —
     no continuous tracking.
     ============================================================ */
  function placeList() { return Array.isArray(meta.places) ? meta.places : []; }
  var nearIds = {};   // placeId -> distance (m), from the last geo fix
  function havM(la1, lo1, la2, lo2) {
    var R = 6371000, r = Math.PI / 180;
    var a = Math.sin((la2 - la1) * r / 2), b = Math.sin((lo2 - lo1) * r / 2);
    var h = a * a + Math.cos(la1 * r) * Math.cos(la2 * r) * b * b;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  var GEO_KEY = "wf2_geo";   // "1" once the user has opted in via the 📍 button
  function geoCheck(manual) {
    if (!navigator.geolocation) { if (manual) toast("No location support on this device."); return; }
    if (!manual && localStorage.getItem(GEO_KEY) !== "1") return;
    var withCoords = placeList().filter(function (p) { return p.lat != null && p.lng != null; });
    if (!withCoords.length) { if (manual) toast("No place has a location yet — edit one and tap \u201cUse my location\u201d."); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      localStorage.setItem(GEO_KEY, "1");
      var changed = false, near = {};
      withCoords.forEach(function (p) {
        var d = havM(pos.coords.latitude, pos.coords.longitude, p.lat, p.lng);
        if (d <= (p.rad || 700)) near[p.id] = Math.round(d);
      });
      changed = JSON.stringify(near) !== JSON.stringify(nearIds);
      nearIds = near;
      if (manual) toast(Object.keys(near).length ? "You're near " + placeList().filter(function (p) { return near[p.id] != null; }).map(function (p) { return p.name; }).join(", ") + " — list is on Today." : "No saved place nearby.");
      if (changed || manual) { renderTodayScreen(); renderPlaces(); }
    }, function () { if (manual) toast("Couldn't get your location — check the browser's location permission."); }, { maximumAge: 120000, timeout: 8000, enableHighAccuracy: false });
  }
  /* ---- weekly check-in nudge: "Going to Shin-\u014ckubo?" ---- */
  function placeNudges(t) {
    var now = new Date(), out = [];
    placeList().forEach(function (p) {
      if (!p.ask || p.ask.d == null) return;
      if (now.getDay() !== p.ask.d) return;
      if (hhmmNow() < (p.ask.t || "18:00")) return;
      var st = getEntry("place:" + p.id);
      if (st.askedDate === t || st.plan === t) return;
      out.push(p);
    });
    return out;
  }
  function nudgeCard(p) {
    return '<div class="nudge">' + HIC.pin +
      '<span class="nudge-q">Going to <b>' + esc(p.name) + "</b>?</span>" +
      '<button class="chip on" data-hact="plyes" data-hkey="' + esc(p.id) + '">Yes, today</button>' +
      '<button class="chip" data-hact="plno" data-hkey="' + esc(p.id) + '">Not this time</button></div>';
  }

  function placeActive(p, t) {
    var st = getEntry("place:" + p.id);
    return st.plan === t || nearIds[p.id] != null;
  }
  function placeCard(p, t, onToday) {
    var st = getEntry("place:" + p.id), dn = st.done || {};
    var items = Array.isArray(p.items) ? p.items : [];
    var doneN = items.filter(function (i) { return dn[i.id]; }).length;
    var near = nearIds[p.id] != null;
    var planned = st.plan === t;
    var why = near ? '<span class="hchip nearby">' + HIC.pin + "you're nearby" + "</span>" : planned ? '<span class="hchip planned">planned today</span>' : "";
    var list = items.map(function (i) {
      return '<label class="plitem' + (dn[i.id] ? " done" : "") + '"><button class="sub-check' + (dn[i.id] ? " on" : "") + '" data-hact="plitem" data-hkey="' + esc(p.id) + '" data-hsid="' + esc(i.id) + '" aria-label="done"></button><span>' + esc(i.t) + "</span></label>";
    }).join("") || '<span class="pl-none">List is empty — edit the place to add items.</span>';
    var plans = onToday ? "" :
      '<div class="pl-plan">' +
      '<button class="chip' + (planned ? " on" : "") + '" data-hact="plplan" data-hkey="' + esc(p.id) + '">' + (planned ? "Planned today \u2713" : "Going today") + "</button>" +
      (doneN ? '<button class="chip" data-hact="plreset" data-hkey="' + esc(p.id) + '">Uncheck all</button>' : "") +
      "</div>";
    return '<div class="place-card' + ((near || planned) ? " live" : "") + '">' +
      '<div class="pl-head"><span class="pl-name">' + HIC.pin + esc(p.name) + "</span>" + why +
      '<span class="pl-count">' + doneN + "/" + items.length + "</span>" +
      '<button class="redit" data-hact="pledit" data-hkey="' + esc(p.id) + '" title="Edit place">' + HIC.pen + "</button></div>" +
      '<div class="pl-items">' + list + "</div>" + plans + "</div>";
  }
  function renderPlaces() {
    var host = $("placeRows"); if (!host) return;
    var t = hTodayIso();
    host.innerHTML = placeList().map(function (p) { return placeCard(p, t, false); }).join("") ||
      '<div class="hs-empty">No places yet — add Shin-Ōkubo and its shopping list below.</div>';
  }

  /* ---- place editor ---- */
  var plEditing = null, plAskSel = null;
  function openPlaceEd(id) {
    plEditing = id || null;
    var p = id ? placeList().find(function (x) { return x.id === id; }) : null;
    $("plTitle").textContent = p ? "Edit place" : "Add place";
    $("plName").value = p ? p.name : "";
    $("plCoords").value = p && p.lat != null ? p.lat + ", " + p.lng : "";
    $("plItems").value = p ? (p.items || []).map(function (i) { return i.t; }).join("\n") : "";
    plAskSel = p && p.ask ? p.ask.d : null;
    $("plAskT").value = p && p.ask && p.ask.t ? p.ask.t : "18:00";
    Array.prototype.forEach.call($("plAskDays").children, function (b) { b.classList.toggle("on", plAskSel === +b.getAttribute("data-hday")); });
    $("plDelete").style.display = p ? "" : "none";
    $("placeModal").classList.add("open");
    setTimeout(function () { $("plName").focus(); }, 30);
  }
  function savePlaceEd() {
    var name = $("plName").value.trim(); if (!name) { $("plName").focus(); return; }
    var old = plEditing ? placeList().find(function (x) { return x.id === plEditing; }) : null;
    var oldItems = old ? (old.items || []) : [];
    var m = $("plCoords").value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    var items = $("plItems").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean).map(function (txt) {
      var keep = oldItems.find(function (i) { return i.t === txt; });
      return { id: keep ? keep.id : "pi" + Math.random().toString(36).slice(2, 8), t: txt };
    });
    var p = { id: plEditing || "pl" + Date.now().toString(36), name: name, items: items };
    if (m) { p.lat = parseFloat(m[1]); p.lng = parseFloat(m[2]); }
    if (plAskSel != null) p.ask = { d: plAskSel, t: $("plAskT").value || "18:00" };
    if (!Array.isArray(meta.places)) meta.places = [];
    var i = meta.places.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) meta.places[i] = p; else meta.places.push(p);
    save(); cloudPushBoard();
    $("placeModal").classList.remove("open");
    renderPlaces(); renderTodayScreen();
    toast("Place saved.");
  }
  function deletePlaceEd() {
    if (!plEditing) return;
    if (!confirm("Delete this place and its list?")) return;
    meta.places = placeList().filter(function (x) { return x.id !== plEditing; });
    delete entries["place:" + plEditing]; save(); cloudDeleteEntry("place:" + plEditing); cloudPushBoard();
    $("placeModal").classList.remove("open");
    renderPlaces(); renderTodayScreen();
    toast("Place deleted.");
  }

  /* ---------------- SCREEN: TODAY ---------------- */
  /* Routines scheduled today \u2014 commute-friendly: they ignore mode hours
     and sit just below the priority tasks, above the weekly targets. */
  function effStreak(r, st, t) {
    return (st.doneDate === t || st.doneDate === prevScheduledIso(r, t)) ? (st.streak || 0) : 0;
  }
  function streakChip(n) {
    return n > 0 ? '<span class="streak" title="Current streak">' + HIC.flame + n + " day" + (n === 1 ? "" : "s") + "</span>" : "";
  }
  function hRoutineRow(r, isDone, eff) {
    return '<div class="trow rtn' + (isDone ? " done" : "") + '">' +
      '<button class="hcheck' + (isDone ? " on" : "") + '" data-hact="rtoggle2" data-hkey="' + esc(r.id) + '" aria-label="Toggle done">' + HIC.check + "</button>" +
      '<div class="tmain"><div class="hname">' + esc(r.name) + "</div>" +
      '<div class="hsub"><span class="hchip rtn">' + esc((r.cat || "").trim() || "Routine") + "</span>" + streakChip(eff) + linkChips(r.links) + "</div></div></div>";
  }
  /* Special tasks that belong on today's plate: urgent (even undated),
     due today, or overdue \u2014 filtered by the current mode. */
  function todaySpecialRows(mode) {
    var out = [];
    activeItems("app").concat(activeItems("study")).filter(isSpecialItem).forEach(function (it) {
      visibleSubs(subs(it.id)).forEach(function (x) {
        if (!subModeOk(x.md, mode)) return;
        var v = whenView(x), w = v && v.w;
        var overdue = !!(w && w.pastDue && !x.done);
        var isToday = !!(w && w.diff === 0);
        var soon = !!(v && v.soon && !x.done);   // countdown deadline inside 7 days
        if (!(x.urg || isToday || overdue || soon)) return;
        out.push({ it: it, x: x, v: v, w: w, od: overdue, asap: !x.done && (x.urg || (v && v.asap)), soon: soon });
      });
    });
    out.sort(function (a, b) {
      function rk(o) { return o.x.done ? 6 : o.od ? 0 : o.x.urg ? 1 : o.asap ? 2 : o.soon ? 3 : 4; }
      var ra = rk(a), rb = rk(b); if (ra !== rb) return ra - rb;
      var aw = a.x.when || "9999", bw = b.x.when || "9999";
      return aw < bw ? -1 : aw > bw ? 1 : 0;
    });
    return out;
  }
  var trayOpen = false;
  function hSubRow(r, dim) {
    var v = r.v;
    var odDays = r.od ? Math.max(0, -(r.w.diff)) : 0;
    var chip = r.od ? "" : v ? '<span class="hwhen' + (r.x.done ? "" : v.cls) + '">' + esc(v.label) + "</span>" : "";
    return '<div class="trow' + (r.x.done ? " done" : "") + (r.od ? " od" : r.asap ? " asap" : "") + (r.soon ? " soon" : "") + (dim ? " dim" : "") + '">' +
      '<button class="hcheck' + (r.x.done ? " on" : "") + '" data-hact="sub2" data-hkey="' + esc(r.it.id) + '" data-hsid="' + esc(r.x.id) + '" aria-label="Toggle done">' + HIC.check + "</button>" +
      '<div class="tmain"><div class="hname">' + esc(r.x.t || "task") + "</div>" +
      '<div class="hsub">' +
      (r.od ? '<span class="hchip odflag">OVERDUE' + (odDays > 0 ? " \u00b7 " + odDays + (odDays === 1 ? " day" : " days") : " \u00b7 today") + "</span>" : r.asap ? '<span class="hchip asapflag">' + IC.flag + "ASAP</span>" : "") +
      '<span class="hsrc">' + esc(r.it.name) + "</span>" + chip + subModeTag(r.x) + "</div></div></div>";
  }
  function renderTodayScreen() {
    var host = $("todayRows"); if (!host) return;
    var mode = getMode(), t = hTodayIso();
    var rows = [], total = 0, done = 0;
    /* 0 \u2014 weekly place check-ins (e.g. "Going to Shin-\u014ckubo?" on Friday evening) */
    placeNudges(t).forEach(function (p) { rows.push(nudgeCard(p)); });
    /* 1 \u2014 urgent / due / overdue Special tasks (window-suppressed unless ASAP) */
    var live = [], tray = [];
    todaySpecialRows(mode).forEach(function (r) { (!r.asap && !r.od && !inWindow(r.x.md) ? tray : live).push(r); });
    /* overdue banner \u2014 the guilt trip is the point */
    var odRows = live.filter(function (r) { return r.od; });
    if (odRows.length) {
      var maxD = Math.max.apply(null, odRows.map(function (r) { return Math.max(1, -(r.w.diff)); }));
      rows.push('<div class="od-banner">' + IC.flag + "<b>" + odRows.length + " overdue</b><span>" +
        (maxD >= 2 ? "oldest has waited " + maxD + " days \u2014 " : "") +
        "one tap each and the slate is clean.</span></div>");
    }
    live.forEach(function (r) { total++; if (r.x.done) done++; rows.push(hSubRow(r)); });
    /* 2 \u2014 place lists: planned for today, or you're near the spot */
    placeList().forEach(function (p) { if (placeActive(p, t)) rows.push(placeCard(p, t, true)); });
    /* 3 \u2014 routines scheduled today (tests etc. \u2014 doable on the commute, so no hour-tray) */
    var dow = new Date().getDay();
    var rlist = routineList().filter(function (r) { return (r.mode || "personal") === mode && (r.days || []).indexOf(dow) >= 0; });
    rlist.sort(function (a, b) {
      var ad = getEntry("routine:" + a.id).doneDate === t ? 1 : 0, bd = getEntry("routine:" + b.id).doneDate === t ? 1 : 0;
      return ad - bd || String(a.cat || "").toLowerCase().localeCompare(String(b.cat || "").toLowerCase()) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    });
    rlist.forEach(function (r) {
      var st = getEntry("routine:" + r.id), isDone = st.doneDate === t;
      total++; if (isDone) done++;
      rows.push(hRoutineRow(r, isDone, effStreak(r, st, t)));
    });
    /* 4 \u2014 weekly targets */
    targetOrder.forEach(function (id) {
      if (modeOf(id) !== mode) return;
      total++; if (targetDone(id)) done++;
      rows.push(hTaskRow({ itemId: id, done: targetDone(id), star: true, act: "ttoggle" }));
    });
    /* 5 \u2014 tasks scheduled onto today from the Calendar tab */
    schedList(t, mode).forEach(function (s) {
      if (targetOrder.indexOf(s.itemId) >= 0) return;
      total++; if (s.done) done++;
      rows.push(hTaskRow({ key: s.key, itemId: s.itemId, done: s.done, act: "stoggle" }));
    });
    /* 6 \u2014 tray: single-mode tasks waiting for their hours */
    if (tray.length) {
      tray.forEach(function (r) { total++; if (r.x.done) done++; });
      var hrs = modeHours()[mode === "office" ? "o" : "p"];
      rows.push('<button class="htray" data-hact="tray">' + (trayOpen ? "Hide" : "Show") + " " + tray.length + " task" + (tray.length === 1 ? "" : "s") + " waiting for " + mode + " hours (" + fmtRange(hrs) + ")</button>");
      if (trayOpen) tray.forEach(function (r) { rows.push(hSubRow(r, true)); });
    }
    var cnt = $("todayCount"); if (cnt) cnt.textContent = done + "/" + total;
    host.innerHTML = rows.join("") || '<div class="hs-empty">Nothing on today\u2019s plate \u2014 star a weekly target or schedule a task from the Calendar tab.</div>';
    var now = new Date();
    var dw = $("todayDow"); if (dw) dw.textContent = now.toLocaleDateString("en-GB", { weekday: "long" });
    var dd = $("todayDate"); if (dd) dd.textContent = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  }

  /* ---------------- SCREEN: CALENDAR ---------------- */
  function hDcell(d, otherMonth) {
    var dIso = hIso(d), tasks = schedList(dIso, getMode());
    return '<button class="dcell' + (dIso === hTodayIso() ? " today" : "") + (dIso === hSel ? " sel" : "") + (otherMonth ? " othermonth" : "") + '" data-hact="day" data-hkey="' + dIso + '">' +
      '<span class="dw">' + d.toLocaleDateString("en-GB", { weekday: "narrow" }) + "</span>" +
      '<span class="dn">' + d.getDate() + "</span>" +
      '<span class="dots">' + tasks.slice(0, 3).map(function (s) { var k = kindOf(s.itemId); return "<i" + (k !== "app" ? ' class="' + k + '"' : "") + "></i>"; }).join("") + "</span>" +
      "</button>";
  }
  function renderCalScreen() {
    var strip = $("hWeekstrip"); if (!strip) return;
    var sel = new Date(hSel + "T00:00:00");
    var monday = new Date(sel); monday.setDate(sel.getDate() - ((sel.getDay() + 6) % 7));
    var sHtml = "";
    for (var i = 0; i < 7; i++) { var d = new Date(monday); d.setDate(monday.getDate() + i); sHtml += hDcell(d, false); }
    strip.innerHTML = sHtml;

    var grid = $("hMonthgrid"), gHtml = "";
    var first = new Date(hAnchor.getFullYear(), hAnchor.getMonth(), 1);
    var start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    for (var j = 0; j < 42; j++) {
      var dd = new Date(start); dd.setDate(start.getDate() + j);
      gHtml += hDcell(dd, dd.getMonth() !== hAnchor.getMonth());
    }
    grid.innerHTML = gHtml;
    $("hCalMonth").textContent = (hMonthMode ? hAnchor : sel).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    $("hCalCard").classList.toggle("month", hMonthMode);
    $("hCalExpand").textContent = hMonthMode ? "Week" : "Month";

    $("hDayLabel").textContent = hSel === hTodayIso() ? "Today \u2014 " + hFmt(hSel) : hFmt(hSel);
    var tasks = schedList(hSel, getMode());
    $("hDayN").textContent = tasks.length ? tasks.length + (tasks.length === 1 ? " task" : " tasks") : "free";
    $("hDayRows").innerHTML = tasks.map(function (s) {
      return hTaskRow({ key: s.key, itemId: s.itemId, done: s.done, act: "stoggle", removable: true });
    }).join("") || '<div class="hs-empty">No tasks on this day.</div>';
  }
  function hNavCal(dir) {
    if (hMonthMode) hAnchor = new Date(hAnchor.getFullYear(), hAnchor.getMonth() + dir, 1);
    else { var d = new Date(hSel + "T00:00:00"); d.setDate(d.getDate() + dir * 7); hSel = hIso(d); }
    renderCalScreen();
  }

  /* ---- schedule sheet ---- */
  function openSched() {
    schedKind = getMode() === "office" ? "office" : "app";
    $("schedDate").textContent = hFmt(hSel);
    renderSchedSheet();
    $("schedModal").classList.add("open");
  }
  function renderSchedSheet() {
    var tabs = $("schedTabs");
    Array.prototype.forEach.call(tabs.children, function (b) { b.classList.toggle("on", b.getAttribute("data-hkind") === schedKind); });
    var body = $("schedBody"), rows = "";
    arrFor(schedKind).forEach(function (it) {
      if (isSpecialItem(it)) return;
      var added = !!entries["sched:" + hSel + ":" + it.id];
      var color = schedKind === "app" ? catColor(it.group) : "oklch(0.55 0.13 " + hueFor(it.group) + ")";
      rows += '<button class="pick' + (added ? " added" : "") + '" data-hact="spick" data-hkey="' + esc(it.id) + '">' +
        '<span class="pdot" style="background:' + color + '"></span>' +
        '<span class="ptxt"><span class="pname">' + esc(it.name) + '</span><br><span class="pcrumb">' + esc(it.group) + "</span></span>" +
        (added ? '<span class="ptag" style="background:var(--on)">Added</span>' : "") +
        "</button>";
    });
    body.innerHTML = rows || '<div class="modal-empty">Nothing in this pool yet.<br>Add items on the Week tab first.</div>';
  }

  /* ---------------- SCREEN: ROUTINES ---------------- */
  function routineList() { return Array.isArray(meta.routines) ? meta.routines : []; }
  function routineCats() {
    var seen = {}, out = [];
    routineList().forEach(function (r) { var c = (r.cat || "").trim(); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c); } });
    return out.sort();
  }
  function prevScheduledIso(r, fromIso) {
    var d = new Date(fromIso + "T00:00:00");
    for (var i = 1; i <= 7; i++) { d.setDate(d.getDate() - 1); if ((r.days || []).indexOf(d.getDay()) >= 0) return hIso(d); }
    return null;
  }
  /* 14-day history strip: did the tests actually happen every day? */
  function histStrip(r, st, t) {
    var hist = Array.isArray(st.hist) ? st.hist : [];
    var cells = "", d = new Date(t + "T00:00:00");
    d.setDate(d.getDate() - 13);
    for (var i = 0; i < 14; i++) {
      var iso = hIso(d), sched = (r.days || []).indexOf(d.getDay()) >= 0;
      var dDone = hist.indexOf(iso) >= 0 || st.doneDate === iso;
      var cls = dDone ? "d" : !sched ? "off" : iso === t ? "p" : "m";
      var tip = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + (dDone ? " \u2014 done" : !sched ? "" : iso === t ? " \u2014 today" : " \u2014 missed");
      cells += '<i class="' + cls + '" title="' + esc(tip) + '"></i>';
      d.setDate(d.getDate() + 1);
    }
    return '<span class="rhist" title="Last 14 days">' + cells + "</span>";
  }
  function renderRoutinesScreen() {
    var host = $("routineRows"); if (!host) return;
    var mode = getMode(), t = hTodayIso(), dow = new Date().getDay();
    var DL = ["M", "T", "W", "T", "F", "S", "S"];
    var list = routineList().filter(function (r) { return (r.mode || "personal") === mode; });
    list.sort(function (a, b) {
      var at = (a.days || []).indexOf(dow) >= 0 ? 0 : 1, bt = (b.days || []).indexOf(dow) >= 0 ? 0 : 1;
      return at - bt || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    });
    var todayN = 0, doneN = 0, html = "";
    /* group by category \u2014 e.g. "Quick tests", "Written tests"; uncategorised last */
    var cats = [], byCat = {};
    list.forEach(function (r) {
      var c = (r.cat || "").trim();
      if (!byCat[c]) { byCat[c] = []; cats.push(c); }
      byCat[c].push(r);
    });
    cats.sort(function (a, b) { return (a === "") - (b === "") || a.toLowerCase().localeCompare(b.toLowerCase()); });
    cats.forEach(function (c) {
      if (c || cats.length > 1) html += '<div class="rcat">' + (c ? esc(c) : "Other") + '<span class="rcat-n">' + byCat[c].length + "</span></div>";
      byCat[c].forEach(function (r) {
      var isToday = (r.days || []).indexOf(dow) >= 0;
      var st = getEntry("routine:" + r.id);
      var isDone = st.doneDate === t;
      var eff = effStreak(r, st, t);
      if (isToday) { todayN++; if (isDone) doneN++; }
      var dots = DL.map(function (l, i) {
        var jsDay = (i + 1) % 7;
        return "<i" + ((r.days || []).indexOf(jsDay) >= 0 ? ' class="on"' : "") + ">" + l + "</i>";
      }).join("");
      html += '<div class="rrow' + (isToday ? "" : " offday") + (isDone && isToday ? " done" : "") + '">' +
        '<button class="hcheck' + (isDone ? " on" : "") + '" data-hact="rtoggle" data-hkey="' + esc(r.id) + '" aria-label="Toggle done">' + HIC.check + "</button>" +
        '<div class="rmain"><span class="rname">' + esc(r.name) + "</span>" +
        '<div class="rmeta">' + streakChip(eff) + linkChips(r.links) + "</div>" +
        histStrip(r, st, t) +
        '<span class="daydots">' + dots + "</span></div>" +
        '<button class="redit" data-hact="redit" data-hkey="' + esc(r.id) + '" title="Edit routine">' + HIC.pen + "</button>" +
        "</div>";
      });
    });
    var cnt = $("routineCount"); if (cnt) cnt.textContent = doneN + "/" + todayN;
    host.innerHTML = html || '<div class="hs-empty">No ' + esc(mode) + ' routines yet \u2014 add one below.</div>';
  }
  function toggleRoutine(id) {
    var r = routineList().find(function (x) { return x.id === id; }); if (!r) return;
    var rk = "routine:" + id, st = getEntry(rk), t = hTodayIso();
    var hist = Array.isArray(st.hist) ? st.hist.slice() : [];
    if (st.doneDate === t) {
      var prev = st.prev || {};
      patch(rk, { doneDate: prev.doneDate || null, streak: prev.streak || 0, prev: null, hist: hist.filter(function (d) { return d !== t; }) });
    } else {
      var cont = !!(st.doneDate && st.doneDate === prevScheduledIso(r, t));
      if (hist.indexOf(t) < 0) hist.push(t);
      hist.sort(); if (hist.length > 120) hist = hist.slice(hist.length - 120);
      patch(rk, { prev: { doneDate: st.doneDate || null, streak: st.streak || 0 }, doneDate: t, streak: cont ? (st.streak || 0) + 1 : 1, hist: hist });
    }
    renderRoutinesScreen(); renderTodayScreen();
  }

  /* ---- routine editor ---- */
  var rtEditing = null, rtDaySel = [];
  function openRoutineEd(id) {
    rtEditing = id || null;
    var r = id ? routineList().find(function (x) { return x.id === id; }) : null;
    $("rtTitle").textContent = r ? "Edit routine" : "Add routine";
    $("rtName").value = r ? r.name : "";
    rtDaySel = r ? (r.days || []).slice() : [1, 2, 3, 4, 5];
    var rMode = r ? (r.mode || "personal") : getMode();
    $("rtCat").value = r ? (r.cat || "") : "";
    $("rtCatList").innerHTML = routineCats().map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("");
    Array.prototype.forEach.call($("rtDays").children, function (b) { b.classList.toggle("on", rtDaySel.indexOf(+b.getAttribute("data-hday")) >= 0); });
    Array.prototype.forEach.call($("rtMode").children, function (b) { b.classList.toggle("on", b.getAttribute("data-hmode") === rMode); });
    $("rtLinks").value = r ? linksToText(r.links) : "";
    $("rtDelete").style.display = r ? "" : "none";
    $("routineModal").classList.add("open");
    setTimeout(function () { $("rtName").focus(); }, 30);
  }
  function closeRoutineEd() { $("routineModal").classList.remove("open"); }
  function saveRoutineEd() {
    var name = $("rtName").value.trim(); if (!name) { $("rtName").focus(); return; }
    var modeBtn = $("rtMode").querySelector(".on");
    var r = {
      id: rtEditing || uid(),
      name: name,
      days: rtDaySel.slice().sort(),
      cat: $("rtCat").value.trim(),
      mode: modeBtn ? modeBtn.getAttribute("data-hmode") : "personal",
      links: parseLinksText($("rtLinks").value)
    };
    if (!Array.isArray(meta.routines)) meta.routines = [];
    var i = meta.routines.findIndex(function (x) { return x.id === r.id; });
    if (i >= 0) meta.routines[i] = r; else meta.routines.push(r);
    save(); cloudPushBoard();
    closeRoutineEd(); renderRoutinesScreen();
    toast("Routine saved.");
  }
  function deleteRoutineEd() {
    if (!rtEditing) return;
    if (!confirm("Delete this routine and its streak?")) return;
    meta.routines = routineList().filter(function (x) { return x.id !== rtEditing; });
    delete entries["routine:" + rtEditing]; save(); cloudDeleteEntry("routine:" + rtEditing); cloudPushBoard();
    closeRoutineEd(); renderRoutinesScreen();
    toast("Routine deleted.");
  }

  /* ---------------- live info cards (weather + trains via info-feeds.js) ---------------- */
  function renderFeeds() {
    if (!window.WF_FEEDS || !$("wxMain")) return;
    WF_FEEDS.loadWeather().then(function (wx) {
      var t = wx.today; if (!t) return;
      $("wxMain").textContent = t.label + " \u00b7 " + t.tMax + "\u00b0 / " + t.tMin + "\u00b0";
      $("wxSub").textContent = t.rainy ? "carry an umbrella" : "no rain expected";
      $("wxCard").classList.toggle("warn", !!t.rainy);
    }).catch(function () {
      $("wxMain").textContent = "Offline";
      $("wxSub").textContent = "couldn\u2019t reach the forecast";
    });
    var nt = WF_FEEDS.nextTrains();
    if (nt.trains && nt.trains.length) {
      var first = nt.trains[0];
      $("trainMain").textContent = first.time + " \u00b7 in " + first.inMin + " min";
      $("trainSub").textContent = nt.label + (nt.trains[1] ? " \u00b7 then " + nt.trains[1].time : "");
    } else {
      $("trainMain").textContent = "No trains";
      $("trainSub").textContent = nt.note || "outside timetable window";
    }
    WF_FEEDS.checkDelays().then(function (d) {
      var bad = Object.keys(d).filter(function (k) { return !d[k].ok; });
      if (bad.length) {
        $("trainCard").classList.add("warn");
        var names = bad.map(function (k) { return WF_FEEDS.LINE_NAMES[k]; }).join(", ");
        $("trainSub").textContent = names + ": " + (d[bad[0]].text || "delays reported").slice(0, 60);
      } else $("trainCard").classList.remove("warn");
    }).catch(function () {});
  }

  /* ---------------- MODE + TABS + WIRING ---------------- */
  function renderHome() {
    if (!$("scrToday")) return;
    renderTodayScreen(); renderCalScreen(); renderRoutinesScreen(); renderPlaces();
  }

  function applyMode(mode, focusSeg) {
    setMode(mode);
    document.body.setAttribute("data-mode", mode);
    renderCols();   // build 17: Special section + agenda on the Week tab follow the mode too
    var seg = $("modeSeg"); if (!seg) return;
    seg.setAttribute("data-active", mode);
    Array.prototype.forEach.call(seg.querySelectorAll(".seg"), function (btn) {
      var on = btn.getAttribute("data-mode") === mode;
      btn.setAttribute("aria-checked", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
      if (on && focusSeg) btn.focus();
    });
    renderHome();
  }

  function showScreen(id) {
    if (!$(id)) id = "scrToday";
    Array.prototype.forEach.call(document.querySelectorAll(".screen"), function (s) { s.classList.toggle("on", s.id === id); });
    Array.prototype.forEach.call(document.querySelectorAll(".htab"), function (t) { t.classList.toggle("on", t.getAttribute("data-screen") === id); });
    try { localStorage.setItem(TAB_KEY, id); } catch (e) {}
    window.scrollTo({ top: 0 });
  }

  function wireHome() {
    if (!$("scrToday")) return;

    /* bottom tabs */
    Array.prototype.forEach.call(document.querySelectorAll(".htab"), function (t) {
      t.addEventListener("click", function () { showScreen(t.getAttribute("data-screen")); });
    });
    var t0 = "scrToday"; try { t0 = localStorage.getItem(TAB_KEY) || t0; } catch (e) {}
    showScreen(t0);

    /* mode segmented pill (click + roving-tabindex arrows) */
    var seg = $("modeSeg");
    var radios = Array.prototype.slice.call(seg.querySelectorAll(".seg"));
    radios.forEach(function (btn) {
      btn.addEventListener("click", function () { if (getMode() !== btn.getAttribute("data-mode")) applyMode(btn.getAttribute("data-mode"), true); });
    });
    seg.addEventListener("keydown", function (e) {
      var idx = radios.findIndex(function (b) { return b.getAttribute("data-mode") === getMode(); });
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % radios.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + radios.length) % radios.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = radios.length - 1;
      if (next !== null) { e.preventDefault(); applyMode(radios[next].getAttribute("data-mode"), true); }
    });
    applyMode(getMode());

    /* calendar nav + schedule sheet */
    $("hCalPrev").onclick = function () { hNavCal(-1); };
    $("hCalNext").onclick = function () { hNavCal(1); };
    $("hCalExpand").onclick = function () { hMonthMode = !hMonthMode; hAnchor = new Date(hSel + "T00:00:00"); renderCalScreen(); };
    $("hAddSched").onclick = openSched;

    /* mode hours + task sheet (build 17) */
    var hb = $("hoursBtn"); if (hb) hb.onclick = openHours;
    var hsv = $("hrSave"); if (hsv) hsv.onclick = saveHours;
    var hcl = $("hrClose"); if (hcl) hcl.onclick = function () { $("hoursModal").classList.remove("open"); };
    var hmm = $("hoursModal"); if (hmm) hmm.addEventListener("click", function (e) { if (e.target === hmm) hmm.classList.remove("open"); });
    wireTaskSheet();
    $("schedTabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-hkind]"); if (!b) return;
      schedKind = b.getAttribute("data-hkind"); renderSchedSheet();
    });
    $("schedClose").onclick = function () { $("schedModal").classList.remove("open"); };
    $("schedModal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });

    /* routine editor */
    $("addRoutineBtn").onclick = function () { openRoutineEd(null); };
    $("rtDays").addEventListener("click", function (e) {
      var b = e.target.closest("[data-hday]"); if (!b) return;
      var d = +b.getAttribute("data-hday"), i = rtDaySel.indexOf(d);
      if (i >= 0) rtDaySel.splice(i, 1); else rtDaySel.push(d);
      b.classList.toggle("on", i < 0);
    });
    $("rtMode").addEventListener("click", function (e) {
      var b = e.target.closest("[data-hmode]"); if (!b) return;
      Array.prototype.forEach.call($("rtMode").children, function (x) { x.classList.toggle("on", x === b); });
    });
    $("rtSave").onclick = saveRoutineEd;
    $("rtDelete").onclick = deleteRoutineEd;
    $("rtClose").onclick = closeRoutineEd;
    $("routineModal").addEventListener("click", function (e) { if (e.target === this) closeRoutineEd(); });

    /* places */
    $("addPlaceBtn").onclick = function () { openPlaceEd(null); };
    $("plSave").onclick = savePlaceEd;
    $("plDelete").onclick = deletePlaceEd;
    $("plClose").onclick = function () { $("placeModal").classList.remove("open"); };
    $("placeModal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });
    $("plHere").onclick = function () {
      if (!navigator.geolocation) { toast("No location support on this device."); return; }
      $("plGeoHint").textContent = "Getting your location\u2026";
      navigator.geolocation.getCurrentPosition(function (pos) {
        localStorage.setItem(GEO_KEY, "1");
        $("plCoords").value = pos.coords.latitude.toFixed(5) + ", " + pos.coords.longitude.toFixed(5);
        $("plGeoHint").textContent = "Saved \u2014 the list will surface when you're within ~700 m of here.";
      }, function () { $("plGeoHint").textContent = "Couldn't get a fix \u2014 allow location access and try again."; }, { timeout: 8000 });
    };
    var gb = $("geoBtn"); if (gb) gb.onclick = function () { geoCheck(true); };
    geoCheck(false);   // silent check on open if the user opted in before
    document.addEventListener("visibilitychange", function () { if (!document.hidden) geoCheck(false); });
    /* minute tick: lets check-in nudges + ASAP states appear without a reload */
    setInterval(function () { renderTodayScreen(); }, 60000);
    var pad = $("plAskDays");
    if (pad) pad.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hday]"); if (!b) return;
      var d = +b.getAttribute("data-hday");
      plAskSel = plAskSel === d ? null : d;
      Array.prototype.forEach.call(pad.children, function (x) { x.classList.toggle("on", plAskSel === +x.getAttribute("data-hday")); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeRoutineEd();
        ["schedModal", "taskModal", "hoursModal", "placeModal"].forEach(function (id) { var m = $(id); if (m) m.classList.remove("open"); });
      }
    });

    /* home-screen actions (separate namespace from the board's data-act) */
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-hact]"); if (!el) return;
      var a = el.getAttribute("data-hact"), k = el.getAttribute("data-hkey");
      if (a === "day") { hSel = k; renderCalScreen(); return; }
      if (a === "ttoggle") { patch(k, { targetDone: !targetDone(k) }); renderPulse(); renderFive(); renderTodayScreen(); return; }
      if (a === "stoggle") { patch(k, { done: !(entries[k] && entries[k].done) }); renderTodayScreen(); renderCalScreen(); return; }
      if (a === "sub2") {
        var sid2h = el.getAttribute("data-hsid");
        patch(k, { subtasks: normSubs(subs(k)).map(function (x) { return x.id === sid2h ? Object.assign({}, x, { done: !x.done, u: Date.now() }) : x; }) });
        renderTodayScreen(); renderCols(); return;
      }
      if (a === "tray") { trayOpen = !trayOpen; renderTodayScreen(); return; }
      if (a === "sdel") { delete entries[k]; save(); cloudDeleteEntry(k); renderTodayScreen(); renderCalScreen(); toast("Removed from that day."); return; }
      if (a === "spick") {
        var sk = "sched:" + hSel + ":" + k;
        if (entries[sk]) { toast("Already scheduled that day."); return; }
        patch(sk, { done: false });
        renderSchedSheet(); renderCalScreen(); renderTodayScreen();
        toast("Scheduled for " + hFmt(hSel) + ".");
        return;
      }
      if (a === "rtoggle") { toggleRoutine(k); return; }
      if (a === "rtoggle2") { toggleRoutine(k); return; }
      if (a === "plitem") {
        var pk = "place:" + k, pst = getEntry(pk), dnm = Object.assign({}, pst.done || {});
        var pid = el.getAttribute("data-hsid");
        if (dnm[pid]) delete dnm[pid]; else dnm[pid] = true;
        patch(pk, { done: dnm });
        renderPlaces(); renderTodayScreen(); return;
      }
      if (a === "plplan") {
        var pk2 = "place:" + k, pst2 = getEntry(pk2), tt = hTodayIso();
        patch(pk2, { plan: pst2.plan === tt ? null : tt });
        renderPlaces(); renderTodayScreen(); return;
      }
      if (a === "plreset") { patch("place:" + k, { done: {} }); renderPlaces(); renderTodayScreen(); return; }
      if (a === "plyes") { patch("place:" + k, { plan: hTodayIso(), askedDate: hTodayIso() }); renderPlaces(); renderTodayScreen(); return; }
      if (a === "plno") { patch("place:" + k, { askedDate: hTodayIso() }); renderTodayScreen(); return; }
      if (a === "pledit") { openPlaceEd(k); return; }
      if (a === "redit") { openRoutineEd(k); return; }
    });

    /* live weather + train cards */
    renderFeeds();
    setInterval(function () { if (document.visibilityState === "visible") renderFeeds(); }, 120000);
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    wireDisclosure("appsBacklogHead", "appsBacklogWrap");
    wireDisclosure("studyBacklogHead", "studyBacklogWrap");
    wireDisclosure("officeBacklogHead", "officeBacklogWrap");
    $("btnPrint").onclick = function () { window.print(); };
    $("addAppBtn").onclick = function () { openAdd("app"); };
    $("addStudyBtn").onclick = function () { openAdd("study"); };
    var aob = $("addOfficeBtn"); if (aob) aob.onclick = function () { openAdd("office"); };
    var asb = $("addSpecialBtn"); if (asb) asb.onclick = function () { openAdd("app"); $("addTitle").textContent = "Add special list"; $("addGroup").value = "Special"; };
    var smb = $("specialModeBtn");
    function applySpecialMode(on) { document.body.classList.toggle("special-mode", !!on); if (smb) smb.textContent = on ? "Exit focus" : "Focus"; if (on) { var ss = $("specialSec"); if (ss) ss.classList.remove("collapsed"); } renderSpecial(); }
    if (smb) {
      smb.onclick = function () {
        var on = !document.body.classList.contains("special-mode");
        try { localStorage.setItem("wf2_special_mode", on ? "1" : ""); } catch (e) {}
        applySpecialMode(on);
      };
      try { if (localStorage.getItem("wf2_special_mode") === "1") applySpecialMode(true); } catch (e) {}
    }
    wireSpecialDrag();
    wireTimeline();
    wireViewToggle();
    var shb = $("specialHideBtn");
    if (shb) {
      shb.onclick = function () {
        var ss = $("specialSec"), c = !ss.classList.contains("collapsed");
        try { localStorage.setItem("wf2_special_collapsed", c ? "1" : ""); } catch (e) {}
        ss.classList.toggle("collapsed", c);
      };
      try { if (localStorage.getItem("wf2_special_collapsed") === "1") $("specialSec").classList.add("collapsed"); } catch (e) {}
    }
    $("addSave").onclick = commitAdd;
    $("addClose").onclick = closeAdd;
    $("addModal").addEventListener("click", function (e) { if (e.target === this) closeAdd(); });
    $("pickClose").onclick = closePicker;
    $("pickModal").addEventListener("click", function (e) { if (e.target === this) closePicker(); });
    wireCloud();
    wireBoards();
    updateBoardUI();
    wireDragDrop();

    refreshGroupLists();
    ENTER = true;
    renderAll();           // renders empty until your Supabase data arrives
    if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) {} }
    wireHome();            // Today / Calendar / Routines tabs + mode toggle (build 16)
    if (window.__WF_SEED) { // preview/demo hook \u2014 never defined in the deployed app
      try {
        var SD = window.__WF_SEED;
        state.apps = SD.apps || []; state.study = SD.study || []; state.office = SD.office || [];
        rebuildIndex(); entries = SD.entries || {}; targetOrder = SD.targets || []; meta = SD.meta || {};
        ENTER = true; refreshGroupLists(); renderAll();
      } catch (e) {}
    } else {
      startCloud();        // connects with the baked-in config, then loads your week once signed in
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
