# Deploy v39 — mobile sign-in via 6-digit code

## Why
Magic links break on phones: the link opens in the mail app's browser (or Safari),
which is a different storage context from the installed app — the session never
reaches Weekly Focus. A code you type INSIDE the app works everywhere.

## What changed
1. **Sign-in by code** — the Cloud modal now sends the email, then shows a
   "6-digit code" field + **Verify & sign in**. Type the code from the email and
   you're in — on any device, any browser, installed app included.
   The emailed link still works too (if opened in the same browser).
2. sw.js cache bumped to v39.

## ONE-TIME Supabase setting (required for the code to appear in the email)
Supabase Dashboard → Authentication → Email Templates → **Magic Link**:
add this line to the template body, then Save:

    <p>Your sign-in code: {{ .Token }}</p>

Without it the email only contains the link, no code.

## Copy these over your Weekly_focus root (same layout as before)
    sw.js                     (cache bumped to v39)
    index.html                (code field in the Cloud modal)
    js/weekly-focus-app.js    (verify-code handler)
    everything else unchanged
