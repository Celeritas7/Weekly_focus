# Mobile startup recovery — v161

## Confirmed failure and limits

The v160 login boot adds `wf-locked`, making the application invisible, while
leaving the login screen empty and `aria-hidden=true`. Once the client exists,
its polling timer is cleared. A `getSession()` request that never settles and
emits no auth event leaves both screens hidden indefinitely. A resolved non-null
session was also ignored when the initial auth event was absent. A synthetic
reproduction against v160 confirmed the empty, locked state.

The public deployed app reached sign-in in a fresh cloud browser. The user's
actual Android session/network was not inspected, so the exact phone trigger
is unconfirmed. This fix addresses reproducible matching failure paths without
requiring a sign-out, reinstall or data reset.

## Changes

- The HTML contains its own startup screen and watchdog before dependency
  downloads. External scripts defer execution until parsing finishes. App
  initialization waits for DOMContentLoaded so the Sphere/logo modules are
  available for the first render.
- After 12 seconds, a stalled startup gives visible retry guidance. Critical
  script failures produce an actionable message. Both app initialization and
  a rendered auth outcome are required before the startup screen disappears.
- `getSession()` handles a valid returned session. Newer auth events take
  precedence over an older asynchronous response. Network errors keep recovery
  visible; the existing offline stored-session policy is unchanged.
- Try again reloads. Update app files updates only the app's service-worker
  scope, waits for activation when installing, and reloads; it times out after
  15 seconds with retryable feedback. Neither operation clears storage or logs
  the user out. Existing queued edits, notes and saved sign-in remain untouched.
- Navigation has a five-second fallback to the saved page. Failed/non-HTML
  navigation responses and unsuccessful static downloads cannot replace good
  cached files. Cache activation deletes only old `weekly-focus-vN` caches,
  preserving logos and sibling applications on the same origin.
- Changed login assets, task dependencies, app and offline shell use v161, so
  an older worker cannot serve the unversioned v160 login code to the new page.

## Verification

`node --test tests/startup.cjs tests/task-data.cjs tests/task-engine.cjs`:
startup/auth/cache fault injection plus existing task preservation/rule tests.
`node tests/task-reminders.cjs`: existing reminder regression checks.

`node tests/startup-browser.cjs`: Playwright at mobile widths with the real app
shell, login and rendering code, synthetic sessions/data and intercepted
external requests. Covers stalled session, late recovery, signed-in/out states,
stale response after sign-out, missing engine and stalled external script.
The Startup recovery workflow runs Chromium and retains two mobile screenshots.
It requires no account, database access, production data or secrets.

The local executor cannot launch Chromium because of its socket restriction;
browser CI is the repeatable browser verification path. Physical Android
validation remains necessary after merge/deployment: open online, confirm v161,
then reopen, check notes/tasks and confirm offline reopening on the same device.
Do not clear website data as a recovery step.
