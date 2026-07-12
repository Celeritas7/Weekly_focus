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
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>'
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
  var state = { apps: [], study: [] };
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

  function load(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }
  function loadArr(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
  /* Data is never written to localStorage — it lives in Supabase. save() is a no-op;
     every mutation is pushed to the database through the cloudPush* helpers below. */
  function save() {}
  function getEntry(k) { return entries[k] || {}; }
  function patch(k, p) { entries[k] = Object.assign({}, entries[k], p); save(); cloudPushEntry(k, entries[k]); }

  /* ---------------- inventory (in-app, Supabase-backed) ---------------- */
  function rebuildIndex() { itemIndex = {}; state.apps.forEach(function (a) { itemIndex[a.id] = a; }); state.study.forEach(function (s) { itemIndex[s.id] = s; }); }
  function itemById(id) { return itemIndex[id] || null; }
  function kindOf(id) { return id.indexOf("study:") === 0 ? "study" : "app"; }
  function arrFor(kind) { return kind === "study" ? state.study : state.apps; }

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
      return { id: s.id || subLegacyId(s.t), t: s.t || "", done: !!s.done, u: s.u || 0, del: !!s.del };
    }).filter(Boolean);
  }
  function mergeSubs(a, b) {
    var by = {}, order = [];
    function take(s) {
      var ex = by[s.id];
      if (!ex) { by[s.id] = s; order.push(s.id); return; }
      if ((s.u || 0) > (ex.u || 0)) by[s.id] = s;
      else if ((s.u || 0) === (ex.u || 0)) by[s.id] = { id: ex.id, t: ex.t || s.t, done: ex.done || s.done, u: ex.u, del: ex.del || s.del };
    }
    normSubs(a).forEach(take); normSubs(b).forEach(take);
    return order.map(function (id) { return by[id]; });
  }
  function visibleSubs(arr) { return normSubs(arr).filter(function (s) { return !s.del; }); }
  function subsKey(arr) { return JSON.stringify(normSubs(arr).map(function (s) { return [s.id, s.t, s.done ? 1 : 0, s.del ? 1 : 0, s.u || 0]; }).sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; })); }
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
    pruneTargets(); renderPulse(); renderFive(); renderColumn("app"); renderColumn("study"); renderMeta();
    if (ENTER) { ENTER = false; setTimeout(function () { var ns = document.querySelectorAll(".wf-enter"); for (var i = 0; i < ns.length; i++) ns[i].classList.remove("wf-enter"); }, 720); }
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

  /* ---- a column (apps or study) ---- */
  function renderColumn(kind) {
    var ids = kind === "app"
      ? { host: "appsActive", back: "appsBacklog", wrap: "appsBacklogWrap", bn: "appsBacklogN", n: "appsN", noun: "app" }
      : { host: "studyActive", back: "studyBacklog", wrap: "studyBacklogWrap", bn: "studyBacklogN", n: "studyN", noun: "topic" };
    var host = $(ids.host), back = $(ids.back);
    host.innerHTML = ""; back.innerHTML = "";
    if (ENTER) host.classList.add("wf-enter");
    var arr = arrFor(kind), active = activeItems(kind), backlog = backlogItems(kind);
    $(ids.n).textContent = active.length;

    if (!arr.length) host.innerHTML = emptyZone("No " + ids.noun + "s yet. Tap <b>+ Add " + ids.noun + "</b> below to create your first one." + (cloudConfigured() ? "" : "<br><span class='ez-dim'>Connect <b>Cloud</b> to sync across your devices.</span>"));
    else if (!active.length) host.innerHTML = emptyZone("Nothing active. Switch a " + ids.noun + " on from the backlog, or add a new one.");
    else groupItems(active, kind, true).forEach(function (g) {
      host.appendChild(catHead(kind, g.group, g.items.length));
      g.items.forEach(function (it) { host.appendChild(itemCard(it.id)); });
    });

    $(ids.wrap).style.display = backlog.length ? "" : "none";
    $(ids.bn).textContent = backlog.length;
    if (backlog.length) groupItems(backlog, kind, false).forEach(function (g) {
      back.appendChild(catHead(kind, g.group, g.items.length));
      var ul = document.createElement("ul"); ul.className = "brows";
      g.items.forEach(function (it) {
        var li = document.createElement("li"); li.className = "brow"; li.setAttribute("data-key", it.id); li.setAttribute("draggable", "true");
        li.innerHTML = '<button class="tgl tgl-sm" data-act="on" title="Bring into This Week"><span class="knob"></span></button>' +
          '<span class="bname">' + esc(it.name) + '</span>' +
          '<button class="brow-del" data-act="del" title="Delete forever">' + IC.trash + '</button>';
        ul.appendChild(li);
      });
      back.appendChild(ul);
    });
  }
  function groupItems(arr, kind, sortPri) {
    var groups = [];
    if (kind === "app") groups = APP_CATS.slice();
    arr.forEach(function (a) { if (groups.indexOf(a.group) < 0) groups.push(a.group); });
    if (kind === "study") groups.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return groups.map(function (gr) {
      var items = arr.filter(function (a) { return a.group === gr; });
      items.sort(sortPri
        ? function (a, b) {
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
    var it = itemById(id);
    li.innerHTML =
      '<div class="item-row">' +
        '<div class="item-grip" data-act="open">' +
          '<div class="iwrap-name"><div class="iname">' + esc(it ? it.name : id) + '</div></div>' +
        '</div>' +
        '<div class="item-actions">' + ring +
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
        '<button class="sub-del sub-delete-btn" data-act="subdel" title="Delete">\u00d7</button></li>';
    }).join("");
    var priCtl = '<div class="pri-row"><span class="pri-lbl">Priority</span>' +
      '<div class="pri-seg">' + ["H", "M", "L"].map(function (p) {
        return '<button class="pseg pseg-' + p + (p === pri ? " on" : "") + '" data-pri="' + p + '">' + priName(p) + '</button>';
      }).join("") + '</div></div>';
    var listId = "grp-" + kindOf(id);
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
      manage +
    '</div>';
  }

  function refreshGroupLists() {
    [["grp-app", "app"], ["grp-study", "study"]].forEach(function (pair) {
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
    activeItems("app").forEach(function (a) { rows.push({ key: a.id, name: a.name, crumb: a.group, tag: "App", color: catColor(a.group) }); });
    activeItems("study").forEach(function (s) { rows.push({ key: s.id, name: s.name, crumb: s.group, tag: "Study", color: "oklch(0.55 0.13 " + hueFor(s.group) + ")" }); });
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
    $("addTitle").textContent = kind === "app" ? "Add app" : "Add topic";
    $("addName").value = ""; $("addGroup").value = "";
    $("addName").setAttribute("placeholder", kind === "app" ? "e.g. LedgerLite" : "e.g. Kanji");
    $("addGroup").setAttribute("placeholder", kind === "app" ? "Category (e.g. General Purpose)" : "Subject (e.g. Japanese)");
    $("addGroup").setAttribute("list", "grp-" + kind);
    $("addModal").classList.add("open");
    setTimeout(function () { $("addName").focus(); }, 30);
  }
  function closeAdd() { $("addModal").classList.remove("open"); }
  function commitAdd() {
    var name = $("addName").value.trim(); if (!name) { $("addName").focus(); return; }
    addItem(addKind, name, $("addGroup").value);
    toast((addKind === "app" ? "App" : "Topic") + " added \u2014 it\u2019s active this week.");
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
    if (seg) { patch(keyOf(seg), { pri: seg.getAttribute("data-pri") }); renderColumn("app"); renderColumn("study"); return; }
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
    if (a === "open") { detailOpen[key] = !detailOpen[key]; OPENING = detailOpen[key] ? key : null; renderColumn("app"); renderColumn("study"); OPENING = null; return; }
    if (a === "off") { patch(key, { active: false }); removeTarget(key); detailOpen[key] = false; renderAll(); return; }
    if (a === "on") { patch(key, { active: true }); renderAll(); return; }
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
      renderColumn("app"); renderColumn("study"); renderPulse(); renderFive(); return;
    }
    if (a === "subdel") {
      var sid2 = e.target.closest("[data-sid]").getAttribute("data-sid");
      var subs_norm = normSubs(subs(key));   // backfill ids
      patch(key, { subtasks: subs_norm.map(function (x) { return x.id === sid2 ? Object.assign({}, x, { del: true, u: Date.now() }) : x; }) }); renderColumn("app"); renderColumn("study"); renderPulse(); renderFive(); return;
    }
    if (a === "subedit-start") { startSubEdit(act, key); return; }
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
    renderColumn("app"); renderColumn("study"); renderPulse(); renderFive();
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
      renderColumn("app"); renderColumn("study");
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
  function cloudPushBoard() { cloudPushEntry(BOARD_ITEM, { targetOrder: targetOrder, meta: meta }); }
  function cloudPushInv() {
    if (!cloudConfigured()) return;
    queue("inv", { table: "weekly_focus_inventory", onConflict: "user_id,board_id", row: { board_id: cloud.board, apps: state.apps, study: state.study, updated_at: invTs || nowISO() } });
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
      if (map[BOARD_ITEM]) { var b = map[BOARD_ITEM]; delete map[BOARD_ITEM]; if (Array.isArray(b.targetOrder)) targetOrder = b.targetOrder; if (b.meta) meta = b.meta; }
      Object.keys(map).forEach(function (k) {                     // union-merge subtasks: remote ∪ local-current
        if (k === BOARD_ITEM) return;
        var remoteSubs = remoteSubsBy[k] || [];
        var merged = mergeSubs(remoteSubs, normSubs((entries[k] || {}).subtasks));
        map[k] = Object.assign({}, map[k], { subtasks: merged });
        if (subsDiffer(remoteSubs, merged)) cloudPushEntry(k, map[k]);   // converge server; gate prevents push storms
      });
      entries = map; save(); ENTER = true; renderAll(); updateCloudStatus();
    } catch (e) { updateCloudStatus(); }
  }
  async function cloudPullInventory(force) {
    if (!syncReady()) return false;
    try {
      var r = await sb.from("weekly_focus_inventory").select("apps,study,updated_at").eq("board_id", cloud.board).limit(1);
      if (r.error) throw r.error;
      var rows = r.data || []; if (!rows.length) return false;
      var remoteTs = rows[0].updated_at || "";
      var hasInvPending = !!outbox["inv"];
      if (force || (!hasInvPending && (!invTs || remoteTs > invTs))) {
        setInventory(rows[0].apps, rows[0].study, false);
        invTs = remoteTs || nowISO();
        ENTER = true; renderAll(); refreshGroupLists();
      }
      return true;
    } catch (e) { return false; }
  }
  function initialSync() {
    // CLOUD-FIRST: a fresh device adopts the cloud copy; a device with local
    // data keeps it and seeds the cloud only if the board is empty.
    var fresh = !state.apps.length && !state.study.length;
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
    var inGroup = activeItems(kind).filter(function (x) { return x.group === grp; });
    inGroup.sort(function (a, b) {
      var oa = ordOf(a.id), ob = ordOf(b.id);
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1; if (ob != null) return 1;
      return (priRankOf(a.id) - priRankOf(b.id)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    var ids = inGroup.map(function (x) { return x.id; });
    var from = ids.indexOf(dragId); if (from >= 0) ids.splice(from, 1);
    var at = ids.length;
    if (beforeId && itemById(beforeId) && itemById(beforeId).group === grp) { var bi = ids.indexOf(beforeId); if (bi >= 0) at = bi; }
    ids.splice(at, 0, dragId);
    ids.forEach(function (id, i) { entries[id] = Object.assign({}, entries[id], { ord: i }); cloudPushEntry(id, entries[id]); });
    save();
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
      if (wasItem) { renderColumn("app"); renderColumn("study"); }
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
    state = { apps: [], study: [] }; itemIndex = {}; rebuildIndex();
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
     INIT
     ============================================================ */
  function init() {
    wireDisclosure("appsBacklogHead", "appsBacklogWrap");
    wireDisclosure("studyBacklogHead", "studyBacklogWrap");
    $("btnPrint").onclick = function () { window.print(); };
    $("addAppBtn").onclick = function () { openAdd("app"); };
    $("addStudyBtn").onclick = function () { openAdd("study"); };
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
    startCloud();          // connects with the baked-in config, then loads your week once signed in
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
