# Clear a stale service worker (phone + desktop)

Open the Weekly Focus tab, open DevTools > **Console**, paste this, run it. It
unregisters every service worker, deletes every cache, clears only the sync
**outbox** (your saved connection and sign-in stay), then hard-reloads from network.

```js
(async () => {
  if ('serviceWorker' in navigator) {
    for (const r of await navigator.serviceWorker.getRegistrations()) {
      await r.unregister(); console.log('SW unregistered:', r.scope);
    }
  }
  if (window.caches) {
    for (const k of await caches.keys()) {
      await caches.delete(k); console.log('cache deleted:', k);
    }
  }
  localStorage.removeItem('wfp_outbox');
  console.log('wfp_outbox cleared - reloading from network');
  location.reload(true);
})();
```

After reload, the page registers the new `weekly-focus-v3` worker. Confirm in
DevTools > Application > Service Workers that the active worker is **v3** and that
Cache Storage lists only `weekly-focus-v3`.

Phone (iOS Safari): Settings > Safari > Advanced > Web Inspector, then connect the
phone to a Mac and run the snippet from desktop Safari's console targeting the tab.
Phone (Android Chrome): chrome://inspect from desktop Chrome, inspect the tab,
paste into that console.

## Optional full reset (forces a clean pull from Supabase)
Keeps your connection (`wfp_cloud`) and sign-in (`wfp_sb_auth`); drops the local
board copy and outbox so the next load rebuilds entirely from the server:

```js
['wfp_outbox','wfp_entries_v3','wfp_studyexp_v2'].forEach(k => localStorage.removeItem(k));
location.reload(true);
```
