# Mobile startup recovery — v162

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
  downloads. Required local scripts defer execution until parsing finishes. App
  initialization waits for DOMContentLoaded so the Sphere/logo modules are
  available for the first render. Optional cross-app broadcast scripts load
  asynchronously; their late arrival starts the existing broadcaster once.
  A failed overlay cannot stop sign-in initialization.
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
- Changed login assets, task dependencies, app and offline shell use v162, so
  an older worker cannot serve the unversioned v160 login code to the new page.

## v162 follow-up: eliminate external startup waits

The phone received v161 but remained on its startup screen. Two independent
waits remained: deferred cross-app Akatsuki scripts blocked DOMContentLoaded,
and service-worker installation awaited an unbounded CDN request even though
its rejection was labelled best-effort. The offline worker registration also
waited for the window load event. A fresh cloud browser reached sign-in, so the
exact phone-side cause remains unconfirmed.

The auth SDK now ships locally at the same 2.119.0 version served by the @2 CDN
on 2026-11-18. Its license and provenance are in js/vendor. Installation only
requests same-origin assets. Worker registration and the existing Command
Centre bridge use DOMContentLoaded rather than waiting for optional downloads.
The startup screen shows the current phase (app files, Sphere, or sign-in
response), and a specific error is not overwritten by the generic watchdog.
No auth policy, task record, database schema or reminder identity is changed.

## Verification

`node --test tests/startup.cjs tests/task-data.cjs tests/task-engine.cjs`:
startup/auth/cache fault injection plus existing task preservation/rule tests.
`node tests/task-reminders.cjs`: existing reminder regression checks.

`node tests/startup-browser.cjs`: Playwright at mobile widths with the real app
shell, login and rendering code, synthetic sessions/data and intercepted
external requests. Covers stalled session, late recovery, signed-in/out states,
stale response after sign-out, missing engine and stalled external script.
It also exercises the actual shipped auth SDK with 65 cached apps and unsent
notes, offline reopening, worker installation while optional requests stall,
and a stalled token refresh followed by the real Update app files button.
The Startup recovery workflow runs Chromium and retains mobile screenshots.
It requires no account, database access, production data or secrets.

The local executor cannot launch Chromium because of its socket restriction;
browser CI is the repeatable browser verification path. Physical Android
validation remains necessary after merge/deployment: open online, confirm v162,
then reopen, check notes/tasks and confirm offline reopening on the same device.
Do not clear website data as a recovery step.
