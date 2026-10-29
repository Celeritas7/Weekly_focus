/* Weekly Focus — v121 share page (share.html#<token>).
   Read-only, live view of one shared Code folder. No sign-in: the token is the key, and the database
   functions wf_code_shared_list / wf_code_shared_file return only what sits inside that shared folder.
   The token stays in the # part of the address, so it is never sent to a server in a request line or referrer. */
(function () {
  "use strict";
  var HL_LINES = 3000, HL_BYTES = 400 * 1024;
  var tok = decodeURIComponent((location.hash || "").replace(/^#/, "")).trim();
  var sb = null, LIST = [], BY = {}, ROOT = "", CUR = "", CODE = {}, loading = false, toastT = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(t) { var el = $("shToast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("on"); }, 2600); }
  function size(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; }
  function when(ms) { if (!ms) return ""; var d = new Date(+ms); return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toTimeString().slice(0, 5); }
  function safeName(n) { return String(n || "untitled").replace(/[\\\/:*?"<>|]+/g, "_").replace(/^\.+$/, "_"); }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }); }
  function kids(pid) { return LIST.filter(function (x) { return x.kind === "folder" && x.parent === pid && x.id !== pid; }).sort(byName); }
  function filesIn(fid) { return LIST.filter(function (x) { return x.kind === "file" && x.parent === fid; }).sort(byName); }
  function off(msg) {
    $("shTitle").textContent = "Link not available"; $("shSub").textContent = "";
    $("shTree").innerHTML = ""; $("shZip").disabled = true;
    $("shView").innerHTML = '<div class="empty">' + esc(msg) + '</div>';
  }

  /* ---- data ---- */
  function listNow() {
    if (loading) return Promise.resolve(); loading = true;
    return sb.rpc("wf_code_shared_list", { p_token: tok }).then(function (r) {
      loading = false;
      if (r.error) { off(/could not find|does not exist/i.test(r.error.message || "") ? "Sharing isn't set up on this database yet." : "Couldn't load the shared files. Try Refresh."); return; }
      var rows = r.data || [];
      if (!rows.length) { off("This link is switched off, or it doesn't exist. Ask for a new one."); return; }
      LIST = rows.map(function (x) { return { id: x.id, kind: x.kind, name: x.name || "untitled", parent: x.parent || "", lang: x.lang || "Text", size: x.size || 0, u: +x.u || 0 }; });
      ROOT = rows[0].root_id || "";
      BY = {}; LIST.forEach(function (x) { BY[x.id] = x; });
      LIST.forEach(function (x) { if (x.parent && !BY[x.parent] && x.id !== ROOT) x.parent = ROOT; });   // a file whose folder was deleted shows at the top, as in the app
      var top = ROOT ? BY[ROOT] : null;
      if (ROOT && !top) { off("This shared folder is empty or was deleted."); return; }
      if (top) top.parent = "\u0000";   // the shared folder is the top of this view
      var nf = LIST.filter(function (x) { return x.kind === "file"; }).length;
      $("shTitle").textContent = top ? top.name : "All code";
      $("shSub").textContent = nf + (nf === 1 ? " file" : " files") + " · read-only · live, updated " + new Date().toTimeString().slice(0, 5);
      document.title = (top ? top.name : "All code") + " · shared code";
      $("shZip").disabled = !nf;
      paintTree();
      if (CUR && !BY[CUR]) { CUR = ""; paintView(); }
      else if (CUR) openFile(CUR, true);
    }, function () { loading = false; off("Couldn't reach the server. Check your connection and try Refresh."); });
  }
  function fileCode(id) {
    var it = BY[id], c = CODE[id];
    if (c && it && c.u === it.u) return Promise.resolve(c.code);
    return sb.rpc("wf_code_shared_file", { p_token: tok, p_file_id: id }).then(function (r) {
      if (r.error || !r.data || !r.data.length) throw new Error("gone");
      var x = r.data[0]; CODE[id] = { u: +x.u || 0, code: x.code || "" }; return CODE[id].code;
    });
  }

  /* ---- tree ---- */
  function paintTree() {
    var h = "", start = ROOT || "";
    (function walk(fid, d) {
      kids(fid).forEach(function (f) {
        h += '<div class="row fold" style="--d:' + d + '">📁 <span class="nm">' + esc(f.name) + '</span></div>';
        walk(f.id, d + 1);
      });
      filesIn(fid).forEach(function (x) {
        var ext = (/\.(\w{1,4})$/.exec(x.name) || [, "txt"])[1];
        h += '<div class="row' + (x.id === CUR ? " on" : "") + '" data-id="' + esc(x.id) + '" role="button" tabindex="0" style="--d:' + d + '"><span class="ext">' + esc(ext) + '</span><span class="nm">' + esc(x.name) + '</span><em>' + size(x.size) + '</em></div>';
      });
    })(start, 0);
    $("shTree").innerHTML = h || '<div class="empty">No files here yet.</div>';
  }

  /* ---- viewer ---- */
  function paintView(html) { $("shView").innerHTML = html || '<div class="empty">Pick a file on the left.</div>'; }
  function openFile(id, quiet) {
    var it = BY[id]; if (!it) return;
    CUR = id; paintTree(); document.body.classList.add("reading");
    if (!quiet) paintView('<div class="vbar"><button type="button" class="back" data-a="back">‹ Files</button><b>' + esc(it.name) + '</b></div><div class="empty">Loading…</div>');
    fileCode(id).then(function (code) {
      if (CUR !== id) return;
      var n = code.split("\n").length, body;
      if (n <= HL_LINES && code.length <= HL_BYTES && window.WFCodeHL) {
        var ls = window.WFCodeHL.lines(code, it.lang);
        body = '<table>' + ls.map(function (l, i) { return '<tr><td class="n">' + (i + 1) + '</td><td>' + (l || " ") + '</td></tr>'; }).join("") + '</table>';
      } else body = '<pre>' + esc(code) + '</pre>';
      paintView('<div class="vbar"><button type="button" class="back" data-a="back">‹ Files</button><b class="grow">' + esc(it.name) + '</b>' +
        '<button type="button" data-a="copy">Copy</button><button type="button" data-a="dl">Download</button></div>' +
        '<div class="note">' + n.toLocaleString() + ' lines · ' + size(code.length) + (it.u ? ' · changed ' + when(it.u) : '') + (n > HL_LINES || code.length > HL_BYTES ? ' · shown without colours (large file)' : '') + '</div>' +
        '<div class="code">' + body + '</div>');
    }, function () { if (CUR === id) paintView('<div class="empty">This file is no longer shared. Tap Refresh.</div>'); });
  }
  function download(name, blob) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  function zipAll() {
    var files = LIST.filter(function (x) { return x.kind === "file"; }); if (!files.length) return;
    var top = ROOT ? BY[ROOT] : null, rootName = safeName(top ? top.name : "code"), enc = new TextEncoder();
    function pathOf(fid) { var p = [], g = 0; while (fid && fid !== ROOT && BY[fid] && g++ < 50) { p.unshift(safeName(BY[fid].name)); fid = BY[fid].parent; } return p; }
    $("shZip").disabled = true; toast("Preparing " + rootName + ".zip…");
    var out = [{ path: rootName + "/", u: Date.now() }], i = 0;
    LIST.filter(function (x) { return x.kind === "folder" && x.id !== ROOT; }).forEach(function (f) { out.push({ path: rootName + "/" + pathOf(f.id).join("/") + "/", u: f.u }); });
    (function next() {
      if (i >= files.length) { download(rootName + ".zip", window.WFZip.blob(out)); $("shZip").disabled = false; toast("Downloading " + rootName + ".zip · " + files.length + (files.length === 1 ? " file" : " files")); return; }
      var f = files[i++];
      fileCode(f.id).then(function (code) { var dir = pathOf(f.parent); out.push({ path: rootName + "/" + (dir.length ? dir.join("/") + "/" : "") + safeName(f.name), data: enc.encode(code), u: f.u }); next(); },
        function () { next(); });
    })();
  }

  /* ---- wiring ---- */
  function boot() {
    var cfg = window.WF_CONFIG;
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(tok)) { off("This link is incomplete. Copy the whole link again."); return; }
    if (!cfg || !window.supabase) { off("Couldn't load. Check your connection and reload."); return; }
    sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    $("shTree").addEventListener("click", function (e) { var r = e.target.closest(".row[data-id]"); if (r) openFile(r.getAttribute("data-id")); });
    $("shTree").addEventListener("keydown", function (e) { var r = e.target.closest(".row[data-id]"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFile(r.getAttribute("data-id")); } });
    $("shView").addEventListener("click", function (e) {
      var a = e.target.closest("[data-a]"); if (!a) return; var k = a.getAttribute("data-a"), it = BY[CUR], c = CODE[CUR];
      if (k === "back") { document.body.classList.remove("reading"); CUR = ""; paintTree(); paintView(); }
      else if (k === "copy" && c) { (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(c.code) : Promise.reject()).then(function () { toast("Copied"); }, function () { toast("Couldn't copy here. Select the text instead."); }); }
      else if (k === "dl" && c && it) download(safeName(it.name), new Blob([c.code], { type: "text/plain" }));
    });
    $("shRefresh").addEventListener("click", function () { listNow().then(function () { toast("Up to date"); }); });
    $("shZip").addEventListener("click", zipAll);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") listNow(); });   // always live: back on the tab → latest files
    window.addEventListener("hashchange", function () { location.reload(); });
    listNow();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
