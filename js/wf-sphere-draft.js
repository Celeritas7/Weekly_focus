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
  function short(name) { var w = String(name).replace(/[_\-]+/g, " ").trim().split(/\s+/)[0] || ""; return w.length > 8 ? w.slice(0, 7) + "…" : w; }
  /* v109: what sits inside a planet. Logo → the image (name kept as a hidden fallback if it fails to load); emoji; else the name itself */
  function face(it, mode) {
    var L = it.logo, nm = mode === "planet" ? it.name : mode === "moon" ? short(it.name) : mono(it.name);
    var txt = '<span class="sd-face-name">' + esc(nm) + '</span>';
    if (L && L.url) return '<img class="sd-face-img" src="' + esc(L.url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' + txt.replace('sd-face-name"', 'sd-face-name sd-alt"');
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
              '<div class="sd-tools"><input id="sdQ" type="search" placeholder="Find…" autocomplete="off" aria-label="Find"><button type="button" class="sd-tog" id="sdGrp">By category</button>' +
              '<select id="sdSort" aria-label="Sort"><option value="pri">Priority first</option><option value="open">Most open tasks</option><option value="stale">Longest untouched</option><option value="az">A–Z</option></select></div></div>' +
            '<div class="sd-grid" id="sdGrid"></div>' +
          '</section>' +
        '</div>' +
        '<details class="sd-howto"><summary>How to play</summary><p>Tap a card to pull it in. Drag it onto a number to rank it, or onto the dashed ring to keep it in orbit. Tap a planet to send it back. On a phone, press and hold to drag. Keys on a focused card: <kbd>Enter</kbd> pull in, <kbd>1</kbd>–<kbd>5</kbd> rank, <kbd>O</kbd> orbit. <kbd>Esc</kbd> closes.</p></details>' +
      '</div>' +
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
        el.type = "button"; el.setAttribute("data-sdk", k); el.setAttribute("data-sd", "back"); el.style.setProperty("--kc", KIND[it.kind].c);
        el.setAttribute("aria-label", "Target " + (i + 1) + ": " + it.name + ". Send back to the table");
        el.title = it.name; el.innerHTML = '<span class="sd-rk">' + (i + 1) + '</span>' + face(it, "planet");
      } else { el.setAttribute("aria-label", "Empty target slot " + (i + 1)); el.textContent = i + 1; }
      sp.appendChild(el);
    }
    var n = ST.orbit.length, gaps = [36, 108, 180, 252, 324];
    ST.orbit.forEach(function (k, j) {
      var it = BY[k], m = document.createElement("button");
      m.type = "button"; m.className = "sd-moon" + (landing === k ? " sd-landed" : "");
      m.setAttribute("data-sdk", k); m.setAttribute("data-sd", "back"); m.setAttribute("data-sddrop", "orbit");
      m.style.setProperty("--kc", KIND[it.kind].c); m.setAttribute("aria-label", "In orbit: " + it.name + ". Send back to the table"); m.title = it.name;
      m.innerHTML = face(it, "moon"); pos(m, n <= 5 ? gaps[j] : 18 + j * 360 / n, 47);
      sp.appendChild(m);
    });
    $("sdCoreN").innerHTML = ST.five.length + "<small>/" + MAX + "</small>";
    $("sdCoreL").textContent = ST.five.length === MAX ? "Your Five are set" : "targets set";
    /* v108: Akatsuki is the core. While it has open tasks the centre becomes its red moon; otherwise the count shows */
    var c = H.core ? H.core() : null, cm = $("sdCoreMoon"), on = !!(c && c.open);
    sp.classList.toggle("sd-has-core", on); cm.hidden = !on;
    if (on) {
      cm.setAttribute("aria-label", c.name + ", core of the sphere: " + c.open + " open. Open it");
      cm.innerHTML = (c.logo && c.logo.url ? '<span class="sd-cm-logo"><img src="' + esc(c.logo.url) + '" alt="" referrerpolicy="no-referrer"></span>' : c.logo && c.logo.emoji ? '<span class="sd-cm-logo sd-cm-emo">' + esc(c.logo.emoji) + '</span>' : '<span class="sd-cm-k">Core</span>') + '<span class="sd-cm-n">' + esc(c.name) + '</span><span class="sd-cm-o">' + c.open + ' open</span>' + (c.next ? '<span class="sd-cm-x">' + esc(c.next) + '</span>' : '');
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
  function cardHtml(it) {
    var p = PRI[it.pri] || PRI[""], pct = it.total ? Math.round(it.done / it.total * 100) : 0;
    return '<div class="sd-card" role="button" tabindex="0" data-sdk="' + esc(it.id) + '" data-sd="toggle" style="--kc:' + KIND[it.kind].c + ';--pc:' + p.c + '" aria-label="Pull ' + esc(it.name) + ' into the sphere">' +
      '<div class="sd-c-top"><span class="sd-c-kind">' + KIND[it.kind].l + (GROUP ? '' : ' <span>· ' + esc(it.group) + '</span>') + '</span>' + (p.l ? '<span class="sd-c-pri">' + p.l + '</span>' : '') + '</div>' +
      '<div class="sd-c-name">' + (it.logo && it.logo.url ? '<img class="sd-c-logo" src="' + esc(it.logo.url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : it.logo && it.logo.emoji ? '<span class="sd-c-logo sd-c-emo">' + esc(it.logo.emoji) + '</span>' : '') + '<span>' + esc(it.name) + '</span></div>' +
      (it.next ? '<div class="sd-c-next">Next: ' + esc(it.next) + '</div>' : '<div class="sd-c-next sd-none">No open subtasks</div>') +
      '<div class="sd-c-foot">' + (it.total ? '<span class="sd-c-bar"><i style="width:' + pct + '%"></i></span><span>' + it.done + '/' + it.total + '</span>' : '<span class="sd-c-bar"></span><span>—</span>') +
      '<span class="sd-c-age' + (it.age != null && it.age >= 14 ? " sd-stale" : "") + '" title="Last touched">' + ageTxt(it.age) + '</span></div></div>';
  }
  function groupedHtml(list) {
    var order = [], by = {};
    list.forEach(function (it) { if (!by[it.group]) { by[it.group] = []; order.push(it.group); } by[it.group].push(it); });
    if (sortBy === "az") order.sort(function (a, b) { return a.localeCompare(b); });
    return order.map(function (g) {
      return '<section class="sd-cat" style="--cc:' + catCol(g) + '" aria-label="' + esc(g) + '"><h3 class="sd-cat-h"><i></i>' + esc(g) + ' <span>' + by[g].length + '</span></h3><div class="sd-cards">' + by[g].map(cardHtml).join("") + '</div></section>';
    }).join("");
  }
  function renderPool() {
    var left = ROWS.filter(function (r) { return !where(r.id); });
    var list = sorted(left.filter(function (it) { return (kindF === "all" || it.kind === kindF) && (!q || (it.name + " " + it.group).toLowerCase().indexOf(q) >= 0); }));
    $("sdGrid").innerHTML = !list.length
      ? '<div class="sd-empty-pool">' + (q || kindF !== "all" ? "Nothing matches. Clear the search or pick another filter." : ROWS.length ? "Everything is in the sphere. Tap a planet to send it back." : "No active items yet. Switch on an app or topic on the board first.") + '</div>'
      : GROUP ? groupedHtml(list) : '<div class="sd-cards">' + list.map(cardHtml).join("") + '</div>';
    root.querySelectorAll("#sdSeg button").forEach(function (b) {
      var kd = b.getAttribute("data-kind"), n = kd === "all" ? left.length : left.filter(function (x) { return x.kind === kd; }).length;
      b.textContent = (kd === "all" ? "All" : kd === "app" ? "Apps" : KIND[kd].l) + " " + n; b.setAttribute("aria-pressed", kindF === kd ? "true" : "false");
    });
    $("sdGrp").setAttribute("aria-pressed", GROUP ? "true" : "false");
    $("sdSort").value = sortBy;
    $("sdT5").textContent = ST.five.length + "/" + H.max; $("sdTO").textContent = ST.orbit.length; $("sdTP").textContent = left.length;
  }
  function renderHud() {
    var d = ""; for (var i = 0; i < H.max; i++) { var k = ST.five[i], it = k && BY[k]; d += it ? '<i class="sd-on" style="--kc:' + KIND[it.kind].c + '">' + (it.logo && it.logo.url ? '<img src="' + esc(it.logo.url) + '" alt="" referrerpolicy="no-referrer">' : it.logo && it.logo.emoji ? esc(it.logo.emoji) : esc(mono(it.name))) + '</i>' : '<i>' + (i + 1) + '</i>'; }
    $("sdHudDots").innerHTML = d; $("sdHudO").textContent = ST.five.length + "/" + H.max + " · orbit " + ST.orbit.length;
  }
  function render(landing) { pull(); renderSphere(landing); renderLoad(); renderPool(); renderHud(); }

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

  /* ---------------- moves ---------------- */
  function act(k, how, i) {
    if (!BY[k]) return;
    var src = root.querySelector('.sd-card[data-sdk="' + sel(k) + '"]'), from = src ? src.getBoundingClientRect() : null;
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
      if (a === "toggle") act(k, where(k) ? "back" : "add");
      else if (a === "back") act(k, "back");
      else if (a === "undo") undo();
      else if (a === "close") close();
      else if (a === "core" && H.openCore) H.openCore();
    });
    root.addEventListener("keydown", function (e) {
      var c = e.target.closest && e.target.closest(".sd-card[data-sdk]"); if (!c) return;
      var k = c.getAttribute("data-sdk");
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(k, "add"); }
      else if (/^[1-9]$/.test(e.key) && +e.key <= H.max) act(k, "slot", +e.key - 1);
      else if (e.key === "o" || e.key === "O") act(k, "orbit");
      else return;
      var next = root.querySelector(".sd-card[data-sdk]"); if (next) next.focus();
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
    $("sdHudGo").addEventListener("click", function () { $("sdSphere").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); });
    if ("IntersectionObserver" in window) io = new IntersectionObserver(function (es) { $("sdHud").hidden = es[0].isIntersecting; }, { root: root, threshold: 0.15 });

    root.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      var src = e.target.closest("[data-sdk]"); if (!src || src.classList.contains("sd-chip")) return;
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
    isOpen = false; root.hidden = true; $("sdToast").hidden = true; document.documentElement.classList.remove("sd-lock");
    if (io) io.disconnect();
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  function refresh() { if (!isOpen) return; if (drag && drag.on) { pendingRefresh = true; return; } render(); checkIgnite(); }

  window.WFSphereDraft = { open: open, close: close, isOpen: function () { return isOpen; }, refresh: refresh };
})();
