/* wf-purchase-adapter.js — WF's Wishlist view of purchase requests (R016).
 *
 * Load after akatsuki-client.js, with WF's existing hub instance:
 *   <script src="js/wf-purchase-adapter.js"></script>
 *   <script>window.wf.purchases = WfPurchases(supabase, window.wf.hub);</script>
 *
 * WF owns exactly ONE thing here: the planned shop (purchase_plan.shop).
 * Item, qty and price belong to the sender. Only Cost closes a request.
 */
(function () {
  const DOC = 'purchase_plan', PATH = 'shop';
  const OPEN = (r) => !r.reply || ['pending', 'approved'].includes(r.reply.status);
  const RECENT_MS = 30 * 864e5;                       // "Show bought · kept 30 days"

  function WfPurchases(supabase, hub) {
    const keyOf = (row) => row.plan_key || (row.from_app + ':' + row.payload.id);

    return {
      /** Every purchase request to Cost, all senders. Open ones + logged in the last 30 days.
       *  Each row: { seq, from_app, payload:{id,items,…}, reply, plan_shop, … }.
       *  Box to show: logged → reply.shop (Cost's real shop), else plan_shop, else Unsorted. */
      async board() {
        const { data, error } = await supabase.from('akatsuki_purchases')
          .select('seq,from_app,src_addr,payload,reply,reply_seq,created_at,plan_key,plan_shop')
          .order('seq', { ascending: false });
        if (error) throw new Error(error.message);
        const now = Date.now();
        return (data || []).filter(r => OPEN(r) ||
          (r.reply && r.reply.status === 'logged' && now - Date.parse(r.reply.at || r.created_at) < RECENT_MS));
      },

      /** Where the item sits in the Wishlist. Display only — never write this back. */
      boxOf(row) {
        if (row.reply && row.reply.status === 'logged' && row.reply.shop) return row.reply.shop;
        return row.plan_shop || null;                  // null → Unsorted
      },

      /** Cost's shop list. Shop boxes pick from this only — no typed names. */
      async shops() {
        const { data, error } = await supabase.from('akatsuki_shops').select('*').order('name');
        if (error) throw new Error(error.message);
        return data || [];
      },

      /** User drops an item on a shop box. Call on that drop only — not on render or load. */
      async planShop(row, shopName) {
        if (!OPEN(row)) return { status: 'closed' };   // Cost already decided
        return hub.put(DOC, PATH, keyOf(row), { shop: shopName, at: new Date().toISOString() });
      },

      /** User drags it back to Unsorted. */
      async clearPlan(row) {
        return hub.remove(DOC, PATH, keyOf(row));
      },

      /** Deleting a Sukkiri (or any non-WF) item in WF hides it on this device only.
       *  It stays open in Cost. */
      hide(row) {
        const k = 'wf_purchase_hidden', s = new Set(JSON.parse(localStorage.getItem(k) || '[]'));
        s.add(keyOf(row)); localStorage.setItem(k, JSON.stringify([...s]));
      },
      hidden() { return new Set(JSON.parse(localStorage.getItem('wf_purchase_hidden') || '[]')); },

      keyOf
    };
  }
  window.WfPurchases = WfPurchases;
})();

/* ── Where to place the calls ─────────────────────────────────────────────────
 *   Wishlist render        → rows = await wf.purchases.board(); skip wf.purchases.hidden()
 *                            WF's own ¥ items are in here too (from_app='wf') — merge by
 *                            payload.id with the local item instead of showing twice.
 *   box for a row          → wf.purchases.boxOf(row)   (null = Unsorted)
 *   non-WF item badge      → sender chip ("Sukkiri") + reply status; item/qty/price read-only
 *   drop on shop box       → await wf.purchases.planShop(row, shop.name)
 *   drop on Unsorted       → await wf.purchases.clearPlan(row)
 *   shop box list / picker → await wf.purchases.shops()   (Cost's list; no free text)
 *   delete non-WF item     → wf.purchases.hide(row)    — never a hub write
 *   refresh                → on load (after WF's state is ready), Refresh, and every 30 s
 *                            while the Wishlist is open
 * ─────────────────────────────────────────────────────────────────────────── */
