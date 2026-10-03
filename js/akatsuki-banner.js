/* akatsuki-banner.js — the Roadmap suggestion banner, for EVERY connected app.  R022 · Oct 3
 *
 * One file, shipped by the hub, never forked.  Load after akatsuki-client.js, after sign-in:
 *   <script src="akatsuki-client.js"></script>
 *   <script src="akatsuki-banner.js"></script>
 *   const banner = AkatsukiBanner(supabase, 'cost');     // this app's id
 *   banner.start();                                       // reads on load, on focus, every 60 s
 *
 * What it does
 *   · reads doc roadmap_now (akatsuki_docs) — Roadmap owns it; this file never writes it
 *   · shows the suggestion while `until` has not passed and this app has not answered it
 *   · Start → publishes suggestion.answered {action:'start'} and STAYS in this app
 *   · Skip  → asks for a reason (required), publishes {action:'skip', reason}
 *   · ✕     → {action:'dismiss'}  (counts as a miss in Roadmap)
 *   · an answered id is remembered in localStorage akatsuki_banner_<app> so the nag stops here;
 *     it comes back on the NEXT suggestion — "repeat on every app open" is Roadmap's by issuing a new id
 *   · after `until`: a quiet line "Roadmap has nothing current — open it" (Roadmap only suggests while open)
 * Styling inherits the host app's font.  Colours are the hub's: night #07050a, red #c3242b.  🌑 is the icon.
 */
(function () {
  function AkatsukiBanner(supabase, app, opts = {}) {
    if (!supabase || !app) throw new Error('AkatsukiBanner(supabase, appId)');
    const hub = window.Akatsuki(supabase, app, { log: opts.log });
    const KEY = 'akatsuki_banner_' + app, roadmapUrl = opts.roadmapUrl || null;
    const answered = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
    const markAnswered = (id, action) => localStorage.setItem(KEY, JSON.stringify({ ...answered(), [id]: { action, at: Date.now() } }));
    let el = null, timer = null, current = null;

    function node(tag, style, text) { const n = document.createElement(tag); if (style) n.style.cssText = style; if (text != null) n.textContent = text; return n; }
    function mount() {
      if (el) return el;
      el = node('div', 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;display:none;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;background:#07050a;color:#efe8e0;border:1px solid #2a2127;box-shadow:0 8px 30px rgba(0,0,0,.45);font:inherit;font-size:14px;line-height:1.35');
      el.setAttribute('role', 'status');
      (opts.mount || document.body).appendChild(el);
      return el;
    }
    function button(label, bg, fg, onClick) {
      const b = node('button', `font:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:9px;border:0;cursor:pointer;background:${bg};color:${fg};min-height:36px`, label);
      b.onclick = onClick; return b;
    }
    async function answer(action, reason) {
      if (!current) return;
      const payload = { suggestion_id: current.id, action, at: new Date().toISOString(), app };
      if (reason) payload.reason = reason;
      try { await hub.publish({ to: 'rm', kind: 'suggestion.answered', addr: { suggestion_id: current.id }, key: `${app}:ans:${current.id}`, payload }); }
      catch (e) { console.warn('[ak banner]', e.code, e.message); if (e.contract) return; }
      markAnswered(current.id, action); render();
    }
    function render() {
      const box = mount(); box.replaceChildren(); box.style.display = 'none';
      if (!current) return;
      const expired = current.until && Date.parse(current.until) < Date.now();
      if (answered()[current.id]) return;
      box.style.display = 'flex';
      box.appendChild(node('span', 'font-size:18px;flex:none', '🌑'));
      const text = node('div', 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px');
      if (expired) {
        text.appendChild(node('div', 'color:#bfb4aa', 'Roadmap has nothing current. It only decides while it is open.'));
        if (roadmapUrl) { const a = node('a', 'color:#e8a0a0;font-weight:600', 'Open Roadmap ↗'); a.href = roadmapUrl; text.appendChild(a); }
        box.appendChild(text);
        box.appendChild(button('✕', 'transparent', '#bfb4aa', () => { markAnswered(current.id, 'seen'); render(); }));
        return;
      }
      text.appendChild(node('div', 'font-weight:600', current.say || current.title));
      if (current.say && current.title) text.appendChild(node('div', 'color:#bfb4aa;font-size:12px', current.title + (current.level ? ' · ' + current.level : '')));
      box.appendChild(text);
      const actions = node('div', 'display:flex;gap:6px;flex:none');
      actions.appendChild(button('Start', '#c3242b', '#fff', () => answer('start')));
      actions.appendChild(button('Skip', '#1d161b', '#efe8e0', () => {
        const reason = (window.prompt('Why not this one? (a reason keeps it from counting as a miss)') || '').trim();
        if (!reason) return;            // no reason = no skip; ✕ is the miss
        answer('skip', reason);
      }));
      actions.appendChild(button('✕', 'transparent', '#bfb4aa', () => answer('dismiss')));
      box.appendChild(actions);
    }
    async function read() {
      try {
        const { value } = await hub.doc('roadmap_now');
        current = value && value.suggestion ? value.suggestion : null;
      } catch (e) { console.warn('[ak banner] read failed', e.message); }
      render();
    }
    return {
      hub,
      start(ms = 60000) {
        read(); timer = setInterval(read, ms);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') read(); });
        return () => clearInterval(timer);
      },
      refresh: read,
      current: () => current
    };
  }
  window.AkatsukiBanner = AkatsukiBanner;
})();
