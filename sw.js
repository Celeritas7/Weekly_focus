/* Weekly Focus — service worker (offline app shell for the train).
   Caches the page + assets so it opens with no signal. Supabase API calls are
   never cached; the app's outbox queues edits and syncs them when back online. */
/* BUMP THIS CONSTANT ON EVERY DEPLOY so browsers reinstall the new build and the
   activate handler purges older caches (stops a stale build being served). */
const CACHE = "weekly-focus-v165";
/* v144: app logos (Akatsuki's logo store, sibling apps' icons) live in their own cache, kept across builds, so the
   sphere shows them offline. Served from the cache at once and refreshed in the background (a changed logo shows on
   the next open). Capped at LOGO_MAX entries. */
const LOGOS = "wf-logos-v1", LOGO_MAX = 300;
/* v162: pinned same-origin auth library; offline installation never waits on a CDN. */
const ASSETS = [
  "./", "./index.html", "./js/vendor/supabase-2.119.0.js",
  "./js/config.js", "./js/akatsuki-client.js", "./js/akatsuki-banner.js", "./js/wf-purchase-adapter.js", "./js/wf-task-data.js?v=165", "./js/wf-task-engine.js?v=165", "./js/weekly-focus-app.js?v=165", "./js/info-feeds.js", "./js/wf-cc-bridge-v2.js?v=165",
  "./css/weekly-focus.css", "./css/home-screens.css?v=153", "./css/wf-login.css?v=165", "./js/wf-login.js?v=165", "./js/wf-code-hl.js", "./js/wf-code.js?v=165", "./css/wf-code-browser.css?v=165", "./js/wf-logos.js", "./js/wf-sphere-draft.js?v=165", "./js/wf-zip.js", "./css/wf-sphere-draft.css?v=165",
  "./css/wf-detail-ui.css?v=165", "./js/wf-detail-ui.js?v=156",
  "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => /^weekly-focus-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // v144: logo images — cached copy at once, refreshed in the background; offline the cached copy is all there is.
  if (req.method === "GET" && req.destination === "image" && isLogo(url)) {
    e.respondWith(caches.open(LOGOS).then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((r) => {
        if (r && (r.ok || r.type === "opaque")) { c.put(req, r.clone()).then(() => trimLogos(c)); }
        return r;
      }).catch(() => hit || new Response("", { status: 504, statusText: "offline" }));
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })));
    return;
  }

  // Never intercept Supabase / cross-origin API calls — straight to network.
  if (url.origin !== self.location.origin || url.pathname.includes("/rest/v1/")) return;

  // v105: ?nocache= bypasses the cache entirely (the app's build check reads the live sw.js this way).
  if (url.searchParams.has("nocache")) return;

  // The page itself: network-first (so new versions land), cache fallback offline.
  // v121: only the app's own page is cached as the offline shell; other pages (share.html) go straight to the network
  if (req.mode === "navigate" && !/\/(index\.html)?$/.test(url.pathname)) return;
  if (req.mode === "navigate") {
    e.respondWith(
      Promise.race([
        fetch(req).then((r) => {
          if (!r.ok || !/text\/html/i.test(r.headers.get("content-type") || "")) throw new Error("Invalid app page");
          const cp = r.clone(); return caches.open(CACHE).then((c) => c.put("./index.html", cp)).catch(() => {}).then(() => r);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Slow navigation")), 5000))
      ]).catch(() => caches.open(CACHE).then((c) => c.match("./index.html")).then((hit) => hit || new Response("Weekly Focus could not open. Check your connection and reload. Your saved work has not been cleared.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })))
    );
    return;
  }

  // v113: a sibling app on this origin (logo lookups read its page and icon) goes straight to the network and is never cached,
  // or a changed logo would be served from this app's cache until the next deploy.
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  // Static same-origin assets (css/js/icons): cache-first, then network (and cache it).
  e.respondWith(
    caches.match(req).then((c) => c || fetch(req).then((r) => {
      if (r.ok) { const cp = r.clone(); return caches.open(CACHE).then((cache) => cache.put(req, cp)).catch(() => {}).then(() => r); }
      return r;
    }).catch(() => c || new Response("", { status: 504, statusText: "offline" })))
  );
});

/* v144: which images are logos — Akatsuki's logo store (Supabase storage) and icons of sibling apps on GitHub Pages
   (same origin as this app but outside its folder). This app's own icons stay in the build cache. */
function isLogo(url) {
  if (url.pathname.includes("/storage/v1/object/")) return true;
  if (/\.github\.io$/.test(url.hostname)) {
    const scope = new URL(self.registration.scope);
    return !(url.origin === scope.origin && url.pathname.startsWith(scope.pathname));
  }
  return false;
}
function trimLogos(c) {
  return c.keys().then((ks) => { if (ks.length <= LOGO_MAX) return; return Promise.all(ks.slice(0, ks.length - LOGO_MAX).map((k) => c.delete(k))); });
}
