/* ============================================================
   Weekly Focus  ⇄  Command Centre "Brain v2" — sync bridge (v2)
   ------------------------------------------------------------
   Drop next to weekly-focus-app.js, load AFTER the app + supabase
   scripts in index.html:  <script src="wf-cc-bridge-v2.js"></script>

   Why it lives inside Weekly Focus (not CC):
   • It needs the WF page's Supabase session to read/write
     weekly_focus_entries (reuses window.__wfSb; anon fallback works
     while that table's RLS is off, and keeps working if it's re-enabled).
   • All command_centre_* tables have a permissive USING(true) policy,
     so the same client can write them too.

   This bridge translates WF *focus* into the brain's *team/priority*
   vocabulary. It creates NO tasks (Brain v2 has no tasks table).

   ── Data model discovered on the live board (NOT guessed) ──────────
   • "The Five" is NOT a per-item flag. Membership + order live on a
     single synthetic row  item_key = '__board'  in
     payload.targetOrder  — an ordered array of item_key strings
     (rank = array index, max 5). Example seen live:
       targetOrder = ["app:mr0vhqy33qn43","app:Commonplace",
                      "app:Deployops","app:mr0vcrc9ko9ta"]
   • A member's "target cleared" state is payload.targetDone (bool) on
     that member's OWN row.
   • Per-item "switched on this week" is payload.active (bool).
   • payload.objective is essentially unused in real data, so labels
     fall back to a name derived from the item_key tail.
   • CC's `study_nudge` is a *trigger* definition (brain_settings.triggers),
     not a live alert row. Per spec the bridge NEVER touches CC-authored
     alerts — it maintains its OWN nudge alert, tracked by id in the map.

   What it does every SYNC_INTERVAL (see §-refs to BRIDGE-PROMPT.md):
   1. Read WF entries for the board (incl. the __board row).
   2. Read CC: active_team singleton + wf_focus + wf_cc_bridge_map settings
      + the bridge's tracked alert.
   3. Build the wf_focus priority feed (active items + The Five); write
      only if changed (diff, no updated_at churn).                     §3
   4. Reflect CC "now" onto WF: payload.ccActive = (squad === active_team);
      write only rows whose ccActive actually flips.                   §5.4
   5. Study-nudge coupling: when active_team is the study squad AND a
      study: item is active & not done, keep one named 'nudge' alert;
      otherwise deactivate the bridge's own alert.                     §5.5
   6. (Gated, default OFF) set base_team to the top WF squad when the
      interrupt stack is empty.                                        §5.6
   7. Persist the map; dispatch window event 'wf-cc-synced'.

   Manual: WF_CC_SYNC.now() forces a pass from the console.
   ============================================================ */
(function () {
  'use strict';

  // ------------------------- CONFIG (§6) -------------------------
  var SYNC_INTERVAL = 60000;                 // ms between passes
  var BOARD = 'my_week';                      // overridden by WF_CONFIG.board
  var PREFIX_TO_SQUAD = { 'app:': 'coding', 'study:': 'language_study', 'office:': 'work' };
  var ITEM_OVERRIDES = {};                    // exact item_key → squad
  var STUDY_SQUAD = 'language_study';         // squad that the study nudge couples to
  var SET_BASE_TEAM_FROM_WF = false;          // §2 decision point — WF drives base_team? default NO
  var COUPLE_STUDY_NUDGE = true;              // §5 step 5
  // §5.5 says the nudge fires only when active_team IS the study squad; §2 reads
  // team-independent. Default follows §5.5. Flip to false for the §2 reading
  // (nudge whenever a study target is active & not done, regardless of active_team).
  var NUDGE_REQUIRES_STUDY_TEAM = false;
  // ---------------------------------------------------------------

  var BOARD_ROW = '__board';                  // synthetic WF row holding The Five
  var WF_FOCUS_KEY = 'wf_focus';              // settings key the brain reads (§3)
  var MAP_KEY = 'wf_cc_bridge_map';           // settings key for our own state (§4)
  var ALERT_TYPE = 'study_nudge';             // type stamped on the alert we own

  var cfg = window.WF_CONFIG || {};
  var board = cfg.board || BOARD;
  var sb = null, timer = null, busy = false;

  function nowISO() { return new Date().toISOString(); }
  function stable(v) { return JSON.stringify(v); }

  // Prefer the WF app's authenticated client; else build an anon one.
  function client() {
    if (sb) return sb;
    if (window.__wfSb) { sb = window.__wfSb; return sb; }
    if (typeof window.supabase === 'undefined' || !cfg.url || !cfg.key) return null;
    sb = window.supabase.createClient(cfg.url, cfg.key);
    return sb;
  }

  // item_key → squad, or null for unmapped prefixes (skipped everywhere).
  function squadFor(itemKey) {
    if (ITEM_OVERRIDES[itemKey]) return ITEM_OVERRIDES[itemKey];
    var ps = Object.keys(PREFIX_TO_SQUAD);
    for (var i = 0; i < ps.length; i++) { if (itemKey.indexOf(ps[i]) === 0) return PREFIX_TO_SQUAD[ps[i]]; }
    return null;
  }

  // Objective wins; else the human tail of the namespaced key.
  function labelFor(itemKey, p) {
    if (p && p.objective && p.objective.trim()) return p.objective.trim();
    var tail = itemKey.split(':').slice(1).join(':');
    return (tail.split('/').pop() || itemKey);
  }

  function isActive(p) { return !!(p && p.active === true); }
  function isDone(p) { return !!(p && p.targetDone === true); }

  // ---------- brain_settings key/value helpers (value is jsonb) ----------
  async function getSetting(s, key) {
    var r = await s.from('command_centre_brain_settings').select('value').eq('key', key).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? r.data.value : null;
  }
  async function putSetting(s, key, value) {
    var r = await s.from('command_centre_brain_settings').upsert({ key: key, value: value, updated_at: nowISO() }, { onConflict: 'key' });
    if (r.error) throw r.error;
  }

  // ----------------------------- sync loop -----------------------------
  async function sync() {
    if (busy) return;
    var s = client();
    if (!s) return;
    busy = true;
    try {
      // 1. WF rows for the board (signed out + RLS on → error/empty → skip quietly).
      var wf = await s.from('weekly_focus_entries').select('item_key,payload').eq('board_id', board);
      if (wf.error) throw wf.error;
      var rows = wf.data || [];
      var byKey = {}, boardPayload = null;
      rows.forEach(function (r) {
        if (r.item_key === BOARD_ROW) boardPayload = r.payload || {};
        else byKey[r.item_key] = r.payload || {};
      });
      var targetOrder = (boardPayload && Array.isArray(boardPayload.targetOrder)) ? boardPayload.targetOrder : [];

      // 2. CC side.
      var at = await s.from('command_centre_active_team')
        .select('active_team,base_team,interrupt_stack').eq('id', 'singleton').maybeSingle();
      if (at.error) throw at.error;
      var activeTeam = at.data ? at.data.active_team : null;
      var baseTeam = at.data ? at.data.base_team : null;
      var stack = (at.data && Array.isArray(at.data.interrupt_stack)) ? at.data.interrupt_stack : [];

      var wfFocusPrev = await getSetting(s, WF_FOCUS_KEY);
      var map = (await getSetting(s, MAP_KEY)) || {};
      if (!map.items) map.items = {};
      if (!('studyAlert' in map)) map.studyAlert = null;
      var mapBefore = stable(map);   // idle-diff guard: only persist the map if it changes

      // 3. Build the wf_focus priority feed (§3). Order: the_five keeps
      //    targetOrder rank; active[] is alpha-sorted for a stable diff.
      var activeArr = [];
      Object.keys(byKey).forEach(function (k) {
        var sq = squadFor(k), p = byKey[k];
        if (!sq || !isActive(p)) return;
        activeArr.push({ item_key: k, squad: sq, objective: (p.objective || ''), done: isDone(p) });
      });
      activeArr.sort(function (a, b) { return a.item_key < b.item_key ? -1 : a.item_key > b.item_key ? 1 : 0; });

      var fiveArr = [];
      targetOrder.forEach(function (k) {
        var sq = squadFor(k); if (!sq) return;               // unmapped members skipped
        var p = byKey[k] || {};
        fiveArr.push({ item_key: k, squad: sq, objective: (p.objective || ''), done: isDone(p) });
      });

      var feedCore = { board: board, the_five: fiveArr, active: activeArr };
      var prevCore = wfFocusPrev
        ? { board: wfFocusPrev.board, the_five: wfFocusPrev.the_five, active: wfFocusPrev.active }
        : null;
      if (!prevCore || stable(prevCore) !== stable(feedCore)) {
        await putSetting(s, WF_FOCUS_KEY, {
          board: board, updated_at: nowISO(), the_five: fiveArr, active: activeArr
        });
      }

      // 4. CC → WF reflection: payload.ccActive. Write only flipped rows.
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.item_key === BOARD_ROW) continue;
        var p4 = row.payload || {}, sq4 = squadFor(row.item_key);
        if (!sq4) continue;                                   // only mapped items reflect
        var desired = (activeTeam != null && sq4 === activeTeam);
        var current = (p4.ccActive === true);
        if (desired !== current) {
          var merged = Object.assign({}, p4, { ccActive: desired });
          var up = await s.from('weekly_focus_entries')
            .update({ payload: merged, updated_at: nowISO() })
            .eq('board_id', board).eq('item_key', row.item_key);
          if (up.error) throw up.error;
          byKey[row.item_key] = merged;
        }
        map.items[row.item_key] = { lastSquad: sq4, lastCcActive: desired };
      }

      // 5. Study-nudge coupling (§5.5).
      if (COUPLE_STUDY_NUDGE) await coupleStudyNudge(s, map, activeTeam, byKey, targetOrder);

      // 6. Optional: WF drives base_team when the interrupt stack is empty (§5.6).
      if (SET_BASE_TEAM_FROM_WF && at.data && stack.length === 0) {
        var top = fiveArr[0] || activeArr[0];
        var topSquad = top ? top.squad : null;
        if (topSquad && topSquad !== baseTeam) {
          var bt = await s.from('command_centre_active_team')
            .update({ base_team: topSquad, updated_at: nowISO() }).eq('id', 'singleton');
          if (bt.error) throw bt.error;
        }
      }

      // 7. Persist our map (only if it changed — no idle updated_at churn) + announce.
      if (stable(map) !== mapBefore) await putSetting(s, MAP_KEY, map);
      window.dispatchEvent(new CustomEvent('wf-cc-synced'));
    } catch (e) {
      console.warn('[wf-cc-bridge-v2]', (e && e.message) || e);
    } finally {
      busy = false;
    }
  }

  // Maintain exactly one bridge-owned 'nudge' alert naming a real WF study
  // target. Only ever reads/writes the alert whose id we stored in the map —
  // never a CC-authored alert.
  async function coupleStudyNudge(s, map, activeTeam, byKey, targetOrder) {
    function eligible(k) {
      var p = byKey[k];
      return squadFor(k) === STUDY_SQUAD && !!(p && p.active === true) && !(p && p.targetDone === true);
    }
    // Rank: a study target inside The Five first (in Five order), else the
    // first active study item alphabetically.
    var chosen = null;
    for (var i = 0; i < targetOrder.length; i++) { if (eligible(targetOrder[i])) { chosen = targetOrder[i]; break; } }
    if (!chosen) {
      var rest = Object.keys(byKey).filter(eligible).sort();
      if (rest.length) chosen = rest[0];
    }

    var tracked = map.studyAlert;                 // { id, itemKey, objective } | null
    var alertRow = null;
    if (tracked && tracked.id) {
      var r = await s.from('command_centre_alerts')
        .select('id,active,dismissed_at,title,message').eq('id', tracked.id).maybeSingle();
      if (!r.error) alertRow = r.data;            // null if the row was deleted
    }

    var teamOk = NUDGE_REQUIRES_STUDY_TEAM ? (activeTeam === STUDY_SQUAD) : true;

    if (chosen && teamOk) {
      var label = labelFor(chosen, byKey[chosen] || {});
      var title = '📚 Study: ' + label;                    // 📚
      var message = 'Weekly Focus target active — ' + label;
      var data = { source: 'wf-cc-bridge-v2', item_key: chosen, objective: label };
      if (alertRow) {
        if (alertRow.dismissed_at) {
          // User dismissed it — respect that, don't resurrect. Keep tracking.
        } else if (alertRow.active !== true || alertRow.title !== title || alertRow.message !== message) {
          await s.from('command_centre_alerts')
            .update({ active: true, title: title, message: message, data: data, renderer: 'nudge' })
            .eq('id', tracked.id);
        }
        map.studyAlert = { id: tracked.id, itemKey: chosen, objective: label };
      } else {
        var id = crypto.randomUUID();
        var ins = await s.from('command_centre_alerts').insert({
          id: id, type: ALERT_TYPE, renderer: 'nudge',
          title: title, message: message, data: data, active: true, created_at: nowISO()
        });
        if (ins.error) throw ins.error;
        map.studyAlert = { id: id, itemKey: chosen, objective: label };
      }
    } else {
      // No eligible study target (or the brain isn't on the study squad):
      // silence our own alert. Never deactivate a user-dismissed row again.
      if (alertRow && alertRow.active === true && !alertRow.dismissed_at) {
        await s.from('command_centre_alerts').update({ active: false }).eq('id', tracked.id);
      }
      if (!alertRow) map.studyAlert = null;       // row is gone → allow a fresh one later
    }
  }

  // ------------------------------ boot ------------------------------
  function start() {
    if (timer) return;
    timer = setInterval(sync, SYNC_INTERVAL);
    setTimeout(sync, 4000);                        // first pass once the app settles
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);

  window.WF_CC_SYNC = { now: sync };               // console/manual hook
})();
