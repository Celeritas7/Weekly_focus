/* ============================================================
   Weekly Focus v107 — Sphere Draft
   The Sphere screen. Mounted by weekly-focus-app.js, which
   passes SD_HOST: the only moves this
   file can make (add / place / orbit / back / restore). This file
   draws and animates; it never touches data directly.
   ============================================================ */
(function () {
  "use strict";
  var H = null, root = null, isOpen = false, hist = [], kindF = "all", sortBy = "pri", q = "", GROUP = true, GRP = "goal", TAPO = false, TAPN = false, lastFull = false, io = null;
  var BY = {}, ROWS = [];
  var PREF = "wf_sd_prefs";
  try { var pf = JSON.parse(localStorage.getItem(PREF) || "{}"); if (pf.group === false) GROUP = false; if (pf.grp === "goal" || pf.grp === "cat" || pf.grp === "none") GRP = pf.grp; else if (pf.grp === "purpose") GRP = "goal"; else if (pf.group === false) GRP = "none"; GROUP = GRP !== "none"; if (pf.sort) sortBy = pf.sort; if (pf.tapo === true) TAPO = true; if (pf.tapn === true && !TAPO) TAPN = true; } catch (e) {}
  function savePref() { try { localStorage.setItem(PREF, JSON.stringify({ group: GROUP, grp: GRP, sort: sortBy, tapo: TAPO, tapn: TAPN })); } catch (e) {} }

  var KIND = { app: { l: "App", c: "var(--brand)" }, study: { l: "Study", c: "var(--study)" }, office: { l: "Office", c: "var(--office, oklch(0.55 0.13 70))" } };
  var PRI = { high: { l: "High", c: "var(--pri-h)", w: 3 }, medium: { l: "Medium", c: "var(--pri-m)", w: 2 }, low: { l: "Low", c: "var(--pri-l)", w: 1 }, "": { l: "", c: "transparent", w: 0 } };
  var CAT = { "General Purpose": "var(--cat-gp)", "Mechanical": "var(--cat-mech)", "Language Study": "var(--cat-lang)" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mono(name) { var w = String(name).replace(/[_\-]+/g, " ").split(/\s+/).filter(Boolean); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "").slice(1, 2))).toUpperCase(); }
  function hue(g) { var h = 0; for (var i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) % 360; return h; }
  function catCol(g) { return CAT[g] || "oklch(0.62 0.13 " + hue(g) + ")"; }
  function score(it) { return PRI[it.pri].w * 100 + Math.min(it.total - it.done, 9) * 3 - Math.min(it.age == null ? 30 : it.age, 30) * 0.1; }
  function ageTxt(d) { return d == null ? "no activity yet" : d === 0 ? "today" : d === 1 ? "1 day ago" : d + " days ago"; }
  /* a long single word shrinks to fit its circle instead of breaking mid-word */
  function fit(t) { var n = Math.max.apply(null, String(t).split(/[\s_\-]+/).map(function (w) { return w.length; })); return n > 11 ? " sd-fit2" : n > 8 ? " sd-fit1" : ""; }
  /* v117: a name inside a circle. It may wrap after _ or -; alt = only shown if the logo fails to load */
  function nameSpan(nm, alt) { return '<span class="sd-face-name' + fit(nm) + (alt ? " sd-alt" : "") + '">' + esc(nm).replace(/([_\-])/g, "$1<wbr>") + '</span>'; }
  /* v117: shrink any name still wider than its circle (measured, so it never spills out of the edge) */
  function shrinkNames() {
    if (!root) return;
    root.querySelectorAll(".sd-bub-c .sd-face-name, .sd-slot .sd-face-name").forEach(function (el) {
      if (!el.offsetParent) return;
      el.style.fontSize = ""; el.style.overflowWrap = "normal";   // measure whole words; break mid-word only if shrinking is not enough
      var fs = parseFloat(getComputedStyle(el).fontSize) || 10, n = 0;
      while (el.scrollWidth > el.clientWidth + 1 && fs > 7 && n++ < 10) { fs -= 0.5; el.style.fontSize = fs + "px"; }
      if (el.scrollWidth > el.clientWidth + 1) el.style.overflowWrap = "anywhere";
    });
  }
  function short(name) { var w = String(name).replace(/[_\-]+/g, " ").trim().split(/\s+/)[0] || ""; return w.length > 8 ? w.slice(0, 7) + "…" : w; }
  /* v109: what sits inside a planet. Logo → the image (name kept as a hidden fallback if it fails to load); emoji; else the name itself */
  function face(it, mode) {
    var L = it.logo, nm = mode === "planet" ? it.name : mode === "moon" ? short(it.name) : mono(it.name);
    var txt = nameSpan(nm, false);
    if (L && L.url) return '<img class="sd-face-img" src="' + esc(L.url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' + nameSpan(nm, true);
    if (L && L.emoji) return '<span class="sd-face-emo">' + esc(L.emoji) + '</span>';
    return txt;
  }
  function sel(k) { return window.CSS && CSS.escape ? CSS.escape(k) : String(k).replace(/"/g, '\\"'); }

  var ST = { five: [], orbit: [] };
  function pull() { ROWS = H.rows(); BY = {}; ROWS.forEach(function (r) { BY[r.id] = r; }); var s = H.state(); ST = { five: s.five.filter(function (k) { return BY[k]; }), orbit: s.orbit.filter(function (k) { return BY[k]; }) }; }
  function where(k) { var i = ST.five.indexOf(k); if (i >= 0) return { five: i }; return ST.orbit.indexOf(k) >= 0 ? { orbit: true } : null; }

  /* ---------------- DOM ---------------- */
  function build(container) {
    root = document.createElement("div"); root.className = "sd"; root.id = "sphereDraft"; root.hidden = true;
    root.innerHTML =
      '<div class="sd-hud" id="sdHud" hidden><button type="button" class="sd-hud-go" id="sdHudGo" aria-label="Back to your sphere"><span class="sd-dots" id="sdHudDots"></span><span class="sd-o" id="sdHudO"></span></button></div>' +
      '<div class="sd-wrap">' +
        '<header class="sd-top"><div><div class="sd-eyebrow">This week</div><h2>Sphere</h2>' +
          '<p class="sd-sub">Every active app, study topic and office task is on the table. Pull in only what earns a place this week.</p></div>' +
          '<div class="sd-right"><span class="sd-tally">The Five <b id="sdT5">0/5</b></span><span class="sd-tally">Orbit <b id="sdTO">0</b></span><span class="sd-tally">On the table <b id="sdTP">0</b></span></div></header>' +
        '<div class="sd-stage">' +
          '<section class="sd-orrery" aria-label="Your sphere">' +
            '<div class="sd-sphere" id="sdSphere"><div class="sd-orbit" data-sddrop="orbit"></div><div class="sd-disc" data-sddrop="center"></div>' +
              '<div class="sd-core"><div class="sd-n" id="sdCoreN">0<small>/5</small></div><div class="sd-l" id="sdCoreL">targets set</div></div>' +
              '<button type="button" class="sd-coremoon" id="sdCoreMoon" data-sd="core" hidden></button><canvas id="sdFx" aria-hidden="true"></canvas></div>' +
            '<div class="sd-load"><div class="sd-load-h"><span class="sd-t">Week load</span><span class="sd-v" id="sdLoadV">Light</span></div><div class="sd-segs" id="sdSegs" aria-hidden="true"></div><div class="sd-chips" id="sdChips"></div></div>' +
            '<div class="sd-actions"><button class="sd-btn sd-primary" id="sdAuto" type="button">Auto-fill the Five</button><button class="sd-btn" id="sdUndo" type="button" disabled>Undo</button><button class="sd-btn sd-rvgo" id="sdRvGo" type="button" data-sd="rvopen">Review one by one</button><button class="sd-btn sd-dbgo" id="sdDbGo" type="button" data-sd="dbopen">\u2605 Debate the Five</button></div>' +
          '</section>' +
          '<section class="sd-pool" id="sdPool" data-sddrop="pool" aria-label="Everything still on the table">' +
            '<div class="sd-bar"><div class="sd-seg" id="sdSeg" role="group" aria-label="Show"><button type="button" data-kind="all"></button><button type="button" data-kind="app"></button><button type="button" data-kind="study"></button><button type="button" data-kind="office"></button></div>' +
              '<button type="button" class="sd-tapo" id="sdTapO" aria-pressed="false" title="When on, tapping a bubble sends it straight to orbit">Tap \u2192 Orbit</button>' +
              '<button type="button" class="sd-tapo sd-tapn" id="sdTapN" aria-pressed="false" title="When on, tapping a bubble stars it as a nominee for the Five (tap again to remove)">Tap \u2192 \u2605</button>' +
              '<button type="button" class="sd-more" id="sdMore" aria-expanded="false" aria-controls="sdTools" aria-label="Search, group and sort"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg><i class="sd-more-dot" aria-hidden="true"></i></button>' +
              '<div class="sd-tools" id="sdTools"><input id="sdQ" type="search" placeholder="Find…" autocomplete="off" aria-label="Find"><select id="sdGrp" aria-label="Group the table"><option value="goal">By goal</option><option value="cat">By category</option><option value="none">No groups</option></select>' +
              '<select id="sdSort" aria-label="Sort"><option value="pri">Priority first</option><option value="open">Most open tasks</option><option value="stale">Longest untouched</option><option value="az">A–Z</option></select></div></div>' +
            '<div class="sd-legend" aria-hidden="true"><span><i style="--pc:var(--pri-h)"></i>High</span><span><i style="--pc:var(--pri-m)"></i>Medium</span><span><i style="--pc:var(--pri-l)"></i>Low</span><span class="sd-legend-tip">Tap a bubble for details</span></div>' +
            '<div class="sd-grid" id="sdGrid"></div>' +
          '</section>' +
        '</div>' +
        '<details class="sd-howto"><summary>How to play</summary><p>Tap a bubble for details. On a goal, use <b>+ New app</b> to create and link an app or <b>Link existing</b> to pick one you already have. You can also drag a bubble onto a goal. <b>Review one by one</b> shows every app outside The Five as a card: swipe right for orbit, left for not. Switch on <b>Tap → Orbit</b> to send each bubble you tap straight to orbit, or press <b>All to orbit</b> on a category. The ring colour is its priority. Drag a bubble onto a number to rank it, or onto the dashed ring for orbit; on a phone, press and hold to drag. Tap a planet to see it or send it back. Keys on a focused bubble: <kbd>Enter</kbd> details, <kbd>1</kbd>–<kbd>5</kbd> rank, <kbd>O</kbd> orbit.</p></details>' +
      '</div>' +
      '<div class="sd-info" id="sdInfo" data-sd="infoclose" hidden><div class="sd-info-card" id="sdInfoCard" data-sd="stay" role="dialog" aria-modal="true" aria-labelledby="sdInfoT"></div></div>' +
      '<div class="sd-rv" id="sdRv" role="dialog" aria-modal="true" aria-label="Review: orbit or not" hidden><div class="sd-rv-in" id="sdRvIn"></div></div>' +
      '<div class="sd-toast" id="sdToast" role="status" hidden></div>';
    container.appendChild(root);
    wire();
  }

  /* ---------------- render ---------------- */
  function pos(el, deg, r) { var a = deg * Math.PI / 180; el.style.left = (50 + r * Math.sin(a)) + "%"; el.style.top = (50 - r * Math.cos(a)) + "%"; }
  function renderSphere(landing) {
    var sp = $("sdSphere"), MAX = H.max;
    sp.querySelectorAll(".sd-slot,.sd-moon").forEach(function (n) { n.remove(); });
    for (var i = 0; i < MAX; i++) {
      var k = ST.five[i], it = k && BY[k], el = document.createElement(it ? "button" : "div");
      el.className = "sd-slot " + (it ? "sd-full" : "sd-empty") + (it && landing === k ? " sd-landed" : "");
      el.setAttribute("data-sddrop", "slot"); el.setAttribute("data-i", i); pos(el, i * 360 / MAX, 34);
      if (it) {
        el.type = "button"; el.setAttribute("data-sdk", k); el.setAttribute("data-sd", "info"); el.style.setProperty("--kc", KIND[it.kind].c);
        el.setAttribute("aria-label", "Target " + (i + 1) + ": " + it.name + ". Show details");
        el.title = it.name; el.innerHTML = '<span class="sd-rk">' + (i + 1) + '</span>' + face(it, "planet");
      } else { el.setAttribute("aria-label", "Empty target slot " + (i + 1)); el.textContent = i + 1; }
      sp.appendChild(el);
    }
    var n = ST.orbit.length, gaps = [36, 108, 180, 252, 324];
    ST.orbit.forEach(function (k, j) {
      var it = BY[k], m = document.createElement("button");
      m.type = "button"; m.className = "sd-moon" + (landing === k ? " sd-landed" : "");
      m.setAttribute("data-sdk", k); m.setAttribute("data-sd", "info"); m.setAttribute("data-sddrop", "orbit");
      m.style.setProperty("--kc", KIND[it.kind].c); m.setAttribute("aria-label", "In orbit: " + it.name + ". Show details"); m.title = it.name;
      m.innerHTML = face(it, "moon") + (it.nom ? '<span class="sd-nomb" title="Nominated for the Five" aria-hidden="true">\u2605</span>' : ''); pos(m, n <= 5 ? gaps[j] : 18 + j * 360 / n, 47);
      sp.appendChild(m);
    });
    $("sdCoreN").innerHTML = ST.five.length + "<small>/" + MAX + "</small>";
    $("sdCoreL").textContent = ST.five.length === MAX ? "Your Five are set" : "targets set";
    /* v108: Akatsuki is the core. While it has open tasks the centre becomes its red moon; otherwise the count shows */
    /* v112: Akatsuki is always the centre. Bright red while it has open tasks; dimmed ("All clear") when it has none */
    var c = H.core ? H.core() : null, cm = $("sdCoreMoon"), on = !!c, dim = on && !c.open;
    sp.classList.toggle("sd-has-core", on); cm.hidden = !on; cm.classList.toggle("sd-dim", dim);
    if (on) {
      cm.setAttribute("aria-label", c.name + ", core of the sphere: " + (c.open ? c.open + " open" : "all clear") + ". Open it");
      cm.innerHTML = (c.logo && c.logo.url ? '<span class="sd-cm-logo"><img src="' + esc(c.logo.url) + '" alt="" referrerpolicy="no-referrer"></span>' : c.logo && c.logo.emoji ? '<span class="sd-cm-logo sd-cm-emo">' + esc(c.logo.emoji) + '</span>' : '<span class="sd-cm-k">Core</span>') +
        '<span class="sd-cm-n">' + esc(c.name) + '</span><span class="sd-cm-o">' + (c.open ? c.open + ' open' : 'All clear') + '</span>' + (c.open && c.next ? '<span class="sd-cm-x">' + esc(c.next) + '</span>' : '');
    }
  }
  var ORBIT_CAP = 8;   // v136: was 3; the orbit regularly holds ~10 apps, so 3 kept Week load red all the time
  function renderLoad() {
    var MAX = H.max, segs = "", i, over = Math.max(0, ST.orbit.length - ORBIT_CAP), slots = Math.max(ORBIT_CAP, ST.orbit.length);
    for (i = 0; i < MAX; i++) segs += '<i class="sd-five' + (i < ST.five.length ? " sd-on" : "") + '"></i>';
    segs += '<i class="sd-gap"></i>';
    for (i = 0; i < slots; i++) segs += '<i class="sd-orb' + (i < ST.orbit.length ? (i >= ORBIT_CAP ? " sd-overcap" : " sd-on") : "") + '"></i>';
    $("sdSegs").innerHTML = segs;
    var total = ST.five.length + ST.orbit.length, v = $("sdLoadV");
    v.className = "sd-v" + (over ? " sd-heavy" : "");
    v.textContent = over ? "Heavy · " + ST.orbit.length + " in orbit, drop " + over : total === 0 ? "Empty" : ST.five.length < MAX ? "Light · room for " + (MAX - ST.five.length) + " more" : ST.orbit.length ? "Balanced · " + ST.orbit.length + " in orbit" : "Focused";
    /* v131: orbit chips sorted by category, each with its category colour */
    var p1 = function (k) { var x = (BY[k].goals || [])[0]; return x ? goalOf(x) : null; }, pn = function (k) { var q = p1(k); return q ? q.name : "\uffff"; };   // v138: by first purpose
    $("sdChips").innerHTML = ST.orbit.slice().sort(function (a, b) { return pn(a).localeCompare(pn(b)) || BY[a].name.localeCompare(BY[b].name); }).map(function (k) { var it = BY[k]; var cp = p1(k); return '<span class="sd-chip' + (it.nom ? " sd-chip-nom" : "") + '" style="--cc:' + (cp ? goalCol(cp.hue) : "var(--faint)") + '" title="' + esc(cp ? "Goal: " + cp.name : "No goal yet") + '">' +
      '<button type="button" class="sd-chip-star" data-sd="chipnom" data-sdk="' + esc(k) + '" aria-pressed="' + (it.nom ? "true" : "false") + '" aria-label="' + (it.nom ? "Remove the star from " : "Nominate ") + esc(it.name) + (it.nom ? "" : " for the Five") + '">' + (it.nom ? "\u2605" : "\u2606") + '</button>' +
      '<button type="button" class="sd-chip-nm" data-sd="info" data-sdk="' + esc(k) + '" aria-label="' + esc(it.name) + ': show details"><i aria-hidden="true"></i><span>' + esc(it.name) + '</span></button>' +
      '<button type="button" class="sd-chip-x" data-sd="back" data-sdk="' + esc(k) + '" aria-label="Send ' + esc(it.name) + ' back to the table">\u00d7</button></span>'; }).join("");
    $("sdUndo").disabled = !hist.length;
    $("sdAuto").disabled = ST.five.length >= MAX || !ROWS.some(function (r) { return !where(r.id); });
  }
  function sorted(list) {
    var f = {
      pri: function (a, b) { return score(b) - score(a) || a.name.localeCompare(b.name); },
      open: function (a, b) { return (b.total - b.done) - (a.total - a.done) || score(b) - score(a); },
      stale: function (a, b) { return (b.age == null ? 1e4 : b.age) - (a.age == null ? 1e4 : a.age) || score(b) - score(a); },
      az: function (a, b) { return a.name.localeCompare(b.name); }
    }[sortBy] || function () { return 0; };
    return list.slice().sort(f);
  }
  /* v110: the table is just bubbles: logo (or name) inside, priority as the ring colour. Tap one for its details. */
  function cardHtml(it) {
    var p = PRI[it.pri] || PRI[""], L = it.logo, nameIn = nameSpan(it.name, false);
    var inner = L && L.url ? '<img class="sd-bub-img" src="' + esc(L.url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' + nameSpan(it.name, true)
      : L && L.emoji ? '<span class="sd-bub-emo">' + esc(L.emoji) + '</span>' : nameIn;
    return '<button type="button" class="sd-bub" data-sdk="' + esc(it.id) + '" data-sd="info" style="--kc:' + KIND[it.kind].c + ';--pc:' + (p.l ? p.c : "var(--hair)") + '" title="' + esc(it.name) + '" aria-label="' + esc(it.name) + (p.l ? ", " + p.l + " priority" : "") + (it.nom ? ", nominated for the Five" : "") + (TAPO ? '. Send to orbit">' : TAPN ? (it.nom ? '. Remove the star">' : '. Nominate for the Five">') : '. Show details">') +
      '<span class="sd-bub-c">' + inner + '</span>' + (it.nom ? '<span class="sd-nomb" title="Nominated for the Five" aria-hidden="true">\u2605</span>' : '') + (L ? '<span class="sd-bub-l">' + esc(it.name) + '</span>' : '') + '</button>';
  }
  /* v139: the table BY GOAL. A goal is what apps are built for ("Pass JLPT N2"). Each goal is a section; an app serving
     several goals appears in each; apps with no goal are last. Goals are tagged in the details window and on review cards. */
  function goals() { return H.goalList ? H.goalList() : []; }
  function goalCol(h) { return "oklch(0.58 0.14 " + (h == null ? 283 : h) + ")"; }
  function goalOf(id) { var gs = goals(); for (var i = 0; i < gs.length; i++) if (gs[i].id === id) return gs[i]; return null; }
  /* v140: an app already in the Five or in orbit is shown in its goal sections too, marked #N / orbit (tap = details) */
  function sphCard(it) {
    var w = where(it.id); if (!w) return cardHtml(it);
    return cardHtml(it).replace('class="sd-bub"', 'class="sd-bub sd-insph"').replace('<span class="sd-bub-c">', '<span class="sd-inb' + (w.orbit ? '' : ' sd-inb5') + '">' + (w.orbit ? 'orbit' : '#' + (w.five + 1)) + '</span><span class="sd-bub-c">');
  }
  /* v146: links on a goal (Claude chats, Claude Code sessions, web pages): tiles under the goal's apps, tap opens */
  var LK = { chat: { i: "\ud83d\udcac", l: "Chat" }, code: { i: "</>", l: "Code" }, web: { i: "\ud83d\udd17", l: "Link" } };
  function linkTile(l) { var K = LK[l.kind] || LK.web;
    return '<a class="sd-glink sd-gl-' + esc(l.kind in LK ? l.kind : "web") + (l.off ? ' sd-off' : '') + '" href="' + esc(l.url) + '" target="_blank" rel="noopener" title="' + esc(l.t + " \u2014 " + l.url) + '"><span class="sd-gl-i" aria-hidden="true">' + esc(K.i) + '</span><span class="sd-gl-t">' + esc(l.t) + '</span><small>' + K.l + '</small></a>'; }
  function linksHtml(g) { var ls = g.links || []; ls = ls.filter(function (l) { return !l.off; }).concat(ls.filter(function (l) { return l.off; })); return ls.length ? '<div class="sd-glinks" aria-label="Links for ' + esc(g.name) + '">' + ls.map(linkTile).join("") + '</div>' : ''; }
  function goalHtml(list) {
    var gs = goals(), out = [], placed = {};
    var sph = sorted(ROWS.filter(function (r) { return where(r.id) && (kindF === "all" || r.kind === kindF) && (!q || (r.name + " " + r.group).toLowerCase().indexOf(q) >= 0); }));
    gs.forEach(function (gg) {
      var inS = sph.filter(function (r) { return (r.goals || []).indexOf(gg.id) >= 0; }).sort(function (a, b) { var wa = where(a.id), wb = where(b.id); return (wa.orbit ? 9 : wa.five) - (wb.orbit ? 9 : wb.five); });
      var its = list.filter(function (r) { return (r.goals || []).indexOf(gg.id) >= 0; });
      its.forEach(function (r) { placed[r.id] = 1; });
      var lead = gg.lead, isL = function (r) { return r.id === lead; }, rk = function (r) { return isL(r) ? 0 : r.gdim ? 2 : 1; }, lf = function (a, b) { return rk(a) - rk(b); };   // v150: lead, then active, then inactive   // v149: the goal's lead app comes first, badged
      inS.sort(lf); its = its.slice().sort(lf);
      var mk = function (h, r) { if (r.gdim && !isL(r)) h = h.replace('class="sd-bub', 'class="sd-bub sd-dim').replace('aria-label="', 'aria-label="Inactive: '); return isL(r) ? h.replace('class="sd-bub', 'class="sd-bub sd-lead').replace('<span class="sd-bub-c">', '<span class="sd-leadb" title="Lead app for ' + esc(gg.name) + '">Lead</span><span class="sd-bub-c">') : h; };
      if (!its.length && !inS.length && (q || kindF !== "all")) return;   // filtered out: hide the empty section
      out.push('<section class="sd-cat sd-pur" data-sddrop="goal" data-goal="' + esc(gg.id) + '" style="--cc:' + goalCol(gg.hue) + '" aria-label="' + esc(gg.name) + '"><h3 class="sd-cat-h"><i></i>' + esc(gg.name) + ' <span title="' + (its.length + inS.length) + ' apps' + (inS.length ? ', ' + inS.length + ' in the sphere' : '') + '">' + (its.length + inS.length) + '</span>' +
        '<button type="button" class="sd-pgoal sd-has" data-sd="gedit" data-goal="' + esc(gg.id) + '" aria-label="Rename or delete the goal ' + esc(gg.name) + '">\u270e</button>' +
        (its.length ? '<button type="button" class="sd-catorb" data-sd="catorb" data-goal="' + esc(gg.id) + '" aria-label="Send all ' + its.length + ' serving ' + esc(gg.name) + ' to orbit" title="Send the table apps of this goal to orbit">Orbit all</button>' : '') + '</h3>' +
        '<div class="sd-goal-actions">' +
        (H.appAdd ? '<button type="button" class="sd-btn sd-primary" data-sd="appnew" data-goal="' + esc(gg.id) + '" aria-label="New app for ' + esc(gg.name) + '">+ New app</button>' : '') +
        '<button type="button" class="sd-btn" data-sd="gpick" data-goal="' + esc(gg.id) + '" aria-label="Link existing apps or links to ' + esc(gg.name) + '">Link existing</button></div>' +
        (its.length || inS.length ? '<div class="sd-bubs">' + inS.map(function (r) { return { r: r, h: mk(sphCard(r), r) }; }).concat(its.map(function (r) { return { r: r, h: mk(cardHtml(r), r) }; })).sort(function (a, b) { return lf(a.r, b.r); }).map(function (x) { return x.h; }).join("") + '</div>' : (gg.links || []).length ? '' : '<p class="sd-pur-goal sd-none">No apps linked yet.</p>') + linksHtml(gg) + '</section>');
    });
    var rest = list.filter(function (r) { return !placed[r.id]; });
    if (rest.length) out.push('<section class="sd-cat sd-pur sd-nopur" style="--cc:var(--faint)" aria-label="No goal yet"><h3 class="sd-cat-h"><i></i>No goal yet <span>' + rest.length + '</span></h3>' +
      '<p class="sd-pur-goal sd-none">' + (gs.length ? "Drag a bubble onto a goal above, or use Link existing on the goal." : "Make your first goal below, then open an app and tap it under Goals.") + '</p><div class="sd-bubs">' + rest.map(cardHtml).join("") + '</div></section>');
    out.push('<button type="button" class="sd-gnew" data-sd="gnew">+ New goal</button>' + (H.appAdd ? '<button type="button" class="sd-gnew" data-sd="appnew">+ New app</button>' : ''));
    return out.join("");
  }
  /* v147: the details window shows only this app's goals and a button to the goals view (all goals, tick, + New goal) */
  var GSET = false;
  function goalSum(it) {
    var on = (it.goals || []).map(goalOf).filter(Boolean);
    return '<div class="sd-igoals"><span class="sd-igoals-k">Goals</span>' +
      (on.length ? on.map(function (gg) { var L = gg.lead === it.id;
          return '<button type="button" class="sd-gchip sd-on' + (L ? ' sd-glead' : '') + '" style="--cc:' + goalCol(gg.hue) + '" data-sd="glead" data-goal="' + esc(gg.id) + '" aria-pressed="' + (L ? "true" : "false") + '" title="' + (L ? "Lead app for this goal. Tap to clear" : "Tap to make " + esc(it.name) + " the lead app for this goal") + '">' + (L ? "\u2605 " : "") + esc(gg.name) + (L ? ' \u00b7 lead' : '') + '</button>'; }).join("") : '<span class="sd-none-txt">None yet</span>') +
      '<button type="button" class="sd-gchip sd-gadd" data-sd="gset" aria-label="' + (on.length ? "Change the goals of " : "Add a goal to ") + esc(it.name) + '">' + (on.length ? "\u270e Change" : "+ Add goal") + '</button>' +
      (H.appDim ? '<button type="button" class="sd-gchip sd-gact' + (it.gdim ? ' sd-isdim' : '') + '" data-sd="gdim" aria-pressed="' + (it.gdim ? "false" : "true") + '" title="' + (it.gdim ? 'Inactive: shown dimmed in its goals. Tap to make it active' : 'Active. Tap to mark it inactive (dimmed in its goals, still visible)') + '">' + (it.gdim ? '\u25cc Inactive' : '\u25cf Active') + '</button>' : '') +
      (on.length && H.goalLeadSet ? '<span class="sd-glead-hint">Tap a goal to make this app its lead (the one to build first).</span>' : '') + '</div>';
  }
  function gsRender() {
    var it = BY[INFO]; if (!it) { closeInfo(); return; }
    GSET = true; var gs = goals(), on = it.goals || [];
    $("sdInfoCard").innerHTML =
      '<div class="sd-ih"><div class="sd-ih-t"><h3 id="sdInfoT">\u25ce Goals</h3><div class="sd-ih-m">' + esc(it.name) + ' \u00b7 ' + on.filter(goalOf).length + ' of ' + gs.length + ' ticked. Tick the goals this app serves.</div></div>' +
        '<button type="button" class="sd-gs-back" data-sd="gsback">\u2190 Back</button><button type="button" class="sd-x" data-sd="infoclose" aria-label="Close">\u00d7</button></div>' +
      '<ul class="sd-gp-list sd-gs-list">' + (gs.length ? gs.map(function (gg) { var o = on.indexOf(gg.id) >= 0;
          return '<li><button type="button" class="sd-gp-row' + (o ? " sd-on" : "") + '" style="--cc:' + goalCol(gg.hue) + '" data-sd="gtog" data-goal="' + esc(gg.id) + '" aria-pressed="' + (o ? "true" : "false") + '"><span class="sd-gp-box" aria-hidden="true">' + (o ? "\u2713" : "") + '</span><span class="sd-gp-nm">' + esc(gg.name) + '<small>' + gg.apps + (gg.apps === 1 ? ' app' : ' apps') + ((gg.links || []).length ? ' \u00b7 ' + gg.links.length + ((gg.links.length === 1) ? ' link' : ' links') : '') + '</small></span></button></li>'; }).join("") : '<li class="sd-none-txt">No goals yet.</li>') + '</ul>' +
      '<div class="sd-iact"><button type="button" class="sd-btn" data-sd="gnewfor">+ New goal</button><button type="button" class="sd-btn sd-primary sd-big" data-sd="gsback">Done</button></div>';
    $("sdInfo").hidden = false;
  }
  /* the goal chips of one item: every goal, tap to switch it on/off for this app (review card) */
  function goalChips(it) {
    var gs = goals(), on = it.goals || [];
    return '<div class="sd-igoals"><span class="sd-igoals-k">Goals</span>' + gs.map(function (gg) { var o = on.indexOf(gg.id) >= 0;
        return '<button type="button" class="sd-gchip' + (o ? " sd-on" : "") + '" style="--cc:' + goalCol(gg.hue) + '" data-sd="gtog" data-goal="' + esc(gg.id) + '" aria-pressed="' + (o ? "true" : "false") + '">' + (o ? "✓ " : "") + esc(gg.name) + '</button>'; }).join("") +
      '<button type="button" class="sd-gchip sd-gadd" data-sd="gnewfor">+ New goal</button></div>';
  }
  function groupedHtml(list) {
    var order = [], by = {};
    list.forEach(function (it) { if (!by[it.group]) { by[it.group] = []; order.push(it.group); } by[it.group].push(it); });
    if (sortBy === "az") order.sort(function (a, b) { return a.localeCompare(b); });
    return order.map(function (g) {
      return '<section class="sd-cat" style="--cc:' + catCol(g) + '" aria-label="' + esc(g) + '"><h3 class="sd-cat-h"><i></i>' + esc(g) + ' <span>' + by[g].length + '</span><button type="button" class="sd-catorb" data-sd="catorb" data-g="' + esc(g) + '" aria-label="Send all ' + by[g].length + ' in ' + esc(g) + ' to orbit">All to orbit</button></h3><div class="sd-bubs">' + by[g].map(cardHtml).join("") + '</div></section>';
    }).join("");
  }
  /* what the table shows right now (filter + search), in table order */
  function visible() { return sorted(ROWS.filter(function (it) { return !where(it.id) && (kindF === "all" || it.kind === kindF) && (!q || (it.name + " " + it.group).toLowerCase().indexOf(q) >= 0); })); }
  function renderPool() {
    var left = ROWS.filter(function (r) { return !where(r.id); });
    var list = visible();
    $("sdGrid").classList.toggle("sd-goalgrid", GRP === "goal");   // v142: goals as compact cards
    $("sdGrid").innerHTML = GRP === "goal" && (list.length || (!q && kindF === "all")) ? goalHtml(list)
      : !list.length
      ? '<div class="sd-empty-pool">' + (q || kindF !== "all" ? "Nothing matches. Clear the search or pick another filter." : ROWS.length ? "Everything is in the sphere. Tap a planet to send it back." : "No active items yet. Switch on an app or topic on the board first.") + '</div>'
      : GRP === "cat" ? groupedHtml(list) : '<div class="sd-bubs">' + list.map(cardHtml).join("") + '</div>';
    root.querySelectorAll("#sdSeg button").forEach(function (b) {
      var kd = b.getAttribute("data-kind"), n = kd === "all" ? left.length : left.filter(function (x) { return x.kind === kd; }).length;
      b.textContent = (kd === "all" ? "All" : kd === "app" ? "Apps" : KIND[kd].l) + " " + n; b.setAttribute("aria-pressed", kindF === kd ? "true" : "false");
    });
    $("sdGrp").value = GRP;
    $("sdTapO").setAttribute("aria-pressed", TAPO ? "true" : "false"); root.classList.toggle("sd-tapo-on", TAPO);
    $("sdTapN").setAttribute("aria-pressed", TAPN ? "true" : "false"); root.classList.toggle("sd-tapn-on", TAPN);
    $("sdSort").value = sortBy;
    $("sdMore").classList.toggle("sd-active", !!q || GRP !== "goal" || sortBy !== "pri");
    $("sdT5").textContent = ST.five.length + "/" + H.max; $("sdTO").textContent = ST.orbit.length; $("sdTP").textContent = left.length;
  }
  function renderHud() {
    var d = ""; for (var i = 0; i < H.max; i++) { var k = ST.five[i], it = k && BY[k]; d += it ? '<i class="sd-on" style="--kc:' + KIND[it.kind].c + '">' + (it.logo && it.logo.url ? '<img src="' + esc(it.logo.url) + '" alt="" referrerpolicy="no-referrer">' : it.logo && it.logo.emoji ? esc(it.logo.emoji) : esc(mono(it.name))) + '</i>' : '<i>' + (i + 1) + '</i>'; }
    $("sdHudDots").innerHTML = d; $("sdHudO").textContent = ST.five.length + "/" + H.max + " · orbit " + ST.orbit.length;
  }
  function render(landing) { pull(); renderSphere(landing); renderLoad(); renderPool(); renderHud(); renderDbBtn(); }
  function nominees() { return sorted(ROWS.filter(function (r) { return r.nom && ST.five.indexOf(r.id) < 0; })); }
  function renderDbBtn() { var b = $("sdDbGo"), n = nominees().length; if (b) b.textContent = "\u2605 Debate the Five" + (n ? " \u00b7 " + n : ""); }
  var poolOnly = renderPool; renderPool = function () { poolOnly(); shrinkNames(); };   // v117: every redraw re-fits the names
  var sphereOnly = renderSphere; renderSphere = function (l) { sphereOnly(l); shrinkNames(); };

  /* ---------------- motion ---------------- */
  function fly(k, fromRect) {
    var to = $("sdSphere").querySelector('[data-sdk="' + sel(k) + '"]'); if (!to || !fromRect || reduce) return;
    var tr = to.getBoundingClientRect(), it = BY[k], f = document.createElement("div"), size = tr.width;
    f.className = "sd-flyer"; f.style.width = f.style.height = size + "px"; f.style.setProperty("--kc", KIND[it.kind].c);
    f.style.fontSize = Math.max(11, size * 0.26) + "px"; if (it.logo && it.logo.url) f.innerHTML = '<img src="' + esc(it.logo.url) + '" alt="" referrerpolicy="no-referrer">'; else if (it.logo && it.logo.emoji) f.textContent = it.logo.emoji; else f.textContent = mono(it.name);
    root.appendChild(f); to.style.visibility = "hidden";
    var fx = fromRect.left + fromRect.width / 2 - size / 2, fy = fromRect.top + fromRect.height / 2 - size / 2;
    var an = f.animate([{ transform: "translate(" + fx + "px," + fy + "px) scale(.7)", opacity: .6 }, { transform: "translate(" + tr.left + "px," + tr.top + "px) scale(1)", opacity: 1 }], { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
    an.onfinish = function () { f.remove(); to.style.visibility = ""; to.classList.add("sd-landed"); };
  }
  function checkIgnite() { var full = ST.five.length === H.max; if (full && !lastFull) ignite(); $("sdSphere").classList.toggle("sd-lit", full); lastFull = full; }
  function ignite() {
    if (reduce) return;
    var cv = $("sdFx"), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, ctx = cv.getContext("2d");
    cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cs = getComputedStyle(root), cols = [cs.getPropertyValue("--sd-gold").trim() || "#e8b84a", cs.getPropertyValue("--brand").trim() || "#6a4fd6"];
    var cx = r.width / 2, cy = r.height / 2, P = [];
    for (var i = 0; i < 70; i++) { var a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 3.2; P.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 1.5 + Math.random() * 2.5, c: cols[i % 2] }); }
    var t0 = performance.now();
    (function step(t) {
      var p = Math.min((t - t0) / 1300, 1); ctx.clearRect(0, 0, r.width, r.height); ctx.globalAlpha = 1 - p;
      P.forEach(function (d) { d.x += d.vx; d.y += d.vy; d.vx *= .985; d.vy *= .985; ctx.fillStyle = d.c; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill(); });
      if (p < 1) requestAnimationFrame(step); else ctx.clearRect(0, 0, r.width, r.height);
    })(t0);
  }
  var toastT;
  function toast(msg, undoable) {
    var t = $("sdToast"); clearTimeout(toastT);
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (undoable && hist.length ? '<button type="button" data-sd="undo">Undo</button>' : "");
    t.hidden = false; toastT = setTimeout(function () { t.hidden = true; }, 3600);
  }

  /* ---------------- details window (v110) ---------------- */
  var INFO = null, infoFrom = null;
  function openInfo(k) {
    var it = BY[k]; if (!it) return;
    if (INFO !== k) infoFrom = document.activeElement; INFO = k; GSET = false;
    var w = where(k), p = PRI[it.pri] || PRI[""], L = it.logo, MAX = H.max, free = ST.five.length < MAX, i;
    var pct = it.total ? Math.round(it.done / it.total * 100) : 0;
    var logo = L && L.url ? '<img src="' + esc(L.url) + '" alt="" referrerpolicy="no-referrer">' : L && L.emoji ? '<span class="sd-ih-emo">' + esc(L.emoji) + '</span>' : '<span class="sd-ih-mono">' + esc(mono(it.name)) + '</span>';
    var status = w ? (w.orbit ? "In orbit" : "Target #" + (w.five + 1)) : "On the table";
    var slots = ""; for (i = 0; i < MAX; i++) slots += '<button type="button" class="sd-slotbtn' + (w && w.five === i ? " sd-cur" : "") + '" data-sd="slot" data-i="' + i + '" aria-label="Make it target ' + (i + 1) + '">' + (i + 1) + '</button>';
    slots += '<button type="button" class="sd-slotbtn sd-orbbtn' + (w && w.orbit ? " sd-cur" : "") + '" data-sd="orbit">Orbit</button>';
    var primary = w ? '<button type="button" class="sd-btn sd-big" data-sd="back">Send back to the table</button>'
      : '<button type="button" class="sd-btn sd-primary sd-big" data-sd="add">' + (free ? "Add as #" + (ST.five.length + 1) : "Add to orbit") + '</button>';
    var tasks = (it.open || []).length ? '<ul class="sd-tasks">' + it.open.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + '</ul>' : '<p class="sd-none-txt">No open subtasks.</p>';
    $("sdInfoCard").innerHTML =
      '<div class="sd-ih"><span class="sd-ih-logo" style="--pc:' + (p.l ? p.c : "var(--hair)") + ';--kc:' + KIND[it.kind].c + '">' + logo + '</span>' +
        '<div class="sd-ih-t"><h3 id="sdInfoT">' + esc(it.name) + '</h3><div class="sd-ih-m">' + KIND[it.kind].l + ' · ' + esc(it.group) + (p.l ? ' · <b style="color:' + p.c + '">' + p.l + '</b>' : '') + '</div><div class="sd-ih-s">' + status + '</div></div>' +
        '<button type="button" class="sd-x" data-sd="infoclose" aria-label="Close">×</button></div>' +
      goalSum(it) +
      (w && w.five != null ? '' : '<button type="button" class="sd-btn sd-nombtn sd-nomtop' + (it.nom ? " sd-on" : "") + '" data-sd="nom" aria-pressed="' + (it.nom ? "true" : "false") + '">' + (it.nom ? "\u2605 Nominated for the Five \u00b7 remove" : "\u2606 Nominate for the Five") + '</button>') +
      '<div class="sd-ip">' + (it.total ? '<span class="sd-ip-bar"><i style="width:' + pct + '%;background:' + KIND[it.kind].c + '"></i></span><span>' + it.done + '/' + it.total + ' done</span>' : '<span>No subtasks yet</span>') +
        '<span class="sd-ip-age' + (it.age != null && it.age >= 14 ? " sd-stale" : "") + '">' + ageTxt(it.age) + '</span></div>' +
      '<div class="sd-isec"><h4>Open tasks <span>' + (it.open || []).length + '</span></h4>' + tasks + '</div>' +
      (it.notes ? '<div class="sd-isec"><h4>Notes</h4><p class="sd-notes">' + esc(it.notes) + '</p></div>' : '') +
      logoSec(k, it) +
      '<div class="sd-iact">' + primary + '<div class="sd-iplace"><span>' + (w ? "Move it to" : "Or place it at") + '</span><div class="sd-slots">' + slots + '</div></div></div>' +
      (H.openCard ? '<button type="button" class="sd-link" data-sd="card">Open the full card to edit</button>' : '');
    $("sdInfo").hidden = false;
    var b = $("sdInfoCard").querySelector(".sd-big"); if (b) b.focus({ preventScroll: true });
  }
  /* v117: Set logo. Saved in Akatsuki's shared store, so every app shows the same logo. */
  function logoNote(LI, it) {
    var on = it.logo && it.logo.url;
    if (LI.source === "emoji" && LI.emoji) return "Your emoji, shared with your other apps.";
    if (LI.source === "upload") return "Your uploaded image, shared with your other apps.";
    if (LI.url) return "Taken from the app's own site. It updates when the site's icon changes.";
    var why = { no_icon: "The app's site has no PNG icon the store can use.", icon_http_404: "The app's site names an icon file that isn't deployed.",
      page_too_large: "The app's site page is too big for the store to read.", over_64kb: "The site's icon is over 64 KB.", not_square: "The site's icon isn't square.",
      not_png_or_webp: "The site's icon isn't PNG or WebP." }[LI.status];
    if (why) return why + (on ? " The icon shown is read from the site on this device only." : "");
    if (!LI.hasHome) return "No live site to take a logo from, so the name is shown.";
    return on ? "Read from the app's site on this device. The store gets it at the next daily sync." : "Waiting for the next daily sync.";
  }
  function logoSec(k, it) {
    var LI = it.kind === "app" && H.logo && H.logo.info ? H.logo.info(k) : null; if (!LI) return "";
    var off = LI.ready ? "" : " disabled";
    return '<div class="sd-isec sd-ilogo"><h4>Logo</h4><p class="sd-lnote">' + esc(LI.ready ? logoNote(LI, it) : "Sign in to set a logo.") + '</p>' +
      '<div class="sd-lrow"><button type="button" class="sd-btn" data-sd="lgup"' + off + '>Upload image</button>' +
      '<button type="button" class="sd-btn" data-sd="lgemo"' + off + ' aria-expanded="false">' + (LI.source === "emoji" ? "Change emoji" : "Use an emoji") + '</button>' +
      (LI.hasHome && (LI.source === "upload" || LI.source === "emoji") ? '<button type="button" class="sd-btn" data-sd="lgsite"' + off + '>Use the site\'s icon</button>' : '') + '</div>' +
      '<div class="sd-lemo" id="sdLemo" hidden><input type="text" id="sdEmo" maxlength="16" autocomplete="off" placeholder="Type or paste one emoji" aria-label="Emoji" value="' + esc(LI.source === "emoji" ? LI.emoji : "") + '">' +
      '<button type="button" class="sd-btn sd-primary" data-sd="lgemosave">Save</button></div>' +
      '<input type="file" id="sdLogoFile" accept="image/png,image/webp,image/jpeg,image/gif,image/svg+xml" hidden>' +
      '<p class="sd-lmsg" id="sdLmsg" role="status" aria-live="polite"></p></div>';
  }
  function logoRun(job, done) {
    var k = INFO, card = $("sdInfoCard"); if (!k || !card) return;
    card.querySelectorAll(".sd-ilogo button").forEach(function (b) { b.disabled = true; });
    $("sdLmsg").className = "sd-lmsg"; $("sdLmsg").textContent = "Saving…";
    job(k).then(function () {
      if (!isOpen) return; pull(); render(); if (INFO === k) openInfo(k);
      var m = $("sdLmsg"); if (m) m.textContent = done;
    }, function (e) {
      if (!isOpen || INFO !== k) return;
      card.querySelectorAll(".sd-ilogo button").forEach(function (b) { b.disabled = false; });
      var m = $("sdLmsg"); if (m) { m.className = "sd-lmsg sd-lerr"; m.textContent = (e && e.message) || "That didn't work."; }
    });
  }
  function closeInfo() {
    if (!INFO) return; INFO = null; GP = null; GSET = false; $("sdInfo").hidden = true;
    if (infoFrom && infoFrom.focus && document.contains(infoFrom)) try { infoFrom.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------------- moves ---------------- */
  function act(k, how, i) {
    if (!BY[k]) return;
    var src = root.querySelector('.sd-bub[data-sdk="' + sel(k) + '"] .sd-bub-c'), from = src ? src.getBoundingClientRect() : null;
    var before = where(k), name = BY[k].name, snap = H.snapshot(), sig = JSON.stringify(H.state()), res;
    if (how === "add") H.add(k);
    else if (how === "slot") H.place(k, i);
    else if (how === "orbit") res = H.orbit(k);
    else if (how === "back") H.back(k);
    else if (how === "center") { if (!before) H.add(k); else if (before.orbit && ST.five.length < H.max) H.place(k, ST.five.length); }
    if (JSON.stringify(H.state()) !== sig) { hist.push(snap); if (hist.length > 30) hist.shift(); }
    pull(); var after = where(k);
    render(after && !before ? null : k);
    if (after && !before) fly(k, from);
    checkIgnite();
    if (res === "stuck") toast("Nothing in orbit can take its slot, so " + name + " stays in The Five", false);
    else if (how === "orbit" && res === "five") toast("A slot in The Five was free, so " + name + " went there", true);
    else if (!after && before) toast(name + " is back on the table", true);
    else if (after && after.orbit && !(before && before.orbit)) toast(name + " is in orbit", true);
    else if (after && !before && ST.five.length === H.max) toast("Your Five are set. " + name + " is #" + (after.five + 1), true);
  }
  /* v131: several to orbit in one move (one Undo step) */
  function orbitMany(ids, label) {
    ids = ids.filter(function (k) { return BY[k] && !where(k); }); if (!ids.length) return;
    var snap = H.snapshot(), sig = JSON.stringify(H.state());
    ids.forEach(function (k) { H.orbit(k); });
    if (JSON.stringify(H.state()) !== sig) { hist.push(snap); if (hist.length > 30) hist.shift(); }
    render(); checkIgnite();
    toast((ids.length === 1 ? BY[ids[0]].name + " is" : ids.length + " from " + label + " are") + " in orbit", true);
  }
  function undo() { if (!hist.length) return; H.restore(hist.pop()); render(); checkIgnite(); toast("Undone", false); }

  /* ---------------- v133 · Five debate: nominees are argued out in a Claude chat; you place the winners here ----------------
     The message carries the current Five, the nominees (priority, progress, last activity, open tasks, notes) and the rest of
     the orbit by name. Belay (career) and Apperse are not built yet: the message says so, and they join here later. */
  function nomToggle(k) { if (!BY[k] || !H.nominate) return; var on = !BY[k].nom; H.nominate(k, on); pull(); render(); toast(on ? BY[k].name + " is nominated for the Five" : BY[k].name + " is no longer a nominee", false); }
  /* v135: cut at a word boundary, never mid-word */
  function clip(x, n) {
    x = String(x || "").replace(/\s+/g, " ").trim(); if (x.length <= n) return x;
    var c = x.slice(0, n - 1), sp = c.lastIndexOf(" ");
    return (sp > n * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;:.\-]+$/, "") + "…";
  }
  /* v135: what the task list says about an item. none = no task was ever written (not the same as finished) */
  function taskState(it) { return it.idea && !it.done && !it.total ? "idea" : !it.total ? "none" : !(it.open || []).length ? "done" : "open"; }
  function dbLine(it, rank, tl) {
    var p = PRI[it.pri] || PRI[""], open = it.open || [], ts = taskState(it); tl = tl || 200;
    var head = (rank ? "#" + rank + " " : "- ") + it.name + (ts === "idea" ? " (not started yet: no code)" : "") + " — " + KIND[it.kind].l + " · " + it.group + (p.l ? " · priority " + p.l : "");
    if (ts === "none") head += " · NO TASKS WRITTEN YET (nothing defined to do, not finished)";
    else if (ts !== "idea") head += " · " + it.done + "/" + it.total + " subtasks done" + (ts === "done" ? " (all done)" : "");
    if (ts !== "idea" && it.age != null) head += " · last activity " + ageTxt(it.age);
    var t = ts === "open" ? "\n   Open tasks: " + open.slice(0, 5).map(function (x) { return clip(x, tl); }).join("; ") + (open.length > 5 ? " (+" + (open.length - 5) + " more)" : "") : "";
    var gn = (it.goals || []).map(goalOf).filter(Boolean).map(function (g) { return g.name; }), pu = "\n   Goals: " + (gn.length ? gn.join(", ") : "none set");   // v139
    return head + pu + t + (it.notes ? "\n   Notes: " + clip(it.notes, Math.max(200, tl)) : "");
  }
  function dbText(tl) {
    pull();
    var five = ST.five.map(function (k, i) { return dbLine(BY[k], i + 1, tl); }), noms = nominees().map(function (it) { return dbLine(it, 0, tl); });
    var rest = ST.orbit.filter(function (k) { return !BY[k].nom; }).map(function (k) { return BY[k].name; });
    var c = H.core ? H.core() : null;
    var today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    var L = [
      "I use Weekly Focus to pick \"The Five\": at most " + H.max + " targets I commit to this week (#1 = must do). Several apps are competing for a place and I can't decide. Debate it with me.",
      "",
      "How to help:",
      "1. For each nominee and each current target, give the strongest case for and against having it in this week's Five, using the data below.",
      "2. Point out conflicts: two that compete for the same time or goal, something untouched for weeks, something almost done.",
      "3. Ask me up to 3 short questions about my goals for this week if the answer would change the pick. Wait for my answers before deciding.",
      "4. Then recommend a ranked Five with one line why for each, and say which go to orbit (kept in view, not targets).",
      "Weigh every app against the goals it serves (listed under GOALS). Apps serving the same goal form a package: say which one should lead it this week and which can wait. Question apps that serve no goal.",
      "I will set the Five myself in the app afterwards.",
      "",
      "Today: " + today + "."
    ];
    if (c) L.push("Core (always in focus, not one of the Five): " + c.name + (c.open ? " — " + c.open + " open" : " — all clear") + ".");
    L.push("", "CURRENT FIVE" + (ST.five.length < H.max ? " (" + (H.max - ST.five.length) + " empty)" : ""), five.length ? five.join("\n") : "(none set yet)",
      "", "NOMINEES", noms.length ? noms.join("\n") : "(none)",
      "", "ALSO IN ORBIT, not nominated: " + (rest.length ? rest.join(", ") : "none"),
      "", "GOALS (what my apps are for)", (function () { var gr = H.goalReport ? H.goalReport() : []; return gr.length ? gr.map(function (g) { return "- " + g.name + (g.lead ? " (lead: " + g.lead + ")" : "") + " \u2014 in the sphere: " + (g.sphere.length ? g.sphere.join(", ") : "none") + (g.table.length ? "; also serving it, not in the sphere: " + g.table.join(", ") : "") + (g.links && g.links.length ? "; links: " + g.links.map(function (l) { return l.t + " (" + (LK[l.kind] || LK.web).l.toLowerCase() + ")"; }).join(", ") : ""); }).join("\n") : "(no goals set yet)"; })(),
      "", "Not connected yet: my career direction (Belay) and Apperse. If career goals matter for this choice, ask me directly.");
    return L.join("\n");
  }
  function copyOld(t) { var a = document.createElement("textarea"); a.value = t; a.setAttribute("readonly", ""); a.style.cssText = "position:fixed;top:-1000px;opacity:0"; document.body.appendChild(a); a.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} a.remove(); return ok; }
  function copyText(t) {
    try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return copyOld(t); }); } catch (e) {}
    return Promise.resolve(copyOld(t));
  }
  var DB_URL_MAX = 7000, DB_IDEA_OPEN = false;
  function ideaAdd() {
    var n = $("sdIdeaN"), g = $("sdIdeaG"), t = $("sdIdeaT"); if (!n) return;
    var name = n.value.trim(); if (!name) { n.focus(); return; }
    var dup = ROWS.filter(function (r) { return r.name.toLowerCase() === name.toLowerCase(); })[0];
    if (dup) { if (!dup.nom) H.nominate(dup.id, true); pull(); render(); DB_IDEA_OPEN = false; dbOpen(); toast(dup.name + " already exists, so it was starred instead", false); return; }
    var id = H.idea(name, g.value, t.value); pull(); render(); DB_IDEA_OPEN = false; dbOpen();
    toast(id ? name + " added and nominated" : "Couldn\u2019t add it", false);
  }   // a longer message goes by clipboard: claude.ai opens empty and you paste
  function dbOpen() {
    pull(); INFO = "@debate"; if (!infoFrom || !document.contains(infoFrom) || $("sdInfo").hidden) infoFrom = document.activeElement;
    var noms = nominees();
    var row = function (it, rank) { return '<li class="sd-db-row"><span class="sd-db-rk">' + (rank ? "#" + rank : "★") + '</span><span class="sd-db-nm">' + esc(it.name) + '<small>' + (taskState(it) === "none" ? '<b class="sd-db-warn">no tasks yet</b> \u00b7 ' : '') + (it.idea && !it.done ? (it.group === "Not started yet" ? "Not started yet" : esc(it.group) + ' \u00b7 not started yet') : esc(it.group) + (it.age == null ? '' : ' \u00b7 ' + ageTxt(it.age))) + '</small></span>' +
      (taskState(it) === "none" && H.openCard ? '<button type="button" class="sd-btn sd-db-task" data-sd="dbtask" data-sdk="' + esc(it.id) + '">+ Task</button>' : '') + (rank ? '' : '<button type="button" class="sd-x sd-db-x" data-sd="dbunnom" data-sdk="' + esc(it.id) + '" aria-label="Remove ' + esc(it.name) + ' from the nominees">×</button>') + '</li>'; };
    $("sdInfoCard").innerHTML =
      '<div class="sd-ih"><div class="sd-ih-t"><h3 id="sdInfoT">★ Debate the Five</h3><div class="sd-ih-m">Claude argues for and against each nominee, asks what matters this week, then suggests a Five. You place the winners here.</div></div>' +
        '<button type="button" class="sd-x" data-sd="infoclose" aria-label="Close">×</button></div>' +
      '<div class="sd-isec"><h4>Current Five <span>' + ST.five.length + '/' + H.max + '</span></h4>' + (ST.five.length ? '<ul class="sd-db-list">' + ST.five.map(function (k, i) { return row(BY[k], i + 1); }).join("") + '</ul>' : '<p class="sd-none-txt">No targets yet.</p>') + '</div>' +
      '<div class="sd-isec"><h4>Nominees <span>' + noms.length + '</span></h4>' + (noms.length ? '<ul class="sd-db-list">' + noms.map(function (it) { return row(it, 0); }).join("") + '</ul>'
        : '<p class="sd-none-txt">No nominees yet. Tap \u2606 on an orbit chip, switch on <b>Tap \u2192 \u2605</b> and tap bubbles, or nominate in <b>Review one by one</b>.</p>') +
        (H.idea ? '<details class="sd-db-idea"' + (DB_IDEA_OPEN ? " open" : "") + '><summary>+ Add an app not started yet</summary><form class="sd-db-form" data-sdform="idea">' +
          '<input id="sdIdeaN" required maxlength="80" placeholder="Name (e.g. Belay)" autocomplete="off" aria-label="Name of the new app">' +
          '<input id="sdIdeaG" maxlength="60" placeholder="Category (optional)" list="sdIdeaGL" autocomplete="off" aria-label="Category"><datalist id="sdIdeaGL">' + (H.groups ? H.groups() : []).map(function (g) { return '<option value="' + esc(g) + '">'; }).join("") + '</datalist>' +
          '<input id="sdIdeaT" maxlength="300" placeholder="One line: what it is for (optional)" autocomplete="off" aria-label="What it is for">' +
          '<button type="submit" class="sd-btn sd-primary">Add as nominee</button><p class="sd-db-note">It becomes a normal app on the board (category \u201cNot started yet\u201d unless you pick one), starred for the Five.</p></form></details>' : '') + '</div>' +
      (function () { var n = ST.five.map(function (k) { return BY[k]; }).concat(noms).filter(function (it) { return taskState(it) === "none"; }).length;
        return n ? '<p class="sd-db-hint">' + n + (n === 1 ? " has" : " have") + ' no tasks written yet. Tap <b>+ Task</b> to add a first step, so Claude can judge ' + (n === 1 ? "it" : "them") + '.</p>' : ''; })() +
      '<div class="sd-iact"><button type="button" class="sd-btn sd-primary sd-big" data-sd="dbclaude"' + (noms.length ? "" : " disabled") + '>Open the debate in Claude</button>' +
        '<button type="button" class="sd-btn" data-sd="dbcopy"' + (noms.length ? "" : " disabled") + '>Copy the message</button></div>' +
      '<p class="sd-db-note">The message includes each one’s priority, progress, last activity, open tasks and notes. Career (Belay) and Apperse join when those apps exist.</p>';
    $("sdInfo").hidden = false;
    var b = $("sdInfoCard").querySelector(".sd-big:not([disabled])") || $("sdInfoCard").querySelector(".sd-x"); if (b) b.focus({ preventScroll: true });
  }
  function dbClaude() {
    var full = dbText(200), t = full, enc = encodeURIComponent(t), cuts = [140, 100, 80], i = 0;
    while (enc.length > DB_URL_MAX && i < cuts.length) { t = dbText(cuts[i++]); enc = encodeURIComponent(t); }   // v135: shorter task text before giving up on the link
    var short = enc.length <= DB_URL_MAX;
    window.open(short ? "https://claude.ai/new?q=" + enc : "https://claude.ai/new", "_blank", "noopener");
    copyText(full).then(function (ok) { toast(short ? "Opened Claude with the nominees" + (ok ? " (full text also copied)" : "") : ok ? "Long list: copied. Paste it into the new Claude chat" : "Couldn’t copy. Use Copy the message", false); });
  }

  /* ---------------- v132 · Review: one card at a time, swipe right = in orbit, left = not in orbit ----------------
     The Five are not in the queue (they are chosen on purpose). Each decision is applied at once and is one Undo step;
     Back inside the review steps to the previous card and puts its decision back. */
  var RV = null;
  function rvQueue() { return sorted(ROWS.filter(function (it) { return ST.five.indexOf(it.id) < 0 && (kindF === "all" || it.kind === kindF); })).map(function (it) { return it.id; }); }
  function rvOpen() {
    pull(); var ids = rvQueue();
    if (!ids.length) { toast("Nothing to review: everything is in The Five", false); return; }
    RV = { ids: ids, i: 0, log: [], from: document.activeElement };
    $("sdRv").hidden = false; rvRender();
  }
  function rvClose() {
    if (!RV) return; var from = RV.from; RV = null; $("sdRv").hidden = true; render(); checkIgnite();
    if (from && from.focus && document.contains(from)) try { from.focus({ preventScroll: true }); } catch (e) {}
  }
  function rvFresh(age) { return age != null && age <= 3; }
  function rvRender() {
    var box = $("sdRvIn"), n = RV.ids.length;
    while (RV.i < n && !BY[RV.ids[RV.i]]) RV.i++;   // an item switched off meanwhile is skipped
    var bar = '<div class="sd-rv-top"><button type="button" class="sd-btn" data-sd="rvback"' + (RV.log.length ? "" : " disabled") + '>← Back</button>' +
      '<span class="sd-rv-count">' + Math.min(RV.i + 1, n) + ' / ' + n + '</span><button type="button" class="sd-btn" data-sd="rvclose">Done</button></div>' +
      '<div class="sd-rv-prog" aria-hidden="true"><i style="width:' + Math.round(Math.min(RV.i, n) / n * 100) + '%"></i></div>';
    if (RV.i >= n) {
      var inN = 0, outN = 0, added = [], removed = [], skipped = 0;
      RV.log.forEach(function (d) { if (d.c === "in") { inN++; if (d.changed) added.push(d.k); } else if (d.c === "out") { outN++; if (d.changed) removed.push(d.k); } else skipped++; });
      var nm = function (ks) { return ks.map(function (k) { return BY[k] ? esc(BY[k].name) : ""; }).join(", "); };
      box.innerHTML = bar + '<div class="sd-rv-card sd-rv-end"><h3>Review done</h3>' +
        '<p><b>' + inN + '</b> in orbit' + (added.length ? ' · new: ' + nm(added) : '') + '</p>' +
        '<p><b>' + outN + '</b> not in orbit' + (removed.length ? ' · taken out: ' + nm(removed) : '') + '</p>' +
        (skipped ? '<p><b>' + skipped + '</b> skipped</p>' : '') +
        (ST.orbit.length > ORBIT_CAP ? '<p class="sd-rv-warn">' + ST.orbit.length + ' in orbit. The week load suggests ' + ORBIT_CAP + ' or fewer.</p>' : '') +
        '<div class="sd-rv-acts"><button type="button" class="sd-btn" data-sd="rvagain">Review again</button><button type="button" class="sd-btn sd-primary" data-sd="rvclose">Done</button></div></div>';
      var d = box.querySelector(".sd-primary"); if (d) d.focus({ preventScroll: true });
      return;
    }
    var k = RV.ids[RV.i], it = BY[k], w = where(k), p = PRI[it.pri] || PRI[""], L = it.logo;
    var pct = it.total ? Math.round(it.done / it.total * 100) : 0, open = it.open || [];
    var logo = L && L.url ? '<img src="' + esc(L.url) + '" alt="" referrerpolicy="no-referrer">' : L && L.emoji ? '<span class="sd-ih-emo">' + esc(L.emoji) + '</span>' : '<span class="sd-ih-mono">' + esc(mono(it.name)) + '</span>';
    box.innerHTML = bar +
      '<div class="sd-rv-card" id="sdRvCard" tabindex="-1" style="--kc:' + KIND[it.kind].c + '">' +
        '<span class="sd-rv-stamp sd-rv-sin" aria-hidden="true">In orbit</span><span class="sd-rv-stamp sd-rv-sout" aria-hidden="true">Not in orbit</span>' +
        '<div class="sd-ih"><span class="sd-ih-logo" style="--pc:' + (p.l ? p.c : "var(--hair)") + ';--kc:' + KIND[it.kind].c + '">' + logo + '</span>' +
          '<div class="sd-ih-t"><h3>' + esc(it.name) + '</h3><div class="sd-ih-m">' + KIND[it.kind].l + ' · ' + esc(it.group) + (p.l ? ' · <b style="color:' + p.c + '">' + p.l + '</b>' : '') + '</div>' +
          '<div class="sd-rv-now' + (w && w.orbit ? " sd-in" : "") + '">' + (w && w.orbit ? "Now: in orbit" : "Now: not in orbit") + '</div>' + (it.nom ? ' <span class="sd-rv-nom">\u2605 Nominee</span>' : '') + '</div></div>' +
        goalChips(it) +
        '<div class="sd-rv-age' + (rvFresh(it.age) ? " sd-fresh" : it.age != null && it.age >= 14 ? " sd-stale" : "") + '">' + (rvFresh(it.age) ? "Updated " : "Last activity: ") + ageTxt(it.age) + '</div>' +
        '<div class="sd-ip">' + (it.total ? '<span class="sd-ip-bar"><i style="width:' + pct + '%;background:' + KIND[it.kind].c + '"></i></span><span>' + it.done + '/' + it.total + ' done</span>' : '<span>No subtasks yet</span>') + '</div>' +
        '<div class="sd-isec"><h4>Open tasks <span>' + open.length + '</span></h4>' + (open.length ? '<ul class="sd-tasks">' + open.slice(0, 4).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join("") + (open.length > 4 ? '<li class="sd-rv-more">+' + (open.length - 4) + ' more</li>' : '') + '</ul>' : '<p class="sd-none-txt">No open subtasks.</p>') + '</div>' +
        (it.notes ? '<p class="sd-rv-notes">' + esc(it.notes.slice(0, 180)) + (it.notes.length > 180 ? "…" : "") + '</p>' : '') +
      '</div>' +
      '<div class="sd-rv-acts"><button type="button" class="sd-btn sd-rv-out" data-sd="rvout">← Not in orbit</button><button type="button" class="sd-btn sd-rv-skip" data-sd="rvskip">Skip</button><button type="button" class="sd-btn sd-rv-inb" data-sd="rvin">In orbit →</button></div>' +
      '<button type="button" class="sd-btn sd-nombtn' + (it.nom ? " sd-on" : "") + '" data-sd="rvnom" aria-pressed="' + (it.nom ? "true" : "false") + '">' + (it.nom ? "\u2605 Nominated for the Five \u00b7 remove" : "\u2606 Nominate for the Five") + '</button>' +
      '<p class="sd-rv-tip">Swipe the card, or use ← → keys. ↓ skips, N nominates.</p>';
    var c = $("sdRvCard"); if (c) c.focus({ preventScroll: true });
  }
  function rvDecide(c) {
    if (!RV || RV.i >= RV.ids.length) return;
    var k = RV.ids[RV.i], w = where(k), snap = H.snapshot(), sig = JSON.stringify(H.state());
    if (c === "in" && !w) H.orbit(k);
    else if (c === "out" && w && w.orbit) H.back(k);
    var changed = JSON.stringify(H.state()) !== sig;
    if (changed) { hist.push(snap); if (hist.length > 30) hist.shift(); }
    RV.log.push({ k: k, c: c, snap: snap, changed: changed });
    pull(); RV.i++;
    var card = $("sdRvCard");
    if (card && !reduce && c !== "skip") { card.classList.add(c === "in" ? "sd-rv-flyr" : "sd-rv-flyl"); setTimeout(function () { if (RV) rvRender(); }, 170); }
    else rvRender();
  }
  function rvBack() {
    if (!RV || !RV.log.length) return;
    var d = RV.log.pop();
    if (d.changed) { H.restore(d.snap); if (hist.length && hist[hist.length - 1] === d.snap) hist.pop(); }
    pull(); RV.i = Math.max(0, RV.i - 1); rvRender();
  }
  var rvDrag = null;
  function rvWire() {
    var rv = $("sdRv");
    rv.addEventListener("pointerdown", function (e) {
      var c = e.target.closest("#sdRvCard"); if (!c || e.button > 0) return;
      rvDrag = { c: c, x0: e.clientX, y0: e.clientY, dx: 0, on: false, id: e.pointerId };
    });
    rv.addEventListener("pointermove", function (e) {
      if (!rvDrag) return; var dx = e.clientX - rvDrag.x0, dy = e.clientY - rvDrag.y0;
      if (!rvDrag.on) { if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { rvDrag = null; return; } if (Math.abs(dx) < 8) return; rvDrag.on = true; try { rvDrag.c.setPointerCapture(rvDrag.id); } catch (x) {} rvDrag.c.classList.add("sd-rv-drag"); }
      rvDrag.dx = dx; rvDrag.c.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 22) + "deg)";
      rvDrag.c.setAttribute("data-dir", dx > 60 ? "in" : dx < -60 ? "out" : "");
    });
    function up() {
      if (!rvDrag) return; var d = rvDrag; rvDrag = null; if (!d.on) return;
      d.c.classList.remove("sd-rv-drag");
      var lim = Math.min(110, d.c.offsetWidth * 0.28);
      if (d.dx > lim) rvDecide("in"); else if (d.dx < -lim) rvDecide("out");
      else { d.c.style.transform = ""; d.c.removeAttribute("data-dir"); }
    }
    rv.addEventListener("pointerup", up); rv.addEventListener("pointercancel", up);
  }

  /* ---------------- v141 · filing apps into a goal: drag a bubble onto a goal section, or + Add apps (search + tick) ---------------- */
  function goalDrop(k, gid) {
    var g = goalOf(gid); if (!g || !BY[k] || !H.goalToggle) { render(); return; }
    if ((BY[k].goals || []).indexOf(gid) >= 0) { render(); toast(BY[k].name + " already serves " + g.name, false); return; }
    H.goalToggle(k, gid); pull(); render(); toast(BY[k].name + " now serves " + g.name, false);
  }
  var GP = null;   // {gid, q}
  function gpOpen(gid) { var g = goalOf(gid); if (!g) return; GP = { gid: gid, q: "" }; INFO = "@goalpick"; infoFrom = document.activeElement; gpRender(true); $("sdInfo").hidden = false; }
  function gpRows() {
    var q2 = GP.q.trim().toLowerCase();
    return ROWS.filter(function (r) { return !q2 || (r.name + " " + r.group).toLowerCase().indexOf(q2) >= 0; })
      .sort(function (a, b) { var ia = (a.goals || []).indexOf(GP.gid) >= 0 ? 0 : 1, ib = (b.goals || []).indexOf(GP.gid) >= 0 ? 0 : 1; return ia - ib || a.name.localeCompare(b.name); });
  }
  function gpList() {
    var rows = gpRows();
    return rows.length ? rows.map(function (r) { var on = (r.goals || []).indexOf(GP.gid) >= 0, w = where(r.id);
        return '<li><button type="button" class="sd-gp-row' + (on ? " sd-on" : "") + '" data-sd="gptog" data-sdk="' + esc(r.id) + '" aria-pressed="' + (on ? "true" : "false") + '"><span class="sd-gp-box" aria-hidden="true">' + (on ? "✓" : "") + '</span><span class="sd-gp-nm">' + esc(r.name) + '<small>' + KIND[r.kind].l + ' · ' + esc(r.group) + (w ? (w.orbit ? ' · in orbit' : ' · #' + (w.five + 1)) : '') + '</small></span></button></li>'; }).join("")
      : '<li class="sd-none-txt">No app matches “' + esc(GP.q) + '”.</li>';
  }
  /* v146: links in the picker. Paste a URL, or tick a chat saved in the Chats tab; the goal's links are listed with × */
  function gpLinks() {
    var g = goalOf(GP.gid), ls = g ? g.links || [] : [];
    return ls.length ? ls.map(function (l) { var K = LK[l.kind] || LK.web; return '<li class="sd-gl-row sd-gl-' + esc(l.kind in LK ? l.kind : "web") + '"><span class="sd-gl-i" aria-hidden="true">' + esc(K.i) + '</span><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.t) + '<small>' + K.l + ' · ' + esc(l.url.replace(/^https?:\/\//, "")) + '</small></a>' + (H.goalLinkOff ? '<button type="button" class="sd-gl-act' + (l.off ? ' sd-isdim' : '') + '" data-sd="gloff" data-lid="' + esc(l.id) + '" aria-pressed="' + (l.off ? "false" : "true") + '" title="' + (l.off ? 'Inactive: dimmed in the goal. Tap to make it active' : 'Active. Tap to mark it inactive') + '">' + (l.off ? '\u25cc Inactive' : '\u25cf Active') + '</button>' : '') + '<button type="button" class="sd-x" data-sd="gldel" data-lid="' + esc(l.id) + '" aria-label="Remove the link ' + esc(l.t) + '">×</button></li>'; }).join("") : '';
  }
  function gpChats() {
    if (!H.chats) return ""; var g = goalOf(GP.gid), have = {}, q2 = GP.q.trim().toLowerCase();
    (g ? g.links || [] : []).forEach(function (l) { have[l.url] = l.id; if (l.cid) have["c:" + l.cid] = l.id; });
    var cs = H.chats().filter(function (c) { return !q2 || (c.t + " " + c.fold).toLowerCase().indexOf(q2) >= 0; }).sort(function (a, b) { return (have[a.url] || have["c:" + a.id] ? 0 : 1) - (have[b.url] || have["c:" + b.id] ? 0 : 1) || a.t.localeCompare(b.t); });
    if (!cs.length) return "";
    return '<li class="sd-gp-sec">Saved chats</li>' + cs.slice(0, q2 ? 40 : 12).map(function (c) { var on = !!(have[c.url] || have["c:" + c.id]);
      return '<li><button type="button" class="sd-gp-row' + (on ? " sd-on" : "") + '" data-sd="gpchat" data-cid="' + esc(c.id) + '" aria-pressed="' + (on ? "true" : "false") + '"><span class="sd-gp-box" aria-hidden="true">' + (on ? "✓" : "") + '</span><span class="sd-gp-nm">\ud83d\udcac ' + esc(c.t) + '<small>Chat' + (c.fold ? ' · ' + esc(c.fold) : '') + '</small></span></button></li>'; }).join("");
  }
  function openNewApp(gid) {
    var g = gid ? goalOf(gid) : null;
    if (!H.appAdd || (gid && !g)) return;
    INFO = "@newapp";
    infoFrom = document.activeElement;
    $("sdInfoCard").innerHTML =
      '<div class="sd-ih"><div class="sd-ih-t"><h3 id="sdInfoT">New app</h3>' +
      (g ? '<p class="sd-ih-m">Goal: ' + esc(g.name) + '</p>' : '') + '</div>' +
      '<button type="button" class="sd-x" data-sd="infoclose" aria-label="Close">×</button></div>' +
      '<form class="sd-new-app" data-sdform="appnew" data-goal="' + esc(gid || "") + '">' +
      '<label for="sdAppName">App name</label><input id="sdAppName" class="sd-gp-q" type="text" required autocomplete="off" enterkeyhint="done">' +
      '<p id="sdAppError" class="sd-app-error" role="alert" hidden></p>' +
      '<div class="sd-iact"><button type="submit" class="sd-btn sd-primary sd-big">' + (g ? 'Add to goal' : 'Create app') + '</button></div></form>';
    $("sdInfo").hidden = false;
    $("sdAppName").focus({ preventScroll: true });
  }
  function saveNewApp(form) {
    var gid = form.getAttribute("data-goal"), g = gid ? goalOf(gid) : null;
    var input = $("sdAppName"), name = input.value.trim();
    var result = name ? H.appAdd(name, gid) : { error: "Enter an app name." };
    if (result.error) {
      var error = $("sdAppError");
      error.textContent = result.error;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
      input.focus();
      return;
    }
    infoFrom = root.querySelector(gid ? '[data-sd="appnew"][data-goal="' + sel(gid) + '"]' : '.sd-gnew[data-sd="appnew"]');
    closeInfo();
    toast(result.name + (g ? (result.created ? " created and added to " : " linked to ") + g.name : " created"), false);
  }
  function gpLinkAdd() {
    var u = $("sdGlU"), t = $("sdGlT"); if (!u || !GP || !H.goalLinkAdd) return;
    var v = u.value.trim(); if (!v) { u.focus(); return; }
    var id = H.goalLinkAdd(GP.gid, v, t ? t.value : ""); if (!id) { toast("That doesn’t look like a web address", false); u.focus(); return; }
    u.value = ""; if (t) t.value = ""; pull(); render(); gpRender(false); toast("Link added", false);
  }
  function gpRender(first) {
    var g = goalOf(GP.gid); if (!g) { closeInfo(); return; }
    var n = ROWS.filter(function (r) { return (r.goals || []).indexOf(GP.gid) >= 0; }).length;
    if (first || !$("sdGpList")) {
      $("sdInfoCard").innerHTML =
        '<div class="sd-ih"><div class="sd-ih-t"><h3 id="sdInfoT">◎ ' + esc(g.name) + '</h3><div class="sd-ih-m" id="sdGpN">' + n + (n === 1 ? ' app serves' : ' apps serve') + ' this goal. Tick the apps that serve it.</div></div>' +
          '<button type="button" class="sd-x" data-sd="infoclose" aria-label="Close">×</button></div>' +
        (H.goalLinkAdd ? '<form class="sd-gl-form" data-sdform="glink" novalidate><input id="sdGlU" type="text" inputmode="url" autocapitalize="off" spellcheck="false" autocomplete="off" placeholder="Paste a Claude chat, Claude Code or web link" aria-label="Link"><input id="sdGlT" type="text" autocomplete="off" placeholder="Name (optional)" aria-label="Name for the link"><button type="submit" class="sd-btn">Add link</button></form>' +
          '<ul class="sd-gl-cur" id="sdGlCur">' + gpLinks() + '</ul>' : '') +
        '<input id="sdGpQ" type="search" class="sd-gp-q" placeholder="Search existing apps or chats…" autocomplete="off" aria-label="Search existing apps or chats" value="' + esc(GP.q) + '">' +
        '<ul class="sd-gp-list" id="sdGpList">' + gpList() + gpChats() + '</ul>' +
        '<div class="sd-iact"><button type="button" class="sd-btn sd-primary sd-big" data-sd="infoclose">Done</button></div>';
      var qi = $("sdGpQ"); if (qi) {
        qi.addEventListener("input", function () { GP.q = this.value; $("sdGpList").innerHTML = gpList() + gpChats(); });
        if (first && !matchMedia("(hover: none)").matches) qi.focus({ preventScroll: true });
      }
    } else { $("sdGpList").innerHTML = gpList() + gpChats(); if ($("sdGlCur")) $("sdGlCur").innerHTML = gpLinks(); $("sdGpN").textContent = n + (n === 1 ? ' app serves' : ' apps serve') + ' this goal. Tick the apps that serve it.'; }
  }

  /* ---------------- input ---------------- */
  var drag = null, suppressClick = false, overEl = null;
  function wire() {
    root.addEventListener("click", function (e) {
      e.stopPropagation();   // keep the board's own click handlers out of the draft
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      var el = e.target.closest("[data-sd]"); if (!el) return;
      var a = el.getAttribute("data-sd"), k = el.getAttribute("data-sdk");
      var ik = INFO;   // buttons inside the details window act on the item it shows
      if (a === "info") { var tb = el.classList.contains("sd-bub") && !el.classList.contains("sd-insph"); if (TAPO && tb) act(k, "orbit"); else if (TAPN && tb) nomToggle(k); else openInfo(k); }
      else if (a === "catorb" && el.getAttribute("data-goal")) { var cg = goalOf(el.getAttribute("data-goal")); if (cg) orbitMany(visible().filter(function (r) { return (r.goals || []).indexOf(cg.id) >= 0; }).map(function (r) { return r.id; }), cg.name); }
      else if (a === "gtog") { var tk = RV && !$("sdRv").hidden && RV.i < RV.ids.length ? RV.ids[RV.i] : ik; if (!tk || !H.goalToggle) return; var gon = H.goalToggle(tk, el.getAttribute("data-goal")); pull(); render(); if (RV && !$("sdRv").hidden) rvRender(); else if (GSET && BY[tk]) gsRender(); else if (BY[tk]) openInfo(tk); var gt = goalOf(el.getAttribute("data-goal")); toast((gon ? BY[tk].name + " now serves " : BY[tk].name + " no longer serves ") + (gt ? gt.name : "that goal"), false); }
      else if (a === "gnew" || a === "gnewfor") {
        if (!H.goalAdd) return; var nn = prompt("New goal — what are these apps for? (e.g. Pass JLPT N2, Grow at Persol)", ""); if (!nn || !nn.trim()) return;
        var nid = H.goalAdd(nn), fk = a === "gnewfor" ? (RV && !$("sdRv").hidden && RV.i < RV.ids.length ? RV.ids[RV.i] : ik) : null;
        if (fk && nid && H.goalToggle && (BY[fk].goals || []).indexOf(nid) < 0) H.goalToggle(fk, nid);
        pull(); render(); if (fk) { if (RV && !$("sdRv").hidden) rvRender(); else if (GSET) gsRender(); else openInfo(fk); }
        toast(fk ? BY[fk].name + " now serves " + nn.trim() : "Goal added: " + nn.trim(), false);
      }
      else if (a === "gset") { if (INFO && BY[INFO]) gsRender(); }
      else if (a === "gdim") { var dk = INFO; if (!dk || !BY[dk] || !H.appDim) return; var dOn = !BY[dk].gdim; H.appDim(dk, dOn); pull(); render(); openInfo(dk); toast(BY[dk].name + (dOn ? " marked inactive: dimmed in its goals" : " is active again"), false); }
      else if (a === "gloff") { if (!GP || !H.goalLinkOff) return; var og = goalOf(GP.gid), ol = og && (og.links || []).filter(function (l) { return l.id === el.getAttribute("data-lid"); })[0]; if (!ol) return;
        H.goalLinkOff(GP.gid, ol.id, !ol.off); pull(); render(); gpRender(false); toast(ol.t + (ol.off ? " is active again" : " marked inactive"), false); }
      else if (a === "glead") { var lk = INFO, lgid = el.getAttribute("data-goal"), lg0 = goalOf(lgid); if (!lk || !BY[lk] || !lg0 || !H.goalLeadSet) return;
        var was = lg0.lead === lk, prev = lg0.lead && BY[lg0.lead] ? BY[lg0.lead].name : ""; H.goalLeadSet(lgid, was ? "" : lk); pull(); render(); openInfo(lk);
        toast(was ? BY[lk].name + " is no longer the lead for " + lg0.name : BY[lk].name + " now leads " + lg0.name + (prev ? " (was " + prev + ")" : ""), false); }
      else if (a === "gsback") { if (INFO && BY[INFO]) openInfo(INFO); }
      else if (a === "gpick") gpOpen(el.getAttribute("data-goal"));
      else if (a === "appnew") openNewApp(el.getAttribute("data-goal"));
      else if (a === "gldel") { if (!GP || !H.goalLinkDel) return; H.goalLinkDel(GP.gid, el.getAttribute("data-lid")); pull(); render(); gpRender(false); toast("Link removed", false); }
      else if (a === "gpchat") { if (!GP || !H.chats) return; var ch = H.chats().filter(function (c) { return c.id === el.getAttribute("data-cid"); })[0]; if (!ch) return;
        var cg = goalOf(GP.gid), hv = (cg && cg.links || []).filter(function (l) { return l.url === ch.url || l.cid === ch.id; })[0];
        if (hv) H.goalLinkDel(GP.gid, hv.id); else H.goalLinkAdd(GP.gid, ch.url, ch.t, ch.id); pull(); render(); gpRender(false); }
      else if (a === "gptog") { if (!GP || !H.goalToggle) return; H.goalToggle(k, GP.gid); pull(); render(); gpRender(false); }
      else if (a === "gedit") {
        var eg = goalOf(el.getAttribute("data-goal")); if (!eg) return;
        var en = prompt("Rename the goal (clear the name to delete it)", eg.name); if (en === null) return;
        if (!en.trim()) { if (confirm("Delete the goal “" + eg.name + "”? Its apps stay; only the tag goes.")) { H.goalDelete(eg.id); pull(); render(); toast("Goal deleted", false); } return; }
        H.goalRename(eg.id, en); pull(); render(); toast("Goal renamed", false);
      }
      else if (a === "catorb") { var g = el.getAttribute("data-g"); orbitMany(visible().filter(function (r) { return r.group === g; }).map(function (r) { return r.id; }), g); }
      else if (a === "infoclose") closeInfo();
      else if (a === "add") { closeInfo(); act(ik, "add"); }
      else if (a === "slot") { closeInfo(); act(ik, "slot", +el.getAttribute("data-i")); }
      else if (a === "orbit") { closeInfo(); act(ik, "orbit"); }
      else if (a === "card") { closeInfo(); if (H.openCard) H.openCard(ik); }
      else if (a === "back") { if (k) act(k, "back"); else { closeInfo(); act(ik, "back"); } }
      else if (a === "lgup") { var fi = $("sdLogoFile"); if (fi) { fi.value = ""; fi.click(); } }
      else if (a === "lgemo") { var le = $("sdLemo"), op = le.hidden; le.hidden = !op; el.setAttribute("aria-expanded", op ? "true" : "false"); if (op) $("sdEmo").focus(); }
      else if (a === "lgemosave") { var ev = $("sdEmo").value; logoRun(function (kk) { return H.logo.emoji(kk, ev); }, "Emoji saved."); }
      else if (a === "lgsite") logoRun(function (kk) { return H.logo.site(kk); }, "Back to the site's icon. It shows once the store has fetched it.");
      else if (a === "rvopen") rvOpen();
      else if (a === "nom") { var nk = ik; nomToggle(nk); if (BY[nk]) openInfo(nk); }
      else if (a === "rvnom") { if (RV && RV.i < RV.ids.length) { nomToggle(RV.ids[RV.i]); rvRender(); } }
      else if (a === "dbopen") dbOpen();
      else if (a === "chipnom") nomToggle(k);
      else if (a === "dbtask") { closeInfo(); if (H.openCard) H.openCard(k); }
      else if (a === "dbunnom") { nomToggle(k); dbOpen(); }
      else if (a === "dbclaude") dbClaude();
      else if (a === "dbcopy") copyText(dbText(200)).then(function (ok) { toast(ok ? "Copied. Paste it into a Claude chat" : "Couldn\u2019t copy on this device", false); });
      else if (a === "rvin") rvDecide("in");
      else if (a === "rvout") rvDecide("out");
      else if (a === "rvskip") rvDecide("skip");
      else if (a === "rvback") rvBack();
      else if (a === "rvagain") { RV.ids = rvQueue(); RV.i = 0; RV.log = []; rvRender(); }
      else if (a === "rvclose") rvClose();
      else if (a === "undo") undo();
      else if (a === "core" && H.openCore) H.openCore();
    });
    root.addEventListener("keydown", function (e) {
      if (RV) {
        if (e.target.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
        var rk = { ArrowRight: "in", ArrowLeft: "out", ArrowDown: "skip" }[e.key];
        if (rk) { e.preventDefault(); rvDecide(rk); }
        else if (e.key === "Backspace") { e.preventDefault(); rvBack(); }
        else if ((e.key === "n" || e.key === "N") && RV.i < RV.ids.length) { e.preventDefault(); nomToggle(RV.ids[RV.i]); rvRender(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); rvClose(); }
        return;
      }
      if (e.key === "Escape" && INFO) { e.stopPropagation(); closeInfo(); return; }
      if (e.key === "Enter" && e.target.id === "sdEmo") { e.preventDefault(); var ev = e.target.value; logoRun(function (kk) { return H.logo.emoji(kk, ev); }, "Emoji saved."); return; }
      var c = e.target.closest && e.target.closest(".sd-bub[data-sdk]"); if (!c) return;
      var k = c.getAttribute("data-sdk");
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInfo(k); return; }
      else if (/^[1-9]$/.test(e.key) && +e.key <= H.max) act(k, "slot", +e.key - 1);
      else if (e.key === "o" || e.key === "O") act(k, "orbit");
      else return;
      var next = root.querySelector(".sd-bub[data-sdk]"); if (next) next.focus();
    });
    root.addEventListener("change", function (e) {
      if (e.target.id !== "sdLogoFile" || !e.target.files || !e.target.files[0]) return;
      var f = e.target.files[0]; logoRun(function (kk) { return H.logo.upload(kk, f); }, "Logo saved. Your other apps show it too.");
    });
    root.addEventListener("error", function (e) {
      var t = e.target; if (!t || t.tagName !== "IMG") return;
      var host = t.parentNode; t.remove(); if (host && host.classList) host.classList.add("sd-noimg");
    }, true);
    $("sdUndo").addEventListener("click", undo);
    root.addEventListener("submit", function (e) {
      var fm = e.target.getAttribute("data-sdform");
      if (!fm) return;
      e.preventDefault();
      if (fm === "glink") gpLinkAdd();
      else if (fm === "idea") ideaAdd();
      else if (fm === "appnew") saveNewApp(e.target);
    });
    root.addEventListener("toggle", function (e) { if (e.target.classList && e.target.classList.contains("sd-db-idea")) { DB_IDEA_OPEN = e.target.open; if (e.target.open) { var n = $("sdIdeaN"); if (n) n.focus(); } } }, true);
    rvWire();
    $("sdAuto").addEventListener("click", function () {
      var picks = sorted(ROWS.filter(function (r) { return !where(r.id); })).slice(0, H.max - ST.five.length);
      picks.forEach(function (it, j) { setTimeout(function () { if (isOpen) act(it.id, "add"); }, reduce ? 0 : j * 220); });
    });
    $("sdSeg").addEventListener("click", function (e) { var b = e.target.closest("button[data-kind]"); if (!b) return; kindF = b.getAttribute("data-kind"); renderPool(); });
    $("sdSort").addEventListener("change", function () { sortBy = this.value; savePref(); renderPool(); });
    $("sdQ").addEventListener("input", function () { q = this.value.trim().toLowerCase(); renderPool(); });
    $("sdGrp").addEventListener("change", function () { GRP = this.value; GROUP = GRP !== "none"; savePref(); renderPool(); });
    $("sdTapN").addEventListener("click", function () { TAPN = !TAPN; if (TAPN) TAPO = false; savePref(); renderPool(); toast(TAPN ? "Tap a bubble to star it for the Five. Tap the switch again for details." : "Tap a bubble for its details", false); });
    $("sdTapO").addEventListener("click", function () { TAPO = !TAPO; if (TAPO) TAPN = false; savePref(); renderPool(); toast(TAPO ? "Tap a bubble to send it to orbit. Tap the switch again for details." : "Tap a bubble for its details", false); });
    $("sdMore").addEventListener("click", function () {   // v114: on phones the search / group / sort row folds away
      var bar = this.closest(".sd-bar"), on = !bar.classList.contains("sd-tools-open");
      bar.classList.toggle("sd-tools-open", on); this.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) { var qi = $("sdQ"); if (qi) qi.focus({ preventScroll: true }); }
    });
    $("sdHudGo").addEventListener("click", function () { $("sdSphere").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); });
    if ("IntersectionObserver" in window) io = new IntersectionObserver(function (es) { $("sdHud").hidden = !isOpen || es[0].isIntersecting; }, { threshold: 0.15 });

    root.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      var src = e.target.closest("[data-sdk]"); if (!src || src.closest(".sd-chip") || src.closest(".sd-info") || src.closest(".sd-rv")) return;
      drag = { k: src.getAttribute("data-sdk"), src: src, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, touch: e.pointerType === "touch" };
      if (drag.touch) drag.timer = setTimeout(function () { if (drag) start(); }, 280);
    });
    document.addEventListener("pointermove", function (e) {
      if (!drag) return; drag.x = e.clientX; drag.y = e.clientY;
      var d = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
      if (!drag.on) { if (drag.touch) { if (d > 8) { clearTimeout(drag.timer); drag = null; } return; } if (d > 6) start(); else return; }
      moveGhost();
      var t = targetAt(drag.x, drag.y); if (t !== overEl) { if (overEl) overEl.classList.remove("sd-over"); overEl = t; if (t) t.classList.add("sd-over"); }
    });
    document.addEventListener("pointerup", function () { end(true); });
    document.addEventListener("pointercancel", function () { end(false); });
    document.addEventListener("touchmove", function (e) { if (drag && drag.on) e.preventDefault(); }, { passive: false });
    root.addEventListener("contextmenu", function (e) { if (drag) e.preventDefault(); });
  }
  function start() {
    drag.on = true; clearTimeout(drag.timer);
    var it = BY[drag.k]; if (!it) { drag = null; return; }
    var g = document.createElement("div"); g.className = "sd-ghost"; g.textContent = it.name; g.style.setProperty("--kc", KIND[it.kind].c);
    root.appendChild(g); drag.g = g; drag.src.classList.add("sd-dragging"); moveGhost();
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (x) {}
  }
  function moveGhost() { drag.g.style.transform = "translate(" + (drag.x + 12) + "px," + (drag.y - 18) + "px)"; }
  function targetAt(x, y) { var el = document.elementFromPoint(x, y); return el && root.contains(el) ? el.closest("[data-sddrop]") : null; }
  function end(drop) {
    if (!drag) return; clearTimeout(drag.timer);
    var d = drag; drag = null;
    if (d.on) {
      suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
      if (overEl) overEl.classList.remove("sd-over");
      var t = drop ? targetAt(d.x, d.y) : null;
      d.g.remove(); d.src.classList.remove("sd-dragging");
      if (t) { var kind = t.getAttribute("data-sddrop"); if (kind === "goal") goalDrop(d.k, t.getAttribute("data-goal")); else if (kind === "slot") act(d.k, "slot", +t.getAttribute("data-i")); else if (kind === "orbit") act(d.k, "orbit"); else if (kind === "pool") act(d.k, "back"); else if (kind === "center") act(d.k, "center"); }
      else if (pendingRefresh) { pendingRefresh = false; render(); }
    }
    overEl = null;
  }

  /* ---------------- open / close ---------------- */
  var pendingRefresh = false;
  function open(host, container) {
    H = host; if (!root) build(container);
    hist = [];
    root.hidden = false; isOpen = true;
    render(); lastFull = ST.five.length === H.max; $("sdSphere").classList.toggle("sd-lit", lastFull);
    if (io) io.observe($("sdSphere"));
  }
  function close() {
    if (!isOpen) return;
    closeInfo(); if (RV) { RV = null; $("sdRv").hidden = true; } isOpen = false; root.hidden = true; $("sdToast").hidden = true; $("sdHud").hidden = true;
    if (io) io.disconnect();
  }
  function refresh() { if (!isOpen) return; if (drag && drag.on) { pendingRefresh = true; return; } render(); checkIgnite(); if (RV && !rvDrag) rvRender(); }

  window.WFSphereDraft = { open: open, close: close, isOpen: function () { return isOpen; }, refresh: refresh };
})();
