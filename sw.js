/* Weekly Focus — service worker (offline app shell for the train).
   Caches the page + assets so it opens with no signal. Supabase API calls are
   never cached; the app's outbox queues edits and syncs them when back online. */
/* BUMP THIS CONSTANT ON EVERY DEPLOY so browsers reinstall the new build and the
   activate handler purges older caches (stops a stale build being served). */
const CACHE = "weekly-focus-v124";
/* v105: the Supabase library is cached too. Without it the app had no client offline, so the
   stored session could not be read and every offline open landed on the sign-in screen. */
const SUPA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
const ASSETS = [
  "./", "./index.html",
  "./js/config.js", "./js/akatsuki-client.js", "./js/akatsuki-banner.js", "./js/wf-purchase-adapter.js", "./js/weekly-focus-app.js", "./js/info-feeds.js", "./js/wf-cc-bridge-v2.js",
  "./css/weekly-focus.css", "./css/home-screens.css", "./css/wf-login.css", "./js/wf-login.js", "./js/wf-code-hl.js", "./js/wf-code.js", "./js/wf-logos.js", "./js/wf-sphere-draft.js", "./js/wf-zip.js", "./css/wf-sphere-draft.css",
  "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).then(() => c.add(SUPA).catch(() => {})))   // the library is best-effort: a CDN hiccup must not block the install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // v105: the Supabase library — cache-first, refreshed in the background when online.
  if (url.href === SUPA) {
    e.respondWith(
      caches.match(SUPA).then((hit) => {
        const net = fetch(req).then((r) => { if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(SUPA, cp)); } return r; }).catch(() => hit);
        return hit || net;
      })
    );
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
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", cp)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // v113: a sibling app on this origin (logo lookups read its page and icon) goes straight to the network and is never cached,
  // or a changed logo would be served from this app's cache until the next deploy.
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  // Static same-origin assets (css/js/icons): cache-first, then network (and cache it).
  e.respondWith(
    caches.match(req).then((c) => c || fetch(req).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((cache) => cache.put(req, cp)); return r;
    }).catch(() => c || new Response("", { status: 504, statusText: "offline" })))
  );
});
