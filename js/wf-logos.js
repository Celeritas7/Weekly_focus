/* ============================================================
   Weekly Focus v109 — app logos
   Source of truth: Akatsuki's shared store (hub migration R038):
     view  akatsuki_app_logos  (app_key, name, home_url, logo_url, logo_source, emoji, …)
     RPC   akatsuki_app_identity_upsert(p jsonb)   — WF seeds a row per app (name, home_url)
     edge  akatsuki-logo-sync                       — copies each hosted app's icon into the store
   Until R038 is live (or for an app the store has no logo for), the icon is read from the
   app's own GitHub Pages site and remembered on this device for a week.
   This file only reads and seeds; it never uploads images.
   ============================================================ */
(function () {
  "use strict";
  var VIEW = "akatsuki_app_logos", RPC = "akatsuki_app_identity_upsert", SYNC = "akatsuki-logo-sync";
  var SITE_KEY = "wf_logo_site_v1", SEED_KEY = "wf_logo_seed_v2", WEEK = 7 * 864e5, DAY = 864e5;
  var STORE = {}, storeState = "unknown", storeAt = 0, SITE = {}, pending = {}, subs = [], seeding = false;
  try { SITE = JSON.parse(localStorage.getItem(SITE_KEY) || "{}") || {}; } catch (e) { SITE = {}; }
  function saveSite() { try { localStorage.setItem(SITE_KEY, JSON.stringify(SITE)); } catch (e) {} }
  function changed() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }

  /* ---- keys: Akatsuki's rule. Hosted: the Pages repo name, lower-cased. Others: a slug of the name. ---- */
  var PAGES = /^https:\/\/([a-z0-9-]+)\.github\.io\/([^\/?#]+)/i;
  function homeOf(links) {
    var l = (Array.isArray(links) ? links : []).map(function (x) { return x && x.url; }).filter(function (u) { return u && PAGES.test(u); })[0];
    if (!l) return "";
    var m = PAGES.exec(l); return "https://" + m[1].toLowerCase() + ".github.io/" + m[2] + "/";
  }
  function slug(s) { s = String(s || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^[_-]+|[_-]+$/g, ""); if (s.length < 2) s = (s + "app").slice(0, 3); return s.slice(0, 64); }
  function keyFor(item) {
    var h = homeOf(item && item.links);
    if (h) return slug(PAGES.exec(h)[2]);
    return slug(item && item.name);
  }

  /* ---- store ---- */
  function client() { return window.__wfSb || null; }
  function loadStore(force) {
    var sb = client();
    if (!sb || storeState === "missing" || storeState === "loading") return Promise.resolve();
    if (!force && storeState === "ok" && Date.now() - storeAt < 10 * 60e3) return Promise.resolve();
    storeState = "loading";
    return sb.from(VIEW).select("app_key,name,home_url,logo_url,logo_source,emoji").then(function (r) {
      if (r.error) {   // R038 not live yet → use live sites; anything else → try again later
        var c = String(r.error.code || ""), m = String(r.error.message || "");
        storeState = (c === "42P01" || c === "PGRST205" || /does not exist|could not find/i.test(m)) ? "missing" : "unknown";
        return;
      }
      var next = {}; (r.data || []).forEach(function (row) { next[row.app_key] = row; });
      STORE = next; storeState = "ok"; storeAt = Date.now(); changed();
    }, function () { storeState = "unknown"; });
  }

  /* ---- seeding: send each app (name + home_url) once; after that only apps that are new or changed.
     The sent set is remembered per device, so a board that grows later is still seeded. ---- */
  function seed(items) {
    var sb = client(); if (!sb || storeState !== "ok" || seeding) return;
    var sent = {}; try { sent = JSON.parse(localStorage.getItem(SEED_KEY) || "{}") || {}; } catch (e) { sent = {}; }
    var by = {};
    (items || []).forEach(function (it) {
      var k = keyFor(it); if (!k || by[k]) return;
      var row = { app_key: k, name: it.name }, h = homeOf(it.links); if (h) row.home_url = h;
      by[k] = row;
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).filter(function (r) { return sent[r.app_key] !== r.name + "|" + (r.home_url || ""); });
    if (!rows.length) return;
    seeding = true;
    var batches = []; for (var i = 0; i < rows.length; i += 100) batches.push(rows.slice(i, i + 100));
    var toSync = [];
    batches.reduce(function (p, b) {
      return p.then(function () {
        return sb.rpc(RPC, { p: b }).then(function (r) {
          if (r.error) throw r.error;
          (r.data || []).forEach(function (x) {
            var row = x && by[x.app_key]; if (!row) return;
            sent[x.app_key] = row.name + "|" + (row.home_url || "");   // refused rows (the app owns its own name/home) are not retried on every load either
            if ((x.status === "created" || x.status === "updated") && row.home_url) toSync.push(x.app_key);
          });
        });
      });
    }, Promise.resolve()).then(function () {
      try { localStorage.setItem(SEED_KEY, JSON.stringify(sent)); } catch (e) {}
      if (toSync.length && sb.functions && sb.functions.invoke) return sb.functions.invoke(SYNC, { body: { app_keys: toSync } }).then(function () { return loadStore(true); }, function () {});
      if (rows.length) return loadStore(true);
    }).catch(function (e) { console.warn("[wf] logos: seeding the Akatsuki store failed", e && (e.message || e)); })
      .then(function () { seeding = false; });
  }

  /* ---- live-site fallback: apple-touch-icon → largest manifest icon ≤ 512 → rel=icon ---- */
  function pick(doc, base) {
    function abs(h) { try { return new URL(h, base).href; } catch (e) { return ""; } }
    var a = doc.querySelector('link[rel~="apple-touch-icon"][href]'); if (a) return Promise.resolve(abs(a.getAttribute("href")));
    var mf = doc.querySelector('link[rel="manifest"][href]'), ic = doc.querySelector('link[rel~="icon"][href]');
    var iconHref = ic ? abs(ic.getAttribute("href")) : "";
    if (!mf) return Promise.resolve(iconHref);
    var murl = abs(mf.getAttribute("href"));
    return fetch(murl, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      var best = "", bestN = 0;
      ((m && m.icons) || []).forEach(function (i) {
        var n = Math.max.apply(null, String(i.sizes || "0").split(/\s+/).map(function (s) { return parseInt(s, 10) || 0; }));
        if (/svg/i.test(i.type || i.src || "")) return;
        if (n <= 512 && n > bestN) { bestN = n; best = new URL(i.src, murl).href; }
      });
      return best || iconHref;
    }, function () { return iconHref; });
  }
  function fromSite(key, home) {
    var c = SITE[key];
    if (c && Date.now() - c.at < (c.u ? WEEK : DAY)) return;
    if (pending[key]) return; pending[key] = true;
    fetch(home, { credentials: "omit" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (html) {
      if (!html) return "";
      return pick(new DOMParser().parseFromString(html, "text/html"), home);
    }).then(function (u) { SITE[key] = { u: u || "", at: Date.now() }; saveSite(); if (u) changed(); }, function () { SITE[key] = { u: "", at: Date.now() }; saveSite(); })
      .then(function () { delete pending[key]; });
  }

  /* ---- public: logo for one item → { url } | { emoji } | null ---- */
  function logoFor(item) {
    if (!item) return null;
    var k = keyFor(item), s = STORE[k];
    if (s) {
      if (s.logo_source === "emoji" && s.emoji) return { emoji: s.emoji, key: k };
      if (s.logo_url) return { url: s.logo_url, key: k };
    }
    var h = homeOf(item.links);
    if (h) { var c = SITE[k]; if (c && c.u) return { url: c.u, key: k }; if (navigator.onLine !== false) fromSite(k, h); }
    return null;
  }
  /* call when the board is ready: reads the store, then seeds it (once a day) with every app */
  function refresh(allApps) { loadStore(false).then(function () { seed(allApps); }); }

  window.WFLogos = { keyFor: keyFor, logoFor: logoFor, refresh: refresh, onChange: function (f) { subs.push(f); }, state: function () { return storeState; } };
})();
