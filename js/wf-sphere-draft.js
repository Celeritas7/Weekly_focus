/* ============================================================
   Weekly Focus v107 — Sphere Draft
   The game-style "Add to sphere". Opened by openPicker() in
   weekly-focus-app.js, which passes SD_HOST: the only moves this
   file can make (add / place / orbit / back / restore). This file
   draws and animates; it never touches data directly.
   ============================================================ */
(function () {
  "use strict";
  var H = null, root = null, isOpen = false, hist = [], kindF = "all", sortBy = "pri", q = "", GROUP = true, lastFull = false, io = null;
  var BY = {}, ROWS = [];
  var PREF = "wf_sd_prefs";
  try { var pf = JSON.parse(localStorage.getItem(PREF) || "{}"); if (pf.group === false) GROUP = false; if (pf.sort) sortBy = pf.sort; } catch (e) {}
  function savePref() { try { localStorage.setItem(PREF, JSON.stringify({ group: GROUP, sort: sortBy })); } catch (e) {} }

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
  function build() {
    root = document.createElement("div"); root.className = "sd"; root.id = "sphereDraft"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Sphere Draft");
    root.innerHTML =
      '<div class="sd-hud" id="sdHud" hidden><button type="button" class="sd-hud-go" id="sdHudGo" aria-label="Back to your sphere"><span class="sd-dots" id="sdHudDots"></span><span class="sd-o" id="sdHudO"></span></button><button type="button" class="sd-done" data-sd="close">Done</button></div>' +
      '<div class="sd-wrap">' +
        '<header class="sd-top"><div><div class="sd-eyebrow">This week</div><h2>Sphere Draft</h2>' +
          '<p class="sd-sub">Every active app, study topic and office task is on the table. Pull in only what earns a place this week.</p></div>' +
          '<div class="sd-right"><span class="sd-tally">The Five <b id="sdT5">0/5</b></span><span class="sd-tally">Orbit <b id="sdTO">0</b></span><span class="sd-tally">On the table <b id="sdTP">0</b></span>' +
          '<button type="button" class="sd-done" data-sd="close">Done</button></div></header>' +
        '<div class="sd-stage">' +
          '<section class="sd-orrery" aria-label="Your sphere">' +
            '<div class="sd-sphere" id="sdSphere"><div class="sd-orbit" data-sddrop="orbit"></div><div class="sd-disc" data-sddrop="center"></div>' +
              '<div class="sd-core"><div class="sd-n" id="sdCoreN">0<small>/5</small></div><div class="sd-l" id="sdCoreL">targets set</div></div>' +
              '<button type="button" class="sd-coremoon" id="sdCoreMoon" data-sd="core" hidden></button><canvas id="sdFx" aria-hidden="true"></canvas></div>' +
            '<div class="sd-load"><div class="sd-load-h"><span class="sd-t">Week load</span><span class="sd-v" id="sdLoadV">Light</span></div><div class="sd-segs" id="sdSegs" aria-hidden="true"></div><div class="sd-chips" id="sdChips"></div></div>' +
            '<div class="sd-actions"><button class="sd-btn sd-primary" id="sdAuto" type="button">Auto-fill the Five</button><button class="sd-btn" id="sdUndo" type="button" disabled>Undo</button></div>' +
          '</section>' +
          '<section class="sd-pool" id="sdPool" data-sddrop="pool" aria-label="Everything still on the table">' +
            '<div class="sd-bar"><div class="sd-seg" id="sdSeg" role="group" aria-label="Show"><button type="button" data-kind="all"></button><button type="button" data-kind="app"></button><button type="button" data-kind="study"></button><button type="button" data-kind="office"></button></div>' +
              '<button type="button" class="sd-more" id="sdMore" aria-expanded="false" aria-controls="sdTools" aria-label="Search, group and sort"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg><i class="sd-more-dot" aria-hidden="true"></i></button>' +
              '<div class="sd-tools" id="sdTools"><input id="sdQ" type="search" placeholder="Find…" autocomplete="off" aria-label="Find"><button type="button" class="sd-tog" id="sdGrp">By category</button>' +
              '<select id="sdSort" aria-label="Sort"><option value="pri">Priority first</option><option value="open">Most open tasks</option><option value="stale">Longest untouched</option><option value="az">A–Z</option></select></div></div>' +
            '<div class="sd-legend" aria-hidden="true"><span><i style="--pc:var(--pri-h)"></i>High</span><span><i style="--pc:var(--pri-m)"></i>Medium</span><span><i style="--pc:var(--pri-l)"></i>Low</span><span class="sd-legend-tip">Tap a bubble for details</span></div>' +
            '<div class="sd-grid" id="sdGrid"></div>' +
          '</section>' +
        '</div>' +
        '<details class="sd-howto"><summary>How to play</summary><p>Tap a bubble to read its details and add it in one tap. The ring colour is its priority. Drag a bubble onto a number to rank it, or onto the dashed ring for orbit; on a phone, press and hold to drag. Tap a planet to see it or send it back. Keys on a focused bubble: <kbd>Enter</kbd> details, <kbd>1</kbd>–<kbd>5</kbd> rank, <kbd>O</kbd> orbit. <kbd>Esc</kbd> closes.</p></details>' +
      '</div>' +
      '<div class="sd-info" id="sdInfo" data-sd="infoclose" hidden><div class="sd-info-card" id="sdInfoCard" data-sd="stay" role="dialog" aria-modal="true" aria-labelledby="sdInfoT"></div></div>' +
      '<div class="sd-toast" id="sdToast" role="status" hidden></div>';
    document.body.appendChild(root);
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
      m.innerHTML = face(it, "moon"); pos(m, n <= 5 ? gaps[j] : 18 + j * 360 / n, 47);
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
  var ORBIT_CAP = 3;
  function renderLoad() {
    var MAX = H.max, segs = "", i, over = Math.max(0, ST.orbit.length - ORBIT_CAP), slots = Math.max(ORBIT_CAP, ST.orbit.length);
    for (i = 0; i < MAX; i++) segs += '<i class="sd-five' + (i < ST.five.length ? " sd-on" : "") + '"></i>';
    segs += '<i class="sd-gap"></i>';
    for (i = 0; i < slots; i++) segs += '<i class="sd-orb' + (i < ST.orbit.length ? (i >= ORBIT_CAP ? " sd-overcap" : " sd-on") : "") + '"></i>';
    $("sdSegs").innerHTML = segs;
    var total = ST.five.length + ST.orbit.length, v = $("sdLoadV");
    v.className = "sd-v" + (over ? " sd-heavy" : "");
    v.textContent = over ? "Heavy · " + ST.orbit.length + " in orbit, drop " + over : total === 0 ? "Empty" : ST.five.length < MAX ? "Light · room for " + (MAX - ST.five.length) + " more" : ST.orbit.length ? "Balanced · " + ST.orbit.length + " in orbit" : "Focused";
    $("sdChips").innerHTML = ST.orbit.map(function (k) { return '<button type="button" class="sd-chip" data-sdk="' + esc(k) + '" data-sd="back" aria-label="Send ' + esc(BY[k].name) + ' back"><span>' + esc(BY[k].name) + '</span><em aria-hidden="true">×</em></button>'; }).join("");
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
    return '<button type="button" class="sd-bub" data-sdk="' + esc(it.id) + '" data-sd="info" style="--kc:' + KIND[it.kind].c + ';--pc:' + (p.l ? p.c : "var(--hair)") + '" title="' + esc(it.name) + '" aria-label="' + esc(it.name) + (p.l ? ", " + p.l + " priority" : "") + '. Show details">' +
      '<span class="sd-bub-c">' + inner + '</span>' + (L ? '<span class="sd-bub-l">' + esc(it.name) + '</span>' : '') + '</button>';
  }
  function groupedHtml(list) {
    var order = [], by = {};
    list.forEach(function (it) { if (!by[it.group]) { by[it.group] = []; order.push(it.group); } by[it.group].push(it); });
    if (sortBy === "az") order.sort(function (a, b) { return a.localeCompare(b); });
    return order.map(function (g) {
      return '<section class="sd-cat" style="--cc:' + catCol(g) + '" aria-label="' + esc(g) + '"><h3 class="sd-cat-h"><i></i>' + esc(g) + ' <span>' + by[g].length + '</span></h3><div class="sd-bubs">' + by[g].map(cardHtml).join("") + '</div></section>';
    }).join("");
  }
  function renderPool() {
    var left = ROWS.filter(function (r) { return !where(r.id); });
    var list = sorted(left.filter(function (it) { return (kindF === "all" || it.kind === kindF) && (!q || (it.name + " " + it.group).toLowerCase().indexOf(q) >= 0); }));
    $("sdGrid").innerHTML = !list.length
      ? '<div class="sd-empty-pool">' + (q || kindF !== "all" ? "Nothing matches. Clear the search or pick another filter." : ROWS.length ? "Everything is in the sphere. Tap a planet to send it back." : "No active items yet. Switch on an app or topic on the board first.") + '</div>'
      : GROUP ? groupedHtml(list) : '<div class="sd-bubs">' + list.map(cardHtml).join("") + '</div>';
    root.querySelectorAll("#sdSeg button").forEach(function (b) {
      var kd = b.getAttribute("data-kind"), n = kd === "all" ? left.length : left.filter(function (x) { return x.kind === kd; }).length;
      b.textContent = (kd === "all" ? "All" : kd === "app" ? "Apps" : KIND[kd].l) + " " + n; b.setAttribute("aria-pressed", kindF === kd ? "true" : "false");
    });
    $("sdGrp").setAttribute("aria-pressed", GROUP ? "true" : "false");
    $("sdSort").value = sortBy;
    $("sdMore").classList.toggle("sd-active", !!q || !GROUP || sortBy !== "pri");
    $("sdT5").textContent = ST.five.length + "/" + H.max; $("sdTO").textContent = ST.orbit.length; $("sdTP").textContent = left.length;
  }
  function renderHud() {
    var d = ""; for (var i = 0; i < H.max; i++) { var k = ST.five[i], it = k && BY[k]; d += it ? '<i class="sd-on" style="--kc:' + KIND[it.kind].c + '">' + (it.logo && it.logo.url ? '<img src="' + esc(it.logo.url) + '" alt="" referrerpolicy="no-referrer">' : it.logo && it.logo.emoji ? esc(it.logo.emoji) : esc(mono(it.name))) + '</i>' : '<i>' + (i + 1) + '</i>'; }
    $("sdHudDots").innerHTML = d; $("sdHudO").textContent = ST.five.length + "/" + H.max + " · orbit " + ST.orbit.length;
  }
  function render(landing) { pull(); renderSphere(landing); renderLoad(); renderPool(); renderHud(); }
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
    INFO = k; infoFrom = document.activeElement;
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
    if (!INFO) return; INFO = null; $("sdInfo").hidden = true;
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
  function undo() { if (!hist.length) return; H.restore(hist.pop()); render(); checkIgnite(); toast("Undone", false); }

  /* ---------------- input ---------------- */
  var drag = null, suppressClick = false, overEl = null;
  function wire() {
    root.addEventListener("click", function (e) {
      e.stopPropagation();   // keep the board's own click handlers out of the draft
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      var el = e.target.closest("[data-sd]"); if (!el) return;
      var a = el.getAttribute("data-sd"), k = el.getAttribute("data-sdk");
      var ik = INFO;   // buttons inside the details window act on the item it shows
      if (a === "info") openInfo(k);
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
      else if (a === "undo") undo();
      else if (a === "close") close();
      else if (a === "core" && H.openCore) H.openCore();
    });
    root.addEventListener("keydown", function (e) {
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
    $("sdAuto").addEventListener("click", function () {
      var picks = sorted(ROWS.filter(function (r) { return !where(r.id); })).slice(0, H.max - ST.five.length);
      picks.forEach(function (it, j) { setTimeout(function () { if (isOpen) act(it.id, "add"); }, reduce ? 0 : j * 220); });
    });
    $("sdSeg").addEventListener("click", function (e) { var b = e.target.closest("button[data-kind]"); if (!b) return; kindF = b.getAttribute("data-kind"); renderPool(); });
    $("sdSort").addEventListener("change", function () { sortBy = this.value; savePref(); renderPool(); });
    $("sdQ").addEventListener("input", function () { q = this.value.trim().toLowerCase(); renderPool(); });
    $("sdGrp").addEventListener("click", function () { GROUP = !GROUP; savePref(); renderPool(); });
    $("sdMore").addEventListener("click", function () {   // v114: on phones the search / group / sort row folds away
      var bar = this.closest(".sd-bar"), on = !bar.classList.contains("sd-tools-open");
      bar.classList.toggle("sd-tools-open", on); this.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) { var qi = $("sdQ"); if (qi) qi.focus({ preventScroll: true }); }
    });
    $("sdHudGo").addEventListener("click", function () { $("sdSphere").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); });
    if ("IntersectionObserver" in window) io = new IntersectionObserver(function (es) { $("sdHud").hidden = es[0].isIntersecting; }, { root: root, threshold: 0.15 });

    root.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      var src = e.target.closest("[data-sdk]"); if (!src || src.classList.contains("sd-chip") || src.closest(".sd-info")) return;
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
      if (t) { var kind = t.getAttribute("data-sddrop"); if (kind === "slot") act(d.k, "slot", +t.getAttribute("data-i")); else if (kind === "orbit") act(d.k, "orbit"); else if (kind === "pool") act(d.k, "back"); else if (kind === "center") act(d.k, "center"); }
      else if (pendingRefresh) { pendingRefresh = false; render(); }
    }
    overEl = null;
  }

  /* ---------------- open / close ---------------- */
  var pendingRefresh = false, lastFocus = null;
  function open(host) {
    H = host; if (!root) build();
    hist = []; lastFocus = document.activeElement;
    root.hidden = false; isOpen = true; document.documentElement.classList.add("sd-lock");
    root.scrollTop = 0; render(); lastFull = ST.five.length === H.max; $("sdSphere").classList.toggle("sd-lit", lastFull);
    if (io) io.observe($("sdSphere"));
    var first = root.querySelector(".sd-done"); if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen) return;
    closeInfo(); isOpen = false; root.hidden = true; $("sdToast").hidden = true; document.documentElement.classList.remove("sd-lock");
    if (io) io.disconnect();
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  function refresh() { if (!isOpen) return; if (drag && drag.on) { pendingRefresh = true; return; } render(); checkIgnite(); }

  window.WFSphereDraft = { open: open, close: close, isOpen: function () { return isOpen; }, refresh: refresh };
})();
