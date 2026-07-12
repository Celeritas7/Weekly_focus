/* Weekly Focus — service worker (offline app shell for the train).
   Caches the page + assets so it opens with no signal. Supabase API calls are
   never cached; the app's outbox queues edits and syncs them when back online. */
/* BUMP THIS CONSTANT ON EVERY DEPLOY so browsers reinstall the new build and the
   activate handler purges older caches (stops a stale build being served). */
const CACHE = "weekly-focus-v14";
const ASSETS = [
  "./", "./index.html",
  "./config.js",
  "./weekly-focus.css", "./weekly-focus-app.js",
  "./manifest.webmanifest",
  "./icon-180.png", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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

  // Never intercept Supabase / cross-origin API or CDN calls — straight to network.
  if (url.origin !== self.location.origin || url.pathname.includes("/rest/v1/")) return;

  // The page itself: network-first (so new versions land), cache fallback offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", cp)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static same-origin assets (css/js/icons): cache-first, then network (and cache it).
  e.respondWith(
    caches.match(req).then((c) => c || fetch(req).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((cache) => cache.put(req, cp)); return r;
    }).catch(() => c))
  );
});
