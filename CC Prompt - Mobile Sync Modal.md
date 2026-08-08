# CC Prompt — Fix: email sign-in not visible on mobile

Paste this into Claude Code from the Weekly_focus repo root.

---

Three small edits. The Cloud sync modal's email field is below the scroll fold on phones — move the Account section above Connection, add a mobile bottom-sheet style, bump the SW cache.

**1. `index.html`** — inside `#cloudModal` `.modal-body`, the Account `.dsect` (containing `#authSignedOut`, `#authSignedIn`, `#cloudStatus`) currently comes AFTER the Connection `.dsect`. Swap them so Account is FIRST and Connection second. Move the whole `<div class="dsect">…</div>` blocks; change nothing inside them.

Also shorten the modal-head paragraph to one line. Replace:

```
<p>Your week lives in Supabase &mdash; this device just needs to be signed in. Sign in with a magic link below; your data loads automatically and stays in sync across every device.</p>
```

with:

```
<p>Sign in below &mdash; your week loads automatically and stays in sync on every device.</p>
```

**2. `css/weekly-focus.css`** — after the `.modal-body { overflow-y: auto; padding: 8px; }` rule, add:

```
@media (max-width: 640px) {
  .modal-bg { padding: 0; align-items: flex-end; }
  .modal { max-width: none; max-height: 92dvh; border-radius: 18px 18px 0 0; }
  .modal-body { -webkit-overflow-scrolling: touch; }
}
```

**3. `sw.js`** — bump `const CACHE = "weekly-focus-v39";` to `"weekly-focus-v40"`.

Then commit + push: `Fix: mobile sync modal — account section first, bottom-sheet on phones (v40)`.

---

After deploy, on the phone: close and reopen the PWA twice (first open installs v40, second serves it). Tap the cloud pill — the email field should now be the first thing in the sheet.
