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
  key:   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5bHh2bWtjcmV4d2ZwanBiaHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzkxMDYsImV4cCI6MjA4NDIxNTEwNn0.6Bxo42hx4jwlJGWnfjiTpiDUsYfc1QLTN3YtrU1efak",
  board: "my_week"
};
