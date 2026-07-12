/* Weekly Focus — service worker (offline app shell for the train).
   Caches the page so it opens with no signal. Supabase API calls are never
   cached; the app's own outbox queues edits and syncs them when you're back online. */
/* BUMP THIS CONSTANT ON EVERY DEPLOY. Changing it makes the browser see a new
   service-worker byte-for-byte, which forces reinstall (re-caching the new
   index.html) and the activate handler below to purge every older cache. This is
   what stops a stale build from being served indefinitely. */
const CACHE = "weekly-focus-v3";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

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

  // Never intercept Supabase (or any cross-origin API) calls — straight to network.
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

  // Static assets: cache-first.
  e.respondWith(caches.match(req).then((c) => c || fetch(req)));
});
