/* ============================================================
   Weekly Focus — connection config (baked into the build)
   ------------------------------------------------------------
   Supabase is the SOURCE OF TRUTH. This file is what makes the
   cloud connection permanent: it lives in the code, not in the
   browser's evictable localStorage, so it can never "break" the
   way the old stored connection did.

   The publishable / anon key below is safe to ship publicly — its
   security comes entirely from Row Level Security, which scopes
   every row to your signed-in account (see supabase-setup.sql).
   NEVER put a secret / service_role key here.
   ============================================================ */
window.WF_CONFIG = {
  url:   "https://wylxvmkcrexwfpjpbhyy.supabase.co",
  key:   "sb_publishable_e3pDOuxIdstaC7s0a680kQ_R10TrAyv",
  board: "my_week",
  roadmapUrl: "https://celeritas7.github.io/Roadmap_advanced/",  // banner's "Open Roadmap" link (R022)
  /* v122: where Code share links point. Empty = the address you're on (…/Weekly_focus/share.html#…).
     Set it to a neutral Vercel address added under Vercel → Project → Settings → Domains, e.g.
     "https://my-code.vercel.app/code" → links look like https://my-code.vercel.app/code#<token>. */
  shareBase: "https://snippet-room.vercel.app/code"
};
