/* ============================================================
   Weekly Focus ⇄ Command Centre — sync bridge (v1)
   ------------------------------------------------------------
   Drop this file next to weekly-focus-app.js and load it AFTER
   the app + supabase scripts in index.html:

     <script src="wf-cc-bridge.js"></script>

   Why it lives in Weekly Focus (not CC):
   • weekly_focus_* tables are RLS-locked to your signed-in
     account — only this app has that session.
   • Command Centre tables (mind_map_app_*) accept the shared
     anon key, so this page can write both sides.

   What it does, every SYNC_INTERVAL:
   1. WF → CC: every ACTIVE Weekly Focus item becomes a task in
      mind_map_app_tasks, tagged with a CC category (= a player
      ball on the pitch). Objective text wins over the item name.
   2. CC → WF: if CC marked a synced task done, the WF entry gets
      payload.targetDone = true (shows as cleared on the board).
   3. WF item switched off / deleted → its CC task is marked done
      (archived, never hard-deleted).
   Mapping item_key → CC task id is stored in
   mind_map_app_chat_memory under key 'cf_wf_sync'.
   ============================================================ */
(function () {
  'use strict';

  // ---------------- CONFIG — edit these ----------------
  var SYNC_INTERVAL = 60000; // ms
  // WF item_key prefix → CC category (pitch ball). Must match a
  // category tag name in Command Centre (created if missing).
  var PREFIX_TO_CATEGORY = {
    'office:': 'Office',
    'study:':  'Study',
    'app:':    'Career',      // app development → Attackers
  };
  // Per-item overrides (exact item_key → category)
  var ITEM_OVERRIDES = {
    // 'app:JLPT Drills': 'AI Study',
  };
  // ------------------------------------------------------

  var MEM_KEY = 'cf_wf_sync';
  var cfg = window.WF_CONFIG || {};
  var sb = null, timer = null, busy = false;

  function client() {
    if (sb) return sb;
    if (typeof window.supabase === 'undefined' || !cfg.url) return null;
    // Reuse the app's client if it exposed one; otherwise make our own.
    sb = window.__wfSb || window.supabase.createClient(cfg.url, cfg.key);
    return sb;
  }

  function categoryFor(itemKey) {
    if (ITEM_OVERRIDES[itemKey]) return ITEM_OVERRIDES[itemKey];
    for (var p in PREFIX_TO_CATEGORY) {
      if (itemKey.indexOf(p) === 0) return PREFIX_TO_CATEGORY[p];
    }
    return null; // unmapped prefixes are skipped
  }

  function labelFor(itemKey, payload) {
    var base = itemKey.split(':').slice(1).join(':').split('/').pop();
    return (payload && payload.objective) ? payload.objective : base;
  }

  // ---- chat_memory helpers (CC-side key/value store) ----
  async function memLoad(s) {
    var r = await s.from('mind_map_app_chat_memory').select('id,value').eq('key', MEM_KEY).maybeSingle();
    if (r.error) throw r.error;
    return { id: r.data && r.data.id, map: r.data && r.data.value ? JSON.parse(r.data.value) : {} };
  }
  async function memSave(s, rec) {
    var now = new Date().toISOString();
    var val = JSON.stringify(rec.map);
    if (rec.id) await s.from('mind_map_app_chat_memory').update({ value: val, updated_at: now }).eq('id', rec.id);
    else {
      rec.id = crypto.randomUUID();
      await s.from('mind_map_app_chat_memory').insert({ id: rec.id, key: MEM_KEY, value: val, updated_at: now });
    }
  }

  // ---- CC category tag: find or create ----
  async function ensureTag(s, name, cache) {
    if (cache[name]) return cache[name];
    var r = await s.from('mind_map_app_tags').select('id').eq('name', name).eq('type', 'category').maybeSingle();
    if (r.data) { cache[name] = r.data.id; return r.data.id; }
    var id = crypto.randomUUID();
    var ins = await s.from('mind_map_app_tags').insert({
      id: id, name: name, type: 'category', color: '#7f8c8d',
      is_focused: false, sort_order: 0, created_at: new Date().toISOString(),
    }).select().single();
    if (ins.error) throw ins.error;
    cache[name] = ins.data.id;
    return ins.data.id;
  }

  async function sync() {
    if (busy) return;
    var s = client();
    if (!s) return;
    busy = true;
    try {
      var now = new Date().toISOString();
      var rec = await memLoad(s);

      // Pull both sides
      var wf = await s.from('weekly_focus_entries').select('item_key,payload').eq('board_id', cfg.board || 'my_week');
      if (wf.error) throw wf.error; // (signed out → RLS returns error/empty; just wait)
      var mappedIds = Object.values(rec.map);
      var cc = mappedIds.length
        ? await s.from('mind_map_app_tasks').select('id,name,status').in('id', mappedIds)
        : { data: [] };
      var ccById = {};
      (cc.data || []).forEach(function (t) { ccById[t.id] = t; });

      var tagCache = {};
      var seen = {};

      for (var i = 0; i < (wf.data || []).length; i++) {
        var row = wf.data[i];
        var p = row.payload || {};
        var cat = categoryFor(row.item_key);
        if (!cat) continue;
        seen[row.item_key] = true;
        var taskId = rec.map[row.item_key];
        var task = taskId ? ccById[taskId] : null;

        if (p.active && !p.targetDone) {
          if (!task) {
            // WF → CC: create the task + category tag
            var newId = crypto.randomUUID();
            var ins = await s.from('mind_map_app_tasks').insert({
              id: newId, name: '[WF] ' + labelFor(row.item_key, p),
              status: 'not_started', created_at: now, updated_at: now,
            }).select().single();
            if (ins.error) throw ins.error;
            var tagId = await ensureTag(s, cat, tagCache);
            await s.from('mind_map_app_task_tags').insert({ id: crypto.randomUUID(), task_id: newId, tag_id: tagId, created_at: now });
            rec.map[row.item_key] = newId;
          } else if (task.status === 'done') {
            // CC → WF: CC finished it — close the loop on the board
            var merged = Object.assign({}, p, { targetDone: true });
            await s.from('weekly_focus_entries')
              .update({ payload: merged, updated_at: now })
              .eq('board_id', cfg.board || 'my_week').eq('item_key', row.item_key);
          }
        } else if (task && task.status !== 'done') {
          // WF says done/inactive → archive on the CC side
          await s.from('mind_map_app_tasks').update({ status: 'done', updated_at: now }).eq('id', task.id);
        }
      }

      // WF item deleted entirely → archive its CC task, drop mapping
      for (var key in rec.map) {
        if (!seen[key] && categoryFor(key)) {
          var tid = rec.map[key];
          if (ccById[tid] && ccById[tid].status !== 'done') {
            await s.from('mind_map_app_tasks').update({ status: 'done', updated_at: now }).eq('id', tid);
          }
          delete rec.map[key];
        }
      }

      await memSave(s, rec);
      window.dispatchEvent(new CustomEvent('wf-cc-synced'));
    } catch (e) {
      console.warn('[wf-cc-bridge]', e.message || e);
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(sync, SYNC_INTERVAL);
    setTimeout(sync, 4000); // first pass after the app settles
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);

  // Manual hook: WF_CC_SYNC.now() from the console
  window.WF_CC_SYNC = { now: sync };
})();
