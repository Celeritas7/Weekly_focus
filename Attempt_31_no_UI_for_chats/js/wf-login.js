/* Weekly Focus — v57 login gate + Vault PIN. Self-contained; loads after weekly-focus-app.js.
   Uses window.__wfSb (the app's Supabase client). Locked = nothing but the login screen is visible.
   Session policy: 30 days from sign-in, enforced here (Supabase refresh tokens never expire on their own).
   Vault PIN: 6 digits, SHA-256 hashed in localStorage, asked every session, relocks after 5 min idle. */
(function () {
  var DAYS = 30, IDLE_MS = 5 * 60 * 1000, PIN_LEN = 6;
  var K_AT = "wf_login_at", K_PIN = "wf_vault_pin";
  var $ = function (id) { return document.getElementById(id); };
  var sb = null, email = "", code = "", codeSent = false, screen = "signin", vaultOpen = false, idleT = null, pin = "", pinStage = "enter", pinFirst = "", pending = null;

  var LAMP = '<svg width="SZ" height="SZ" viewBox="0 0 100 100"><defs><radialGradient id="wfl-g"><stop offset="0" stop-color="#8cebaf" stop-opacity=".5"/><stop offset=".55" stop-color="#8cebaf" stop-opacity=".16"/><stop offset="1" stop-color="#8cebaf" stop-opacity="0"/></radialGradient></defs><circle cx="54" cy="52" r="34" fill="url(#wfl-g)"/><ellipse cx="30" cy="87" rx="23" ry="5.6" fill="#fff"/><g stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M30 85 20 54 46 32"/></g><circle cx="20" cy="54" r="5.5" fill="#fff"/><g transform="translate(54,28) rotate(-34)"><path d="M-11-4h22l9 28h-40z" fill="#fff"/><rect x="-20" y="22" width="40" height="4.6" rx="2.3" fill="#4fc37f"/></g></svg>';
  var GICON = '<svg width="17" height="17" viewBox="0 0 48 48"><path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-4H24v7.5h12c-.2 2-1.5 5-4.4 7l6.7 5.2C42.2 36 45 30.6 45 24z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.7-5.2c-1.8 1.3-4.3 2.2-7.8 2.2-6 0-11-4-12.8-9.4l-7 5.4C7.8 41 15.3 46 24 46z"/><path fill="#FBBC05" d="M11.2 28.3c-.5-1.4-.7-2.8-.7-4.3s.3-3 .7-4.3l-7-5.4C2.8 17.1 2 20.4 2 24s.8 6.9 2.2 9.7l7-5.4z"/><path fill="#EA4335" d="M24 9.5c3.3 0 5.6 1.4 6.9 2.6l5.9-5.8C33 3 28.9 1 24 1 15.3 1 7.8 6 4.2 14.3l7 5.4C13 14.3 18 9.5 24 9.5z"/></svg>';
  function lamp(sz) { return LAMP.replace(/SZ/g, sz); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function keypad() { var h = '<div class="wfl-key">'; for (var i = 1; i <= 9; i++) h += '<button type="button" data-wfl-d="' + i + '">' + i + '</button>'; return h + '<button type="button" class="blank" tabindex="-1"></button><button type="button" data-wfl-d="0">0</button><button type="button" data-wfl-back aria-label="Delete">&#9003;</button></div>'; }

  /* ---------------- login screen ---------------- */
  function ensureLogin() {
    if ($("wflScreen")) return;
    var d = document.createElement("div"); d.id = "wflScreen"; d.className = "wfl-screen"; d.setAttribute("aria-hidden", "true");
    document.body.appendChild(d);
    d.addEventListener("click", onLoginClick);
    d.addEventListener("keydown", function (e) { if (e.key === "Enter" && screen === "signin") sendCode(); });
  }
  function paintLogin(status, warn) {
    var d = $("wflScreen"); if (!d) return;
    var h = "";
    if (screen === "code") {
      h = '<div class="wfl-band sm">' + lamp(52) + '<div class="wfl-wm">Weekly Focus</div></div><div class="wfl-body">' +
        '<div><h1 class="wfl-h">Enter your code</h1><p class="wfl-sub">Sent to <b>' + esc(email) + '</b> &middot; <a data-wfl="back">change</a></p></div>' +
        '<div class="wfl-cells">' + cells(code, PIN_LEN) + '</div>' +
        '<input id="wflHidden" class="wfl-hidden" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6-digit code">' +
        '<p class="wfl-status' + (warn ? " warn" : "") + '">' + (status || "") + '</p>' +
        '<div class="wfl-resend">Didn&rsquo;t arrive? <a data-wfl="resend">Send again</a></div>' + keypad() + '</div>';
    } else {
      var expired = screen === "expired";
      h = '<div class="wfl-band">' + lamp(expired ? 64 : 72) + '<div class="wfl-ttl"><h1 class="wfl-h light">' + (expired ? "Session expired" : "Weekly Focus") + '</h1><p class="wfl-sub light">' + (expired ? DAYS + " days since you last signed in." : "One must, four cans, every week.") + '</p></div></div><div class="wfl-body">' +
        (expired && !navigator.onLine ? '<div class="wfl-note">You&rsquo;re offline. Sign in again when you have signal &mdash; nothing has been lost.</div>' : "") +
        '<button type="button" class="wfl-btn g" data-wfl="google">' + GICON + 'Continue with Google</button><div class="wfl-or">or</div>' +
        '<div><label class="wfl-lab" for="wflEmail">Email</label><input id="wflEmail" class="wfl-in" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(email) + '"></div>' +
        '<button type="button" class="wfl-btn p" data-wfl="send">Email me a 6-digit code</button>' +
        '<p class="wfl-status' + (warn ? " warn" : "") + '">' + (status || "") + '</p>' +
        '<p class="wfl-foot">Stays signed in for ' + DAYS + ' days on this device.<br>Everything lives behind sign-in.</p></div>';
    }
    d.innerHTML = h;
    if (screen === "code") { var hi = $("wflHidden"); if (hi) { hi.value = code; hi.addEventListener("input", function () { code = hi.value.replace(/\D/g, "").slice(0, PIN_LEN); paintCodeCells(); if (code.length === PIN_LEN) verify(); }); } }
  }
  function cells(v, n) { var h = ""; for (var i = 0; i < n; i++) h += '<div class="wfl-cell' + (i === v.length ? " f" : "") + '">' + (v[i] || "") + '</div>'; return h; }
  function paintCodeCells() { var c = document.querySelector("#wflScreen .wfl-cells"); if (c) c.innerHTML = cells(code, PIN_LEN); }
  function setStatus(msg, warn) { var s = document.querySelector("#wflScreen .wfl-status"); if (s) { s.innerHTML = msg || ""; s.className = "wfl-status" + (warn ? " warn" : ""); } }
  function show(sc, status, warn) { screen = sc; ensureLogin(); paintLogin(status, warn); document.body.classList.add("wf-locked"); $("wflScreen").setAttribute("aria-hidden", "false"); lockVault(); }
  function hide() { document.body.classList.remove("wf-locked"); var d = $("wflScreen"); if (d) { d.setAttribute("aria-hidden", "true"); d.innerHTML = ""; } }

  function onLoginClick(e) {
    var a = e.target.closest("[data-wfl]"), d = e.target.closest("[data-wfl-d]"), b = e.target.closest("[data-wfl-back]");
    if (a) { var k = a.getAttribute("data-wfl"); if (k === "google") google(); else if (k === "send" || k === "resend") sendCode(); else if (k === "back") { code = ""; show("signin"); } return; }
    if (d && screen === "code" && code.length < PIN_LEN) { code += d.getAttribute("data-wfl-d"); paintCodeCells(); if (code.length === PIN_LEN) verify(); return; }
    if (b && screen === "code") { code = code.slice(0, -1); paintCodeCells(); }
  }
  function client() { sb = window.__wfSb || sb; return sb; }
  async function google() {
    if (!client()) { setStatus("Couldn&rsquo;t reach the sign-in service. Check your connection.", true); return; }
    setStatus("Opening Google&hellip;");
    try { var r = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }); if (r.error) throw r.error; }
    catch (e) { setStatus("Google sign-in failed: " + esc(e.message || e) + ". Use the code instead.", true); }
  }
  async function sendCode() {
    var inp = $("wflEmail"); if (inp) email = (inp.value || "").trim();
    if (!email) { setStatus("Enter your email first.", true); return; }
    if (!client()) { setStatus("Couldn&rsquo;t reach the sign-in service. Check your connection.", true); return; }
    setStatus("Sending&hellip;");
    try { var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } }); if (r.error) throw r.error; codeSent = true; code = ""; show("code", "Type the code from the email &mdash; no need to open the link."); var hi = $("wflHidden"); if (hi) hi.focus(); }
    catch (e) { setStatus("Couldn&rsquo;t send the code: " + esc(e.message || e), true); }
  }
  async function verify() {
    if (!client()) return;
    setStatus("Checking&hellip;");
    try { var r = await sb.auth.verifyOtp({ email: email, token: code, type: "email" }); if (r.error) throw r.error; setStatus("Signed in &#10003; &mdash; loading your week&hellip;"); }
    catch (e) { code = ""; paintCodeCells(); setStatus("That code didn&rsquo;t work &mdash; " + esc(e.message || e) + ". Codes expire after a few minutes; send again for a fresh one.", true); }
  }

  /* ---------------- session policy ---------------- */
  function expired() { var at = +ls(K_AT) || 0; return at > 0 && Date.now() - at > DAYS * 864e5; }
  async function onAuth(event, sess) {
    if (event === "SIGNED_IN") { if (!ls(K_AT)) ls(K_AT, String(Date.now())); }
    if (sess && sess.user) {
      if (expired()) { ls(K_AT, null); ls(K_PIN, null); try { await sb.auth.signOut(); } catch (e) {} show("expired"); return; }
      if (!ls(K_AT)) ls(K_AT, String(Date.now()));
      email = sess.user.email || email; hide(); paintProfile(sess); return;
    }
    if (event === "SIGNED_OUT") { ls(K_AT, null); ls(K_PIN, null); lockVault(); }
    if (screen !== "code") show(expired() ? "expired" : "signin");
  }
  function daysLeft() { var at = +ls(K_AT) || Date.now(); return Math.max(0, Math.ceil((at + DAYS * 864e5 - Date.now()) / 864e5)); }
  function paintProfile(sess) {
    var who = $("authWho"); if (who) who.textContent = (sess.user.email || "your account") + " \u00b7 " + daysLeft() + " days left";
  }

  /* ---------------- Vault PIN ---------------- */
  function hasPin() { return !!ls(K_PIN); }
  async function sha(s) { var b = new TextEncoder().encode("wf|" + s); var h = await crypto.subtle.digest("SHA-256", b); return Array.prototype.map.call(new Uint8Array(h), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function vaultShowing() { return !!document.querySelector(".vault-note, .vault-item, .vault-addbtn"); }
  function lockVault() {
    vaultOpen = false; clearTimeout(idleT); idleT = null;
    if (vaultShowing()) { var back = document.querySelector('.chat-back [data-cfold="@back"], .chat-back [data-cfold="@vault"]'); var f = document.querySelector('.chat-back [data-cfold="@back"]'); (f || back) && (f || back).click(); }
    closePin();
  }
  function touch() { if (!vaultOpen) return; clearTimeout(idleT); idleT = setTimeout(lockVault, IDLE_MS); }
  function openPin(then) {
    pending = then; pin = ""; pinFirst = ""; pinStage = hasPin() ? "enter" : "set";
    var d = $("wflPin"); if (!d) { d = document.createElement("div"); d.id = "wflPin"; d.className = "wfl-pinbg"; document.body.appendChild(d); d.addEventListener("click", onPinClick); }
    paintPin(); d.classList.add("open");
  }
  function closePin() { var d = $("wflPin"); if (d) { d.classList.remove("open"); d.innerHTML = ""; } pending = null; }
  function paintPin(status, warn) {
    var d = $("wflPin"); if (!d) return;
    var title = pinStage === "set" ? "Set a Vault PIN" : pinStage === "confirm" ? "Type it again" : "Enter your PIN";
    var sub = pinStage === "enter" ? "Bank details, cards, passwords." : "6 digits. Works offline; asked once per session.";
    var dots = ""; for (var i = 0; i < PIN_LEN; i++) dots += '<span class="wfl-dot' + (i < pin.length ? " on" : "") + '"></span>';
    d.innerHTML = '<div class="wfl-pin"><div class="wfl-band sm">' + lamp(52) + '<div class="wfl-wm">Vault</div><button type="button" class="wfl-x" data-wflp="close" aria-label="Close">&times;</button></div><div class="wfl-body">' +
      '<div class="c"><h1 class="wfl-h">' + title + '</h1><p class="wfl-sub">' + sub + '</p></div><div class="wfl-dots">' + dots + '</div>' +
      '<p class="wfl-status' + (warn ? " warn" : "") + '">' + (status || "") + '</p>' + keypad() +
      '<p class="wfl-foot">' + (pinStage === "enter" ? 'Locks again after 5 minutes idle. <a data-wflp="forgot">Forgot PIN?</a>' : "Stored only on this device, hashed.") + '</p></div></div>';
  }
  function paintDots() { var ds = document.querySelectorAll("#wflPin .wfl-dot"); for (var i = 0; i < ds.length; i++) ds[i].classList.toggle("on", i < pin.length); }
  async function onPinClick(e) {
    var a = e.target.closest("[data-wflp]"), d = e.target.closest("[data-wfl-d]"), b = e.target.closest("[data-wfl-back]");
    if (e.target === $("wflPin") || (a && a.getAttribute("data-wflp") === "close")) { closePin(); return; }
    if (a && a.getAttribute("data-wflp") === "forgot") { if (confirm("Reset the Vault PIN? You\u2019ll be signed out and can set a new one after signing in.")) { ls(K_PIN, null); if (client()) { try { await sb.auth.signOut(); } catch (x) {} } } return; }
    if (b) { pin = pin.slice(0, -1); paintDots(); return; }
    if (!d || pin.length >= PIN_LEN) return;
    pin += d.getAttribute("data-wfl-d"); paintDots();
    if (pin.length < PIN_LEN) return;
    var h = await sha(pin);
    if (pinStage === "set") { pinFirst = h; pin = ""; pinStage = "confirm"; paintPin(); return; }
    if (pinStage === "confirm") { if (h !== pinFirst) { pin = ""; pinStage = "set"; paintPin("Those didn\u2019t match \u2014 start again.", true); return; } ls(K_PIN, h); }
    else if (h !== ls(K_PIN)) { pin = ""; setTimeout(function () { paintPin("Wrong PIN.", true); }, 120); return; }
    vaultOpen = true; touch(); var go = pending; closePin(); if (go) go();
  }
  function guardVault() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest('[data-cfold^="@vault"]'); if (!t || vaultOpen) return;
      e.stopPropagation(); e.preventDefault();
      openPin(function () { t.click(); });
    }, true);
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true }); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { clearTimeout(idleT); idleT = setTimeout(lockVault, IDLE_MS); } });
    // If the chats view was left inside the Vault on last visit, back out until unlocked.
    var tries = 0, iv = setInterval(function () { if (vaultShowing()) { lockVault(); clearInterval(iv); } if (++tries > 40) clearInterval(iv); }, 250);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    ensureLogin(); guardVault();
    var n = 0, iv = setInterval(function () {
      if (window.__wfSb) { clearInterval(iv); sb = window.__wfSb; sb.auth.onAuthStateChange(onAuth); sb.auth.getSession().then(function (r) { var s = r && r.data ? r.data.session : null; if (!s) onAuth("INITIAL_SESSION", null); }); return; }
      if (++n > 60) { clearInterval(iv); show("signin", navigator.onLine ? "" : "You&rsquo;re offline and not signed in on this device.", !navigator.onLine); }
    }, 100);
    // Until the client answers, keep the app hidden so nothing flashes before the gate.
    document.body.classList.add("wf-locked");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
