/* Weekly Focus — v98.6 Code tab. Read-only code library with folders.
   Drop files or whole folders (names kept), paste as a fallback. Colours for files up to 3,000 lines.
   Storage: IndexedDB on this device first, then the cloud — one row per file/folder in weekly_focus_entries,
   board_id "wf-code", item_key "code:<id>" (files, same as v98.5) or "fold:<id>" (folders).
   Same name + same folder → Replace (old copy kept in History, last 5) / Keep both / Skip. Deletes are tombstones. */
(function () {
  "use strict";
  var BOARD = "wf-code", DB = "wf-code", STORE = "snips", TAB_KEY = "wf2_tab";
  var CLOUD_MAX = 8 * 1024 * 1024, HL_LINES = 3000, HL_BYTES = 400 * 1024, CHUNK = 1500, MAX_VERS = 5, MAX_FILE = 20 * 1024 * 1024;
  var LANGS = ["Text", "JavaScript", "TypeScript", "Python", "SQL", "HTML", "CSS", "JSON", "Shell", "Java", "C#"];
  var EXT = { JavaScript: "js", TypeScript: "ts", Python: "py", SQL: "sql", HTML: "html", CSS: "css", JSON: "json", Shell: "sh", Java: "java", "C#": "cs", Text: "txt" };
  var SKIP_DIRS = { ".git": 1, "node_modules": 1, ".next": 1, "__pycache__": 1 };
  var items = {}, db = null, pushT = {}, pulling = false, syncErr = "", NC = {};
  var sel = { folder: "", file: "" }, q = "", openF = {}, ver = -1, findQ = "", hits = [], hitI = -1, src = [], pend = [], rendered = 0, renderTok = 0;
  var showFind = false, showHist = false, showMore = false, qT = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lines(s) { if (!s) return 1; var n = 1, i = -1; while ((i = s.indexOf("\n", i + 1)) >= 0) n++; return n; }
  function nLines(r) { var c = NC[r.id]; if (!c || c.u !== r.u) c = NC[r.id] = { u: r.u, n: lines(r.code) }; return c.n; }
  function bytes(s) { return new Blob([s || ""]).size; }
  function size(s) { var b = bytes(s); return b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB"; }
  var MON = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  function when(ms) { var d = new Date(ms); return d.getDate() + " " + MON[d.getMonth()] + " " + d.toTimeString().slice(0, 5); }
  function mobile() { return window.innerWidth <= 760; }
  function wrapOn() { var w = lsGet("wfc_wrap"); return w == null ? mobile() : w === "1"; }
  function sb() { return window.__wfSb || null; }
  async function user() { var c = sb(); if (!c) return null; try { var r = await c.auth.getSession(); return r && r.data && r.data.session ? r.data.session.user : null; } catch (e) { return null; } }
  function langOf(name, code) { var l = window.WFCodeHL.langFromName(name); return l === "Text" && code ? guess(code) : l; }
  function guess(s) {
    var h = s.slice(0, 3000);
    if (/^\s*[{\[]/.test(h) && /"\s*:/.test(h)) return "JSON";
    if (/<\/?(html|div|body|head|script|section)\b/i.test(h)) return "HTML";
    if (/\b(select|insert|update|create table|alter table)\b[\s\S]*\b(from|into|set|\()/i.test(h)) return "SQL";
    if (/^\s*(def |import |from \S+ import|class \w+\(?.*\)?:)/m.test(h)) return "Python";
    if (/:\s*(string|number|boolean)\b|interface \w+/.test(h)) return "TypeScript";
    if (/\b(function|const|let|var|=>)\b/.test(h)) return "JavaScript";
    if (/^#!\/bin\/(ba)?sh|^\s*(echo|cd|export|sudo) /m.test(h)) return "Shell";
    if (/[.#]?[\w-]+\s*\{[^}]*:[^}]*;/.test(h)) return "CSS";
    return "Text";
  }

  /* ---------- model ---------- */
  function norm(r) {
    if (!r.kind) r.kind = "file";
    if (r.kind === "file") { if (r.name == null) r.name = r.title || "Untitled"; r.folder = r.folder || ""; r.code = r.code || ""; r.lang = r.lang || langOf(r.name, r.code); r.vers = Array.isArray(r.vers) ? r.vers : []; }
    else { r.parent = r.parent || ""; r.name = r.name || "Folder"; }
    delete r.title; return r;
  }
  function all(kind) { return Object.keys(items).map(function (k) { return items[k]; }).filter(function (r) { return !r.del && r.kind === kind; }); }
  function folderOk(fid) { return !fid || (items[fid] && !items[fid].del && items[fid].kind === "folder"); }
  function byName(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); }
  function kids(pid) { return all("folder").filter(function (f) { return (folderOk(f.parent) ? f.parent : "") === pid; }).sort(byName); }
  function filesIn(fid) { return all("file").filter(function (f) { return (folderOk(f.folder) ? f.folder : "") === fid; }).sort(byName); }
  function path(fid) { var p = [], g = 0; while (fid && items[fid] && g++ < 50) { p.unshift(items[fid].name); fid = folderOk(items[fid].parent) ? items[fid].parent : ""; } return p; }
  function pathLabel(fid) { var p = path(fid); return p.length ? p.join(" / ") : "All code"; }
  function countIn(fid) { var n = filesIn(fid).length; kids(fid).forEach(function (f) { n += countIn(f.id); }); return n; }
  function descFolders(fid) { var out = []; kids(fid).forEach(function (f) { out.push(f.id); out = out.concat(descFolders(f.id)); }); return out; }
  function uniqueName(name, fid, except) {
    var taken = {}; filesIn(fid).forEach(function (f) { if (f.id !== except) taken[f.name.toLowerCase()] = 1; });
    if (!taken[name.toLowerCase()]) return name;
    var m = /^(.*?)(\.[^.]*)?$/.exec(name), base = m[1], ext = m[2] || "";
    for (var i = 2; ; i++) { var n = base + " (" + i + ")" + ext; if (!taken[n.toLowerCase()]) return n; }
  }
  function cur() { var r = items[sel.file]; return r && !r.del && r.kind === "file" ? r : null; }
  function viewCode(r) { return ver >= 0 && r.vers[ver] ? r.vers[ver].code : r.code; }
  function viewLang(r) { return ver >= 0 && r.vers[ver] ? (r.vers[ver].lang || r.lang) : r.lang; }
  function saveSel() { lsSet("wfc_sel", JSON.stringify(sel)); lsSet("wfc_openf", JSON.stringify(openF)); }

  /* ---------- device storage ---------- */
  function openDb() { return new Promise(function (res, rej) { var r = indexedDB.open(DB, 1); r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: "id" }); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function tx(mode, fn) { return new Promise(function (res, rej) { var t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE)); t.oncomplete = function () { res(out && out.result); }; t.onerror = function () { rej(t.error); }; }); }
  var put = function (r) { return tx("readwrite", function (st) { st.put(r); }); };
  function getAll() { return tx("readonly", function (st) { return st.getAll(); }); }
  function save(r) { r.u = Date.now(); r.synced = false; items[r.id] = r; put(r).catch(function () { syncErr = "Couldn't save on this device."; paintFoot(); }); pushSoon(r.id); }

  /* ---------- cloud ---------- */
  function payload(r) {
    if (r.kind === "folder") return { kind: "folder", name: r.name, parent: r.parent || "", c: r.c, u: r.u, del: !!r.del };
    var p = { kind: "file", name: r.name, folder: r.folder || "", lang: r.lang, code: r.del ? "" : r.code, vers: r.del ? [] : r.vers.slice(), c: r.c, u: r.u, del: !!r.del };
    while (p.vers.length && bytes(JSON.stringify(p)) > CLOUD_MAX) p.vers.pop();
    return p;
  }
  async function push(id) {
    var r = items[id], c = sb(), u = await user(); if (!r || !c || !u) { paintFoot(); return; }
    if (r.kind === "file" && !r.del && bytes(r.code) > CLOUD_MAX) { r.cloudErr = "Over 8 MB: saved on this device only."; paintFoot(); return; }
    var sentU = r.u;
    try {
      var res = await c.from("weekly_focus_entries").upsert({ user_id: u.id, board_id: BOARD, item_key: (r.kind === "folder" ? "fold:" : "code:") + id, payload: payload(r), updated_at: new Date(r.u).toISOString() }, { onConflict: "user_id,board_id,item_key" });
      if (res.error) throw res.error;
      if (items[id] && items[id].u === sentU) { items[id].synced = true; delete items[id].cloudErr; await put(items[id]); }
      syncErr = "";
    } catch (e) { syncErr = "Not synced yet (" + (e.message || e) + "). Saved on this device; retrying."; }
    paintFoot(); paintTreeSoon();
  }
  function pushSoon(id, ms) { clearTimeout(pushT[id]); pushT[id] = setTimeout(function () { push(id); }, ms == null ? 1200 : ms); }
  async function pull() {
    var c = sb(), u = await user(); if (!c || !u || pulling) return; pulling = true;
    try {
      var res = await c.from("weekly_focus_entries").select("item_key,payload").eq("board_id", BOARD);
      if (res.error) throw res.error;
      var changed = false, openChanged = false;
      for (var i = 0; i < (res.data || []).length; i++) {
        var row = res.data[i], key = String(row.item_key || ""), id = key.replace(/^(code|fold):/, ""), p = row.payload || {}, l = items[id];
        if (!id || (l && (p.u || 0) <= (l.u || 0))) continue;
        items[id] = norm(Object.assign({ id: id, kind: /^fold:/.test(key) ? "folder" : "file" }, p, { synced: true }));
        await put(items[id]); changed = true; if (id === sel.file) openChanged = true;
      }
      Object.keys(items).forEach(function (id) { if (!items[id].synced) pushSoon(id, 50); });
      syncErr = "";
      if (changed) paintTree();
      if (openChanged && ver < 0) paintViewer();
    } catch (e) { syncErr = "Couldn't reach the cloud. Everything is saved on this device."; }
    pulling = false; paintFoot();
  }

  /* ---------- adding files ---------- */
  function newFolder(name, parent) { var t = Date.now(), r = { id: uid(), kind: "folder", name: name, parent: parent || "", c: t, u: t, del: false, synced: false }; save(r); return r; }
  function ensurePath(base, dirs) {
    var fid = base;
    dirs.forEach(function (d) { var ex = kids(fid).filter(function (f) { return f.name.toLowerCase() === d.toLowerCase(); })[0]; fid = (ex || newFolder(d, fid)).id; openF[fid] = 1; });
    return fid;
  }
  function newFile(name, code, fid) { var t = Date.now(), r = { id: uid(), kind: "file", name: name, folder: fid, lang: langOf(name, code), code: code, vers: [], c: t, u: t, del: false, synced: false }; save(r); return r; }
  function askDup(name, where, left) {
    return new Promise(function (res) {
      var m = $("wfcModal");
      m.innerHTML = '<div class="wfc-mbox"><div><b>' + esc(name) + '</b> is already in <b>' + esc(where) + '</b>.</div><div class="wfc-mbtns"><button class="tbtn primary" type="button" data-dup="replace">Replace</button><button class="tbtn" type="button" data-dup="both">Keep both</button><button class="tbtn" type="button" data-dup="skip">Skip</button></div>' +
        (left > 0 ? '<label class="wfc-all"><input type="checkbox" id="wfcDupAll"> Do the same for the next ' + left + ' file' + (left > 1 ? "s" : "") + '</label>' : "") + '<p class="wfc-mnote">Replace keeps the old copy in History.</p></div>';
      m.classList.add("on");
      m.onclick = function (e) { var b = e.target.closest("[data-dup]"); if (!b) return; var a = $("wfcDupAll"); m.classList.remove("on"); m.innerHTML = ""; m.onclick = null; res({ a: b.getAttribute("data-dup"), all: !!(a && a.checked) }); };
    });
  }
  /* list: [{name, size, read: () => Promise<string>, dirs: []}] */
  async function importList(list, target) {
    if (!list.length) return;
    if (list.length > 300 && !confirm("Add " + list.length + " files?")) return;
    var res = { add: 0, rep: 0, skip: 0, bad: 0 }, remember = null, lastId = "";
    toast("Adding " + list.length + " file" + (list.length > 1 ? "s" : "") + "…");
    for (var i = 0; i < list.length; i++) {
      var it = list[i], text;
      if (it.size > MAX_FILE) { res.bad++; continue; }
      try { text = await it.read(); } catch (e) { res.bad++; continue; }
      if (text.slice(0, 8000).indexOf("\u0000") >= 0) { res.bad++; continue; }
      text = text.replace(/\r\n?/g, "\n");
      var fid = ensurePath(target, it.dirs || []), name = it.name;
      var ex = filesIn(fid).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
      if (ex) {
        if (ex.code === text) { res.skip++; lastId = ex.id; continue; }
        var act = remember || await askDup(name, pathLabel(fid), list.length - i - 1); if (act.all) remember = act;
        if (act.a === "skip") { res.skip++; continue; }
        if (act.a === "replace") { ex.vers.unshift({ code: ex.code, u: ex.u, lang: ex.lang }); ex.vers = ex.vers.slice(0, MAX_VERS); ex.code = text; save(ex); res.rep++; lastId = ex.id; continue; }
        name = uniqueName(name, fid);
      }
      lastId = newFile(name, text, fid).id; res.add++;
    }
    if (target) openF[target] = 1;
    var msg = []; if (res.add) msg.push(res.add + " added"); if (res.rep) msg.push(res.rep + " replaced"); if (res.skip) msg.push(res.skip + " unchanged/skipped"); if (res.bad) msg.push(res.bad + " not text or too big");
    toast(msg.join(" · ") || "Nothing added");
    if (list.length === 1 && lastId) { open(lastId); return; }
    saveSel(); paintTree();
  }
  function fileItem(f, dirs) { return { name: f.name, size: f.size, read: function () { return f.text(); }, dirs: dirs || [] }; }
  function fromInput(files) { return Array.prototype.filter.call(files || [], function (f) { return !/(^|\/)(\.git|node_modules|\.next|__pycache__)(\/|$)/.test(f.webkitRelativePath || ""); }).map(function (f) { var p = (f.webkitRelativePath || "").split("/").filter(Boolean); return fileItem(f, p.slice(0, -1)); }); }
  async function fromDrop(dt) {
    var out = [], entries = [], its = dt.items || [];
    for (var i = 0; i < its.length; i++) { var e = its[i].webkitGetAsEntry && its[i].webkitGetAsEntry(); if (e) entries.push(e); }
    if (!entries.length) return fromInput(dt.files);
    async function walk(e, dirs) {
      if (e.isFile) { var f = await new Promise(function (res, rej) { e.file(res, rej); }); out.push(fileItem(f, dirs)); }
      else if (e.isDirectory && !SKIP_DIRS[e.name]) {
        var rd = e.createReader(), batch;
        do { batch = await new Promise(function (res, rej) { rd.readEntries(res, rej); }); for (var j = 0; j < batch.length; j++) await walk(batch[j], dirs.concat(e.name)); } while (batch.length);
      }
    }
    for (var k = 0; k < entries.length; k++) await walk(entries[k], []);
    return out;
  }
  function pasteText(txt) {
    txt = (txt || "").replace(/\r\n?/g, "\n"); if (!txt.trim()) return;
    var lang = guess(txt), d = new Date(), def = "pasted-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "." + EXT[lang];
    var name = prompt("Name for this code (saves to " + pathLabel(sel.folder) + ")", def); if (name === null) return;
    name = name.trim() || def; if (!/\.\w+$/.test(name)) name += "." + EXT[lang];
    importList([{ name: name, size: txt.length, read: function () { return Promise.resolve(txt); }, dirs: [] }], sel.folder);
  }

  /* ---------- UI ---------- */
  var CAR = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  var FOLD = '<svg class="wfc-fi" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"></path></svg>';
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5"></path><path d="M16 7l5 5-5 5"></path><path d="M13.5 4l-3 16"></path></svg>';
  var MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  var WFC_CSS = ".htabbar-in{grid-template-columns:repeat(7,minmax(0,1fr))!important}" +
    ".wfc{max-width:1320px;margin:0 auto;padding:14px 16px 100px}" +
    ".wfc-head{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;margin-bottom:12px}.wfc-head h2{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em}.wfc-head .sub{font-size:12px;color:var(--mid)}" +
    ".wfc-tools{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;align-items:center}" +
    ".wfc-search{flex:1 1 180px;width:240px;border:1px solid var(--hair);background:var(--card);border-radius:10px;padding:8px 11px;font:inherit;font-size:13px;outline:none}.wfc-search:focus{border-color:var(--brand-line)}" +
    ".wfc-grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px;align-items:start}" +
    ".wfc-side{display:flex;flex-direction:column;gap:8px;position:sticky;top:12px;max-height:calc(100vh - 140px)}" +
    ".wfc-drop{border:1.5px dashed #d9d6cf;border-radius:var(--r-md);padding:12px;font-size:12.5px;line-height:1.45;color:var(--mid);background:var(--card-2,#fafaf7);text-align:center;cursor:text;outline:none}" +
    ".wfc-drop b{color:var(--ink)}.wfc-drop:focus,.wfc-drop.hot{border-color:var(--brand);background:var(--brand-soft);color:var(--ink)}" +
    ".wfc-tree{display:flex;flex-direction:column;gap:1px;overflow:auto;background:var(--card);border:1px solid var(--hair);border-radius:var(--r-md);padding:6px;min-height:140px}" +
    ".wfc-row{display:flex;align-items:center;gap:6px;padding:5px 6px 5px calc(6px + var(--d,0) * 14px);border-radius:8px;font-size:13px;cursor:pointer;min-height:32px;user-select:none;-webkit-user-select:none}" +
    ".wfc-row:hover{background:var(--card-2,#fafaf7)}.wfc-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wfc-row em{font-style:normal;font-size:11px;color:var(--faint)}" +
    ".wfc-row.tgt{background:var(--brand-soft)}.wfc-root{font-weight:800;font-size:12px;letter-spacing:.02em}" +
    ".wfc-file{padding-left:calc(28px + var(--d,0) * 14px)}.wfc-file.on{background:var(--brand-soft);box-shadow:inset 0 0 0 1px var(--brand-line);font-weight:700}" +
    ".wfc-row.hot{box-shadow:inset 0 0 0 2px var(--brand)!important;background:var(--brand-soft)}" +
    ".wfc-car{border:0;background:none;padding:0;width:16px;height:16px;flex:0 0 16px;display:grid;place-items:center;color:var(--faint);cursor:pointer;transition:transform .12s}.wfc-car.open{transform:rotate(90deg)}" +
    ".wfc-fi{flex:0 0 auto;color:oklch(0.74 0.12 80)}" +
    ".wfc-dots{border:0;background:none;color:var(--mid);cursor:pointer;padding:0 6px;font-size:16px;line-height:1;opacity:0}.wfc-row:hover .wfc-dots,.wfc-dots:focus{opacity:1}@media(hover:none){.wfc-dots{opacity:1}}" +
    ".wfc-ext{flex:0 0 32px;font:700 9px/1 " + MONO + ";padding:4px 0;border-radius:4px;background:#eceae5;color:var(--mid);text-align:center;text-transform:uppercase}" +
    ".wfc-ext[data-l=JavaScript],.wfc-ext[data-l=TypeScript]{background:oklch(0.95 0.06 95);color:oklch(0.45 0.1 80)}.wfc-ext[data-l=Python]{background:oklch(0.95 0.04 240);color:oklch(0.45 0.12 240)}.wfc-ext[data-l=SQL]{background:oklch(0.95 0.04 200);color:oklch(0.45 0.1 200)}.wfc-ext[data-l=HTML]{background:oklch(0.95 0.04 30);color:oklch(0.5 0.15 30)}.wfc-ext[data-l=CSS]{background:oklch(0.95 0.04 283);color:oklch(0.5 0.15 283)}.wfc-ext[data-l=JSON]{background:oklch(0.95 0.03 150);color:oklch(0.45 0.1 150)}" +
    ".wfc-ns{width:6px;height:6px;border-radius:50%;background:var(--pri-m);flex:0 0 auto}" +
    ".wfc-hint{font-size:12px;color:var(--faint);padding:10px 8px;line-height:1.5}" +
    ".wfc-ed{background:var(--card);border:1px solid var(--hair);border-radius:var(--r-lg);box-shadow:var(--shadow-card);display:flex;flex-direction:column;overflow:hidden;min-width:0}" +
    ".wfc-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--hair);flex-wrap:wrap}" +
    ".wfc-nm{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:1px}.wfc-name{border:0;outline:none;font:inherit;font-size:15px;font-weight:800;background:none;padding:2px 0;width:100%;min-width:0;border-bottom:1px solid transparent}.wfc-name:focus{border-bottom-color:var(--brand-line)}.wfc-crumb{font-size:11px;color:var(--mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".wfc-acts{display:flex;gap:6px;flex-wrap:wrap}.wfc-acts .tbtn.on{background:var(--brand-soft);color:var(--brand);border-color:var(--brand-line)}.wfc-back{display:none}" +
    ".wfc-sub{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--hair);background:var(--card-2,#fafaf7);flex-wrap:wrap;font-size:12.5px;color:var(--mid)}" +
    ".wfc-sub input,.wfc-sub select{border:1px solid var(--hair);border-radius:8px;padding:6px 8px;font:inherit;font-size:12.5px;background:#fff;outline:none;color:var(--ink)}.wfc-sub input:focus{border-color:var(--brand-line)}" +
    ".wfc-sub .grow{flex:1 1 160px;min-width:0}.wfc-sub .num{width:84px}.wfc-sub b{color:var(--ink)}" +
    ".wfc-ver{display:flex;flex-direction:column;align-items:stretch;gap:2px}.wfc-ver button.vr{display:flex;gap:10px;align-items:center;border:0;background:none;text-align:left;padding:6px 8px;border-radius:7px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ink)}.wfc-ver button.vr:hover{background:#fff}.wfc-ver button.vr.on{background:#fff;font-weight:700;box-shadow:var(--shadow-card)}.wfc-ver span{color:var(--mid)}" +
    ".wfc-old{background:oklch(0.96 0.04 80);color:#6b4e0f}" +
    ".wfc-view{position:relative;overflow:auto;height:calc(100vh - 250px);height:calc(100dvh - 250px);min-height:320px;background:#fff;font:12.5px/1.6 " + MONO + ";tab-size:4;-webkit-text-size-adjust:100%;color:var(--ink)}" +
    ".wfc-lines{width:max-content;min-width:100%;padding:8px 0 16px}" +
    ".wfc-lines .l{display:flex;min-height:1.6em}" +
    ".wfc-lines .l::before{content:attr(data-n);flex:0 0 auto;box-sizing:content-box;width:var(--gw);padding:0 10px 0 8px;margin-right:14px;text-align:right;color:#b4b2ab;position:sticky;left:0;background:#faf9f6;border-right:1px solid var(--hair);user-select:none;-webkit-user-select:none}" +
    ".wfc-lines .t{white-space:pre;padding-right:18px}" +
    ".wfc-wrap .wfc-lines{width:auto}.wfc-wrap .wfc-lines .t{white-space:pre-wrap;overflow-wrap:anywhere;flex:1;min-width:0}" +
    ".wfc-lines .l.flash .t{animation:wfcflash 1.4s ease}@keyframes wfcflash{0%,40%{background:oklch(0.93 0.08 95)}100%{background:transparent}}.wfc-lines .l.hitl{background:oklch(0.97 0.05 95)}" +
    "::highlight(wfc-find){background-color:oklch(0.92 0.1 95)}::highlight(wfc-cur){background-color:oklch(0.8 0.15 70)}" +
    ".hl-com{color:#8a8a91;font-style:italic}.hl-str{color:oklch(0.48 0.12 150)}.hl-kw{color:oklch(0.5 0.17 283);font-weight:600}.hl-num{color:oklch(0.55 0.15 50)}.hl-fn{color:oklch(0.47 0.13 240)}.hl-tag{color:oklch(0.5 0.16 20)}.hl-attr{color:oklch(0.48 0.12 230)}.hl-var{color:oklch(0.5 0.15 330)}" +
    ".wfc-foot{display:flex;align-items:center;gap:6px 12px;padding:8px 12px;border-top:1px solid var(--hair);font-size:11.5px;color:var(--mid);flex-wrap:wrap}.wfc-st{margin-left:auto;font-weight:700}.wfc-st.ok{color:var(--on)}.wfc-st.warn{color:var(--pri-h)}" +
    ".wfc-none{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:50vh;color:var(--mid);font-size:13px;text-align:center;padding:24px;line-height:1.5}.wfc-none b{color:var(--ink);font-size:15px}" +
    ".wfc-modal{position:fixed;inset:0;background:rgba(20,20,40,.25);display:none;align-items:center;justify-content:center;z-index:300;padding:16px}.wfc-modal.on{display:flex}" +
    ".wfc-mbox{background:#fff;border-radius:var(--r-lg);padding:18px;max-width:400px;width:100%;box-shadow:var(--shadow-pop);font-size:13.5px;display:flex;flex-direction:column;gap:12px;overflow-wrap:anywhere}.wfc-mbtns{display:flex;gap:6px;flex-wrap:wrap}.wfc-all{font-size:12.5px;color:var(--mid);display:flex;gap:6px;align-items:center}.wfc-mnote{margin:0;font-size:11.5px;color:var(--faint)}" +
    ".wfc-pop{position:fixed;z-index:290;background:#fff;border:1px solid var(--hair);border-radius:10px;box-shadow:var(--shadow-pop);padding:4px;display:flex;flex-direction:column;min-width:170px}.wfc-pop button{border:0;background:none;text-align:left;padding:9px 12px;border-radius:7px;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}.wfc-pop button:hover{background:var(--card-2,#fafaf7)}.wfc-pop button.danger{color:var(--pri-h)}" +
    ".wfc-toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%) translateY(10px);background:#1b1b1f;color:#fff;padding:9px 14px;border-radius:10px;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:310;max-width:calc(100vw - 32px)}.wfc-toast.on{opacity:1;transform:translateX(-50%)}" +
    "@media(max-width:760px){.wfc{padding:10px 10px 90px}.wfc-grid{grid-template-columns:minmax(0,1fr)}.wfc-side{position:static;max-height:none}.wfc-tree{overflow:visible}" +
    "#scrCode.wfc-viewing .wfc-side,#scrCode.wfc-viewing .wfc-head{display:none}#scrCode:not(.wfc-viewing) .wfc-ed{display:none}" +
    ".wfc-back{display:inline-flex}.wfc-view{height:calc(100vh - 215px);height:calc(100dvh - 215px);font-size:12px}.wfc-row{min-height:44px;font-size:14px}.wfc-hide-m{display:none!important}.wfc-tools{margin-left:0;width:100%}.wfc-search{width:auto}.wfc-acts .tbtn{padding:6px 10px}.wfc-drop{padding:10px}}";

  function mount() {
    if ($("scrCode")) return true;
    var anchor = $("scrChats"), bar = document.querySelector(".htabbar-in") || document.querySelector(".htabbar");
    if (!anchor || !bar) return false;
    var old = $("wfcCss"); if (old) old.remove();
    var st = document.createElement("style"); st.id = "wfcCss"; st.textContent = WFC_CSS; document.head.appendChild(st);
    var sec = document.createElement("section"); sec.className = "screen"; sec.id = "scrCode"; sec.setAttribute("data-screen-label", "Code");
    sec.innerHTML = '<div class="wfc"><div class="wfc-head"><h2>Code</h2><span class="sub">Drop files or folders. Read and copy. Saved on this device and in the cloud.</span>' +
      '<div class="wfc-tools"><input class="wfc-search" id="wfcQ" placeholder="Search names and code" autocomplete="off"><button class="tbtn" type="button" id="wfcNewF">New folder</button><button class="tbtn primary" type="button" id="wfcAdd">Add files</button><button class="tbtn wfc-hide-m" type="button" id="wfcAddDir">Add folder</button></div></div>' +
      '<div class="wfc-grid"><div class="wfc-side"><div class="wfc-drop" id="wfcDrop" contenteditable="true" spellcheck="false" aria-label="Drop files here, or paste code"></div><div class="wfc-tree" id="wfcTree"></div></div><div class="wfc-ed" id="wfcEd"></div></div></div>' +
      '<input type="file" id="wfcFiles" multiple hidden><input type="file" id="wfcDir" webkitdirectory multiple hidden><div class="wfc-modal" id="wfcModal"></div><div class="wfc-toast" id="wfcToast"></div>';
    anchor.insertAdjacentElement("afterend", sec);
    var tab = document.createElement("button"); tab.className = "htab"; tab.type = "button"; tab.setAttribute("data-screen", "scrCode"); tab.innerHTML = ICON + "Code";
    var ct = bar.querySelector('[data-screen="scrChats"]'); if (ct) ct.insertAdjacentElement("afterend", tab); else bar.appendChild(tab);
    tab.addEventListener("click", show);
    wire(); return true;
  }
  function show() {
    Array.prototype.forEach.call(document.querySelectorAll(".screen"), function (s) { s.classList.toggle("on", s.id === "scrCode"); });
    Array.prototype.forEach.call(document.querySelectorAll(".htab"), function (t) { t.classList.toggle("on", t.getAttribute("data-screen") === "scrCode"); });
    lsSet(TAB_KEY, "scrCode"); window.scrollTo({ top: 0 }); pull();
  }
  var toastT = null;
  function toast(t) { var el = $("wfcToast"); if (!el) return; el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("on"); }, 2600); }
  var DROP_PH = "";
  function paintDrop() { var d = $("wfcDrop"); if (!d || document.activeElement === d) return; d.innerHTML = (mobile() ? "Tap <b>Add files</b>, or tap here and paste code" : "Drop files or folders here, or click and paste (Ctrl+V)") + "<br>Saves to <b>" + esc(pathLabel(sel.folder)) + "</b>"; DROP_PH = d.innerHTML; }

  var treeT = null;
  function paintTreeSoon() { clearTimeout(treeT); treeT = setTimeout(paintTree, 150); }
  function paintTree() {
    var box = $("wfcTree"); if (!box) return;
    var ql = q.trim().toLowerCase(), h = "";
    var match = ql ? function (f) { return f.name.toLowerCase().indexOf(ql) >= 0 || f.code.toLowerCase().indexOf(ql) >= 0; } : null;
    function has(fid) { return filesIn(fid).some(match) || kids(fid).some(function (k) { return has(k.id); }); }
    h += '<div class="wfc-row wfc-root' + (sel.folder === "" ? " tgt" : "") + '" data-fid="" style="--d:0"><span class="nm">ALL CODE</span><em>' + all("file").length + '</em></div>';
    var shown = 0;
    (function walk(fid, d) {
      kids(fid).forEach(function (f) {
        if (match && !has(f.id)) return;
        var open = match ? true : !!openF[f.id];
        h += '<div class="wfc-row wfc-fold' + (sel.folder === f.id ? " tgt" : "") + '" data-fid="' + f.id + '" style="--d:' + d + '"><button type="button" class="wfc-car' + (open ? " open" : "") + '" data-car="' + f.id + '" aria-label="' + (open ? "Close" : "Open") + ' folder">' + CAR + '</button>' + FOLD + '<span class="nm">' + esc(f.name) + '</span><em>' + countIn(f.id) + '</em><button type="button" class="wfc-dots" data-fmenu="' + f.id + '" aria-label="Folder actions">⋯</button></div>';
        if (open) walk(f.id, d + 1);
      });
      filesIn(fid).forEach(function (r) {
        if (match && !match(r)) return; shown++;
        h += '<div class="wfc-row wfc-file' + (sel.file === r.id ? " on" : "") + '" data-id="' + r.id + '" draggable="true" style="--d:' + (d - 1) + '"><span class="wfc-ext" data-l="' + esc(r.lang) + '">' + esc((/\.(\w{1,4})$/.exec(r.name) || [, EXT[r.lang] || "txt"])[1]) + '</span><span class="nm">' + esc(r.name) + '</span>' + (r.synced ? "" : '<span class="wfc-ns" title="Not synced yet"></span>') + '<em>' + nLines(r).toLocaleString() + '</em></div>';
      });
    })("", 1);
    if (match && !shown) h += '<div class="wfc-hint">No file matches “' + esc(q.trim()) + '”.</div>';
    else if (!all("file").length && !all("folder").length) h += '<div class="wfc-hint">No code yet. Drop files or a folder above, or use Add files. Make folders with New folder.</div>';
    box.innerHTML = h; paintDrop();
  }

  function paintViewer() {
    var ed = $("wfcEd"), root = $("scrCode"); if (!ed) return;
    var r = cur(); renderTok++; clearFind();
    root.classList.toggle("wfc-viewing", !!r);
    if (!r) { ver = -1; ed.className = "wfc-ed"; ed.innerHTML = '<div class="wfc-none"><b>Pick a file to read it</b>Drop files or whole folders on the left; names and folders are kept.<br>Same name in the same folder? You choose Replace or Keep both.</div>'; return; }
    if (ver >= r.vers.length) ver = -1;
    var code = viewCode(r), n = lines(code), big = n > HL_LINES || code.length > HL_BYTES;
    ed.className = "wfc-ed" + (wrapOn() ? " wfc-wrap" : "");
    ed.innerHTML = '<div id="wfcTop"></div><div class="wfc-view" id="wfcView"><div class="wfc-lines" id="wfcLines" style="--gw:' + String(n).length + 'ch"></div></div><div class="wfc-foot"><span>' + n.toLocaleString() + ' lines · ' + size(code) + ' · ' + esc(viewLang(r)) + (big ? " · colours off for big files" : "") + '</span><span class="wfc-st" id="wfcSt"></span></div>';
    paintTop(); paintFoot();
    src = code.split("\n"); pend = window.WFCodeHL.lines(code, big ? "Text" : viewLang(r)); rendered = 0;
    renderChunk(renderTok);
    if (q.trim() && !findQ && code.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0) { showFind = true; findQ = q.trim(); paintTop(); runFind(); }
  }
  function renderChunk(tok, upto) {
    var box = $("wfcLines"); if (!box || tok !== renderTok) return;
    var end = Math.min(pend.length, Math.max(rendered + CHUNK, upto || 0)), s = "";
    for (var i = rendered; i < end; i++) s += '<div class="l" data-n="' + (i + 1) + '"><span class="t">' + pend[i] + '</span></div>';
    box.insertAdjacentHTML("beforeend", s); rendered = end;
    if (rendered < pend.length && !upto) setTimeout(function () { renderChunk(tok); }, 16);
  }
  function ensure(n) { if (rendered < n) renderChunk(renderTok, n); }
  function paintTop() {
    var top = $("wfcTop"), r = cur(); if (!top || !r) return;
    var opts = '<option value="">All code (top)</option>';
    (function walk(fid, d) { kids(fid).forEach(function (f) { opts += '<option value="' + f.id + '"' + (r.folder === f.id ? " selected" : "") + '>' + "\u00a0\u00a0".repeat(d) + esc(f.name) + '</option>'; walk(f.id, d + 1); }); })("", 0);
    var h = '<div class="wfc-bar"><button class="tbtn wfc-back" type="button" data-wfa="back" aria-label="Back to files">‹ Files</button><div class="wfc-nm"><input class="wfc-name" id="wfcName" value="' + esc(r.name) + '" aria-label="File name"><span class="wfc-crumb">' + esc(pathLabel(folderOk(r.folder) ? r.folder : "")) + '</span></div>' +
      '<div class="wfc-acts"><button class="tbtn primary" type="button" data-wfa="copy">Copy</button><button class="tbtn' + (showFind ? " on" : "") + '" type="button" data-wfa="find">Find</button><button class="tbtn' + (wrapOn() ? " on" : "") + '" type="button" data-wfa="wrap">Wrap</button>' +
      (r.vers.length ? '<button class="tbtn' + (showHist ? " on" : "") + '" type="button" data-wfa="hist">History · ' + r.vers.length + '</button>' : "") +
      '<button class="tbtn' + (showMore ? " on" : "") + '" type="button" data-wfa="more">More</button></div></div>';
    if (showMore) h += '<div class="wfc-sub"><span>Language</span><select id="wfcLang">' + LANGS.map(function (l) { return '<option' + (l === r.lang ? " selected" : "") + '>' + l + '</option>'; }).join("") + '</select><span>Folder</span><select id="wfcMove">' + opts + '</select><button class="tbtn" type="button" data-wfa="dl">Download</button><button class="tbtn" type="button" data-wfa="del">Delete</button></div>';
    if (showFind) h += '<div class="wfc-sub"><input class="grow" id="wfcFindQ" placeholder="Find in this file" value="' + esc(findQ) + '" autocomplete="off"><span id="wfcFindN">' + hitLabel() + '</span><button class="tbtn" type="button" data-wfa="prev" aria-label="Previous match">↑</button><button class="tbtn" type="button" data-wfa="next" aria-label="Next match">↓</button><input class="num" id="wfcLine" type="number" min="1" inputmode="numeric" placeholder="Line"><button class="tbtn" type="button" data-wfa="go">Go</button><button class="tbtn" type="button" data-wfa="closefind" aria-label="Close find">×</button></div>';
    if (showHist && r.vers.length) h += '<div class="wfc-sub wfc-ver"><button type="button" class="vr' + (ver < 0 ? " on" : "") + '" data-ver="-1"><b>Current</b><span>' + when(r.u) + ' · ' + nLines(r).toLocaleString() + ' lines</span></button>' + r.vers.map(function (v, i) { return '<button type="button" class="vr' + (ver === i ? " on" : "") + '" data-ver="' + i + '">Older ' + (i + 1) + '<span>' + when(v.u) + ' · ' + lines(v.code).toLocaleString() + ' lines</span></button>'; }).join("") + '</div>';
    if (ver >= 0) h += '<div class="wfc-sub wfc-old"><span>Viewing the copy from <b>' + when(r.vers[ver].u) + '</b>. Copy copies this one.</span><button class="tbtn" type="button" data-wfa="restore">Make this current</button><button class="tbtn" type="button" data-wfa="current">Back to current</button></div>';
    top.innerHTML = h;
  }
  function paintFoot() {
    var el = $("wfcSt"), r = cur(); if (!el || !r) return;
    var t = "Saved ✓ device + cloud", c = "ok";
    if (r.cloudErr) { t = r.cloudErr; c = "warn"; } else if (syncErr) { t = syncErr; c = "warn"; } else if (!sb()) { t = "Saved on this device"; c = ""; } else if (!r.synced) { t = "Saved on this device · syncing…"; c = ""; }
    el.className = "wfc-st " + c; el.textContent = t;
  }

  /* ---------- find / go to line ---------- */
  function hitLabel() { return findQ ? (hits.length ? (hitI + 1) + " / " + hits.length + (hits.length >= 5000 ? "+" : "") : "No matches") : ""; }
  function clearFind() { hits = []; hitI = -1; findQ = ""; if (window.CSS && CSS.highlights) { CSS.highlights.delete("wfc-find"); CSS.highlights.delete("wfc-cur"); } }
  function runFind() {
    hits = []; hitI = -1; var ql = findQ.toLowerCase();
    if (ql) for (var i = 0; i < src.length && hits.length < 5000; i++) { var s = src[i].toLowerCase(), p = s.indexOf(ql); while (p >= 0 && hits.length < 5000) { hits.push([i, p]); p = s.indexOf(ql, p + ql.length); } }
    if (hits.length) goHit(0); else paintHits();
  }
  function goHit(i) { if (!hits.length) return; hitI = (i + hits.length) % hits.length; var h = hits[hitI]; ensure(h[0] + 1); scrollToLine(h[0], false); paintHits(); }
  function lineEl(i) { var b = $("wfcLines"); return b ? b.children[i] : null; }
  function mkRange(li, col, len) {
    var el = lineEl(li); if (!el) return null;
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), pos = 0, node, r = document.createRange(), started = false;
    while ((node = w.nextNode())) { var L = node.nodeValue.length; if (!started && col < pos + L) { r.setStart(node, col - pos); started = true; } if (started && col + len <= pos + L) { r.setEnd(node, col + len - pos); return r; } pos += L; }
    return null;
  }
  function paintHits() {
    var n = $("wfcFindN"); if (n) n.textContent = hitLabel();
    Array.prototype.forEach.call(document.querySelectorAll("#wfcLines .hitl"), function (x) { x.classList.remove("hitl"); });
    if (window.CSS && CSS.highlights && window.Highlight) {
      var rs = [], c = null, L = findQ.length;
      for (var i = 0; i < hits.length && rs.length < 3000; i++) { if (hits[i][0] >= rendered) continue; var rg = mkRange(hits[i][0], hits[i][1], L); if (!rg) continue; if (i === hitI) c = rg; else rs.push(rg); }
      CSS.highlights.set("wfc-find", new Highlight(...rs)); if (c) CSS.highlights.set("wfc-cur", new Highlight(c)); else CSS.highlights.delete("wfc-cur");
    } else if (hitI >= 0) { var el = lineEl(hits[hitI][0]); if (el) el.classList.add("hitl"); }
  }
  function scrollToLine(i, flash) {
    ensure(i + 1); var el = lineEl(i), v = $("wfcView"); if (!el || !v) return;
    v.scrollTop = Math.max(0, el.offsetTop - v.clientHeight / 3);
    if (flash) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  }

  /* ---------- actions ---------- */
  function open(id) { sel.file = id; ver = -1; showHist = false; showMore = false; showFind = false; var r = items[id]; if (r && folderOk(r.folder)) { var f = r.folder; while (f) { openF[f] = 1; f = items[f] && folderOk(items[f].parent) ? items[f].parent : ""; } } saveSel(); paintTree(); paintViewer(); if (mobile()) window.scrollTo({ top: 0 }); }
  function copyText(t, btn) {
    function done() { if (btn) { btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = "Copy"; }, 1400); } toast("Copied " + lines(t).toLocaleString() + " lines"); }
    function fallback() { var ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;top:-1000px;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy. Select the text and copy instead."); } ta.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
  }
  function delFolder(fid) {
    var f = items[fid]; if (!f) return; var ids = [fid].concat(descFolders(fid)), n = 0;
    all("file").forEach(function (r) { if (ids.indexOf(r.folder) >= 0) n++; });
    if (!confirm("Delete folder “" + f.name + "”" + (n ? " and the " + n + " file" + (n > 1 ? "s" : "") + " in it" : "") + "? This removes it from every device.")) return;
    all("file").forEach(function (r) { if (ids.indexOf(r.folder) >= 0) { r.del = true; r.code = ""; r.vers = []; save(r); } });
    ids.forEach(function (id) { items[id].del = true; save(items[id]); });
    if (ids.indexOf(sel.folder) >= 0) sel.folder = ""; if (!cur()) sel.file = "";
    saveSel(); paintTree(); paintViewer();
  }
  /* ---- v120: download a folder as one .zip (stored, no compression; built in the browser, works offline) ---- */
  var CRC_T = null;
  function crc32(b) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var x = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) x = CRC_T[(x ^ b[i]) & 255] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(ms) {
    var d = new Date(ms || Date.now()); if (d.getFullYear() < 1980) d = new Date(1980, 0, 1);
    return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /* entries: [{ path: "a/b.txt" or "a/" for a folder, data: Uint8Array, u: ms }] → Blob (UTF-8 names, flag 0x0800) */
  function zipBlob(entries) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    entries.forEach(function (e) {
      var nm = enc.encode(e.path), d = e.data || new Uint8Array(0), crc = crc32(d), t = dosTime(e.u);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, t.t, true); h.setUint16(12, t.d, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, d);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, t.t, true); c.setUint16(14, t.d, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true);
      c.setUint16(28, nm.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
      c.setUint32(38, /\/$/.test(e.path) ? 0x10 : 0, true); c.setUint32(42, off, true);
      central.push(c.buffer, nm); off += 30 + nm.length + d.length;
    });
    var cs = 0; central.forEach(function (x) { cs += x.byteLength; });
    var z = new DataView(new ArrayBuffer(22));
    z.setUint32(0, 0x06054b50, true); z.setUint16(8, entries.length, true); z.setUint16(10, entries.length, true); z.setUint32(12, cs, true); z.setUint32(16, off, true);
    return new Blob(parts.concat(central, [z.buffer]), { type: "application/zip" });
  }
  function safeName(n) { return String(n || "untitled").replace(/[\\\/:*?"<>|]+/g, "_").replace(/^\.+$/, "_"); }
  function zipFolder(fid) {
    var f = items[fid]; if (!f) return;
    var enc = new TextEncoder(), list = [], nFiles = 0, root = safeName(f.name);
    (function walk(id, pre) {
      list.push({ path: pre + "/", u: (items[id] && items[id].u) || 0 });   // keeps empty folders too
      filesIn(id).forEach(function (r) { nFiles++; list.push({ path: pre + "/" + safeName(r.name), data: enc.encode(r.code || ""), u: r.u }); });
      kids(id).forEach(function (k) { walk(k.id, pre + "/" + safeName(k.name)); });
    })(fid, root);
    if (!nFiles) { toast("“" + f.name + "” has no files to download."); return; }
    var u = URL.createObjectURL(zipBlob(list)), a = document.createElement("a");
    a.href = u; a.download = root + ".zip"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    toast("Downloading " + root + ".zip · " + nFiles + (nFiles === 1 ? " file" : " files"));
  }
  function countDeep(fid) { var n = filesIn(fid).length; kids(fid).forEach(function (k) { n += countDeep(k.id); }); return n; }
  function closePop() { var p = $("wfcPop"); if (p) p.remove(); }
  function folderMenu(btn, fid) {
    closePop(); var b = btn.getBoundingClientRect(), p = document.createElement("div"); p.className = "wfc-pop"; p.id = "wfcPop";
    p.innerHTML = '<button type="button" data-fa="zip">Download as .zip · ' + countDeep(fid) + '</button><button type="button" data-fa="sub">New folder inside</button><button type="button" data-fa="ren">Rename</button><button type="button" class="danger" data-fa="del">Delete folder</button>';
    p.style.top = Math.min(window.innerHeight - 180, b.bottom + 4) + "px"; p.style.left = Math.max(8, Math.min(window.innerWidth - 180, b.right - 170)) + "px";
    p.addEventListener("click", function (e) {
      var a = e.target.closest("[data-fa]"); if (!a) return; var k = a.getAttribute("data-fa"), f = items[fid]; closePop(); if (!f) return;
      if (k === "zip") { zipFolder(fid); return; }
      if (k === "sub") { var nm = prompt("Name for the new folder inside “" + f.name + "”"); if (nm && nm.trim()) { var nf = newFolder(nm.trim(), fid); openF[fid] = 1; sel.folder = nf.id; saveSel(); paintTree(); } }
      else if (k === "ren") { var nn = prompt("Rename folder", f.name); if (nn && nn.trim()) { f.name = nn.trim(); save(f); paintTree(); paintTop(); } }
      else if (k === "del") delFolder(fid);
    });
    document.body.appendChild(p);
  }
  function moveFile(id, fid) { var r = items[id]; if (!r || (r.folder || "") === fid) return; r.folder = fid; r.name = uniqueName(r.name, fid, r.id); save(r); if (fid) openF[fid] = 1; saveSel(); paintTree(); if (id === sel.file) paintTop(); toast("Moved to " + pathLabel(fid)); }

  function wire() {
    var root = $("scrCode");
    root.addEventListener("click", function (e) {
      if (!e.target.closest("#wfcPop")) closePop();
      var car = e.target.closest("[data-car]"); if (car) { var cf = car.getAttribute("data-car"); openF[cf] = !openF[cf]; saveSel(); paintTree(); return; }
      var fm = e.target.closest("[data-fmenu]"); if (fm) { folderMenu(fm, fm.getAttribute("data-fmenu")); return; }
      var fr = e.target.closest(".wfc-fold,.wfc-root"); if (fr) { var fid = fr.getAttribute("data-fid") || ""; if (fid && sel.folder === fid) openF[fid] = !openF[fid]; else if (fid) openF[fid] = 1; sel.folder = fid; saveSel(); paintTree(); return; }
      var fi = e.target.closest(".wfc-file"); if (fi) { open(fi.getAttribute("data-id")); return; }
      var vr = e.target.closest("[data-ver]"); if (vr) { ver = +vr.getAttribute("data-ver"); var keep = showHist; paintViewer(); showHist = keep; paintTop(); return; }
      var a = e.target.closest("[data-wfa]"); if (!a) return; var k = a.getAttribute("data-wfa"), r = cur();
      if (k === "back") { sel.file = ""; saveSel(); paintTree(); paintViewer(); return; }
      if (!r) return;
      if (k === "copy") copyText(viewCode(r), a);
      else if (k === "find") { showFind = !showFind; if (!showFind) { clearFind(); paintHits(); } paintTop(); var fq = $("wfcFindQ"); if (fq) fq.focus(); }
      else if (k === "closefind") { showFind = false; clearFind(); paintHits(); paintTop(); }
      else if (k === "next") goHit(hitI + 1);
      else if (k === "prev") goHit(hitI - 1);
      else if (k === "go") { var ln = parseInt(($("wfcLine") || {}).value, 10); if (ln > 0) scrollToLine(Math.min(ln, src.length) - 1, true); }
      else if (k === "wrap") { lsSet("wfc_wrap", wrapOn() ? "0" : "1"); var ed = $("wfcEd"); ed.classList.toggle("wfc-wrap", wrapOn()); paintTop(); }
      else if (k === "hist") { showHist = !showHist; paintTop(); }
      else if (k === "more") { showMore = !showMore; paintTop(); }
      else if (k === "current") { ver = -1; var kh = showHist; paintViewer(); showHist = kh; paintTop(); }
      else if (k === "restore") { var old = r.vers.splice(ver, 1)[0]; r.vers.unshift({ code: r.code, u: r.u, lang: r.lang }); r.vers = r.vers.slice(0, MAX_VERS); r.code = old.code; r.lang = old.lang || r.lang; save(r); ver = -1; paintViewer(); paintTree(); toast("Restored that copy. The previous one is in History."); }
      else if (k === "dl") { var u = URL.createObjectURL(new Blob([viewCode(r)], { type: "text/plain" })), l = document.createElement("a"); l.href = u; l.download = r.name; document.body.appendChild(l); l.click(); setTimeout(function () { URL.revokeObjectURL(u); l.remove(); }, 800); }
      else if (k === "del") { if (confirm("Delete “" + r.name + "”? This removes it from every device.")) { r.del = true; r.code = ""; r.vers = []; save(r); sel.file = ""; saveSel(); paintTree(); paintViewer(); } }
    });
    root.addEventListener("input", function (e) {
      var t = e.target, r = cur();
      if (t.id === "wfcQ") { q = t.value; clearTimeout(qT); qT = setTimeout(paintTree, 180); return; }
      if (t.id === "wfcFindQ") { findQ = t.value; clearTimeout(qT); qT = setTimeout(runFind, 160); return; }
      if (t.id === "wfcName" && r) { if (t.value.trim()) { r.name = t.value.trim(); save(r); paintTreeSoon(); } }
    });
    root.addEventListener("change", function (e) {
      var t = e.target, r = cur();
      if (t.id === "wfcName" && r) { var nn = uniqueName(t.value.trim() || r.name, folderOk(r.folder) ? r.folder : "", r.id); if (nn !== t.value) { t.value = nn; toast("That name was taken here, so it's “" + nn + "”."); } r.name = nn; r.lang = langOf(nn, r.code); save(r); paintTree(); paintViewer(); }
      else if (t.id === "wfcLang" && r) { r.lang = t.value; save(r); paintTree(); var km = showMore; paintViewer(); showMore = km; paintTop(); }
      else if (t.id === "wfcMove" && r) moveFile(r.id, t.value);
      else if (t.id === "wfcFiles" || t.id === "wfcDir") { var list = fromInput(t.files); t.value = ""; importList(list, sel.folder); }
    });
    root.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t.id === "wfcFindQ" && e.key === "Enter") { e.preventDefault(); clearTimeout(qT); if (findQ !== t.value || !hits.length) { findQ = t.value; runFind(); } else goHit(hitI + (e.shiftKey ? -1 : 1)); }
      else if (t.id === "wfcLine" && e.key === "Enter") { e.preventDefault(); var ln = parseInt(t.value, 10); if (ln > 0) scrollToLine(Math.min(ln, src.length) - 1, true); }
      else if (t.id === "wfcName" && e.key === "Enter") { e.preventDefault(); t.blur(); }
      else if (t.id === "wfcDrop" && !(e.ctrlKey || e.metaKey) && e.key.length === 1) e.preventDefault();
    });
    document.addEventListener("keydown", function (e) {
      if (!root.classList.contains("on")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && cur()) { e.preventDefault(); showFind = true; paintTop(); var fq = $("wfcFindQ"); if (fq) { fq.focus(); fq.select(); } }
      else if (e.key === "Escape") { closePop(); if (showFind) { showFind = false; clearFind(); paintHits(); paintTop(); } }
    });
    /* selecting part of the code: copy exactly those characters (line numbers never come along) */
    root.addEventListener("copy", function (e) {
      var s = window.getSelection(); if (!s || !s.rangeCount || s.isCollapsed) return;
      var rg = s.getRangeAt(0), box = $("wfcLines"); if (!box || !box.contains(rg.commonAncestorContainer)) return;
      function pos(node, off) { var el = (node.nodeType === 1 ? node : node.parentElement); var l = el && el.closest(".l"); if (!l) return null; var idx = Array.prototype.indexOf.call(box.children, l), r2 = document.createRange(); r2.setStart(l, 0); r2.setEnd(node, off); return [idx, r2.toString().length]; }
      var a = pos(rg.startContainer, rg.startOffset), b = pos(rg.endContainer, rg.endOffset); if (!a || !b) return;
      var out = a[0] === b[0] ? src[a[0]].slice(a[1], b[1]) : [src[a[0]].slice(a[1])].concat(src.slice(a[0] + 1, b[0]), [src[b[0]].slice(0, b[1])]).join("\n");
      e.clipboardData.setData("text/plain", out); e.preventDefault();
    });
    var drop = $("wfcDrop");
    drop.addEventListener("focus", function () { drop.textContent = ""; });
    drop.addEventListener("blur", function () { paintDrop(); });
    drop.addEventListener("paste", function (e) { e.preventDefault(); e.stopPropagation(); var txt = (e.clipboardData || window.clipboardData).getData("text/plain") || ""; drop.blur(); pasteText(txt); });
    document.addEventListener("paste", function (e) {
      if (!root.classList.contains("on")) return; var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var txt = (e.clipboardData || window.clipboardData).getData("text/plain"); if (txt && txt.trim()) { e.preventDefault(); pasteText(txt); }
    });
    /* drag: external files/folders in, or move a file between folders */
    function zone(e) { return e.target.closest && e.target.closest(".wfc-fold,.wfc-root"); }
    function clearHot() { Array.prototype.forEach.call(root.querySelectorAll(".hot"), function (x) { x.classList.remove("hot"); }); }
    root.addEventListener("dragstart", function (e) { var f = e.target.closest && e.target.closest(".wfc-file"); if (!f) return; e.dataTransfer.setData("application/x-wfc", f.getAttribute("data-id")); e.dataTransfer.effectAllowed = "move"; });
    root.addEventListener("dragover", function (e) {
      var types = Array.prototype.slice.call(e.dataTransfer.types || []), internal = types.indexOf("application/x-wfc") >= 0, ext = types.indexOf("Files") >= 0;
      if (!internal && !ext) return; e.preventDefault(); clearHot();
      var z = zone(e); if (z) z.classList.add("hot"); else if (ext) drop.classList.add("hot");
    });
    root.addEventListener("dragleave", function (e) { if (!root.contains(e.relatedTarget)) clearHot(); });
    root.addEventListener("drop", async function (e) {
      var types = Array.prototype.slice.call(e.dataTransfer.types || []); if (types.indexOf("application/x-wfc") < 0 && types.indexOf("Files") < 0) return;
      e.preventDefault(); clearHot(); var z = zone(e), fid = z ? (z.getAttribute("data-fid") || "") : sel.folder;
      var id = e.dataTransfer.getData("application/x-wfc"); if (id) { moveFile(id, fid); return; }
      var list = await fromDrop(e.dataTransfer); importList(list, fid);
    });
    $("wfcAdd").addEventListener("click", function () { $("wfcFiles").click(); });
    $("wfcAddDir").addEventListener("click", function () { $("wfcDir").click(); });
    $("wfcNewF").addEventListener("click", function () { var nm = prompt("Name for the new folder" + (sel.folder ? " inside “" + pathLabel(sel.folder) + "”" : "")); if (nm && nm.trim()) { var f = newFolder(nm.trim(), sel.folder); if (sel.folder) openF[sel.folder] = 1; sel.folder = f.id; saveSel(); paintTree(); } });
    window.addEventListener("online", pull);
    window.addEventListener("resize", function () { paintDrop(); });
    setInterval(function () { if (document.visibilityState === "visible" && root.classList.contains("on")) pull(); else Object.keys(items).forEach(function (id) { if (!items[id].synced) pushSoon(id, 0); }); }, 30000);
  }

  async function boot() {
    var tries = 0; while (!mount() && tries++ < 50) await new Promise(function (r) { setTimeout(r, 100); });
    if (!$("scrCode")) { console.warn("[code] couldn't mount the Code tab"); return; }
    try { db = await openDb(); (await getAll() || []).forEach(function (r) { items[r.id] = norm(r); }); }
    catch (e) { syncErr = "This browser blocked on-device storage. Code saves to the cloud only."; put = function () { return Promise.resolve(); }; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    try { sel = Object.assign(sel, JSON.parse(lsGet("wfc_sel") || "{}")); openF = JSON.parse(lsGet("wfc_openf") || "{}") || {}; } catch (e) {}
    if (!folderOk(sel.folder)) sel.folder = ""; if (!cur() || mobile()) sel.file = "";
    paintTree(); paintViewer();
    if (lsGet(TAB_KEY) === "scrCode") show();
    var n = 0, iv = setInterval(function () { if (sb() || ++n > 100) { clearInterval(iv); if (sb()) { pull(); sb().auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_IN" || ev === "TOKEN_REFRESHED") pull(); }); } } }, 150);
    window.__wfCode = { zipBlob: zipBlob, files: function () { return all("file").length; }, folders: function () { return all("folder").length; }, pull: pull,
      add: function (name, text, dirs) { return importList([{ name: name, size: text.length, read: function () { return Promise.resolve(text); }, dirs: dirs || [] }], sel.folder); } };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
