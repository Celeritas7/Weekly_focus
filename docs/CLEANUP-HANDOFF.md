# Repo cleanup — handoff (paused 2026-08-05)

Cleanup was started and deliberately **paused part-way**. Read the "index is dirty"
section first — it is the only thing that needs immediate attention.

## ⚠️ The index is dirty — fix this first

`git rm -r --cached Attempt_12 Attempt_13 Attempt_14 Attempt_15 Temp` was run before
the session was stopped. That staged **137 deletions** in the index.

- **No file was moved or deleted.** Everything is still on disk; those paths now show
  as both staged `D` and untracked `??`.
- **No deployed-app file is affected** — no staged change to root `index.html`,
  `sw.js`, `weekly-focus-app.js`, `weekly-focus.css`, `home-screens.css`, icons or
  manifest.
- `HEAD` is still `25891f7`. Nothing was committed. Nothing was pushed.

To restore a clean tree and start over:

```
git restore --staged Attempt_12 Attempt_13 Attempt_14 Attempt_15 Temp
```

Or, to continue the cleanup, keep the staged deletions and move the folders out —
the `git rm --cached` half is already done.

## Branch state

- **`main` @ `25891f7`** ("v35 - archive feature") — this is live. Bridge, timeline,
  inbox, archive and subtask `loc` all intact. In sync with `origin/main`.
- **`build-19-stripped` @ `9dcc103`** — the parked regression. **DO NOT DEPLOY.**
  Local only, never pushed. Strips the bridge hook, archive, timeline, inbox, flow
  and links; drops `loc` from `normSubs`; regresses `sw.js` CACHE v35 → v23.
  Full reasoning is in that commit's message.

## Cleanup: NOT done

Remaining work:

- **Archive `Attempt_12`–`Attempt_15` and `Temp/`** to `../Weekly_focus_archive/`
  (the folder was created and is currently empty). These are **TRACKED** — they need
  `git rm -r --cached` *before* the filesystem move. That step is already staged; see
  above.
- **`Attempt_16` / `17` / `18` — decide separately.** Untracked, and recent deliberate
  experiments (16 and 17 dated Aug 4–5, 18 created Aug 5 13:32). `Attempt_18`'s
  `weekly-focus-app.js` hashes to `c637c82`, byte-identical to HEAD's — it is a
  snapshot of the live build, not an old attempt.
- **Delete `preview.html`** — untracked, never committed (`git log --all` returns
  nothing for it), so it is **not** public on Pages. Local file only.
- **Delete `wf-cc-bridge.js`** — the v1 file, and *only* that one. Genuinely dead:
  nothing loads it, and `BRIDGE-PROMPT.md:19` says not to reuse it.
- **Add `.gitignore`** with `Attempt_*/`, `Temp/`, `preview.html`, `*(1)*`, `*.bak`.
- **Move docs**: `BRIDGE-PROMPT.md` and `README-BUILD16.md` (both tracked) into
  `docs/`. `README-BUILD17.md` at root is untracked and is a 5-line superset of the
  existing tracked `docs/README-BUILD17.md` — moving it overwrites that older copy,
  which is intended but is a content change, so confirm before doing it.
- **`run-weekly-focus.bat` — undecided.** Local python http.server launcher, tracked,
  not needed in a served repo. Delete or archive; never chosen. Note: it is *not* the
  auto-sync script.
- **`README.md` top** — still needs the 5-line summary (what the app is, the Pages URL
  `https://celeritas7.github.io/Weekly_focus/`, "current build: 17", pointer to `docs/`).

## ⚠️ TWO CORRECTIONS the investigation forced

The original cleanup plan was wrong on both of these. Do not revert to it.

1. **`wf-cc-bridge-v2.js` STAYS at root.** It is live, not dead. Root `index.html:527`
   loads it with a static `<script>` tag, `sw.js:10` precaches it, and
   `weekly-focus-app.js` hands it the signed-in Supabase session via
   `window.__wfSb`. Shipped in `4dd63f7`, which is 12 commits behind HEAD and still
   in effect. The original target root listing omits it — that listing is incomplete.
   The "not referenced by index.html" reading came from the **working tree**, which
   had the tag stripped by the uncommitted build-19 edits; `HEAD` was never checked.
   Always verify against `HEAD`, not the working tree.
2. **`weekly-focus (1).css` is safe to ARCHIVE, not delete** — and it is not what it
   looks like. Against committed `weekly-focus.css` it is a *strict subset*
   (84 deletions, zero insertions), i.e. a stale mid-build snapshot containing nothing
   unique. It only looked like it held unshipped Timeline/Inbox CSS because it was
   first diffed against the stripped working tree.

## README body

Move the v1 bridge documentation out of `README.md` into **`docs/bridge-sync.md`** —
**do not delete it.** It documents the *live* bridge: the sync direction table,
`PREFIX_TO_CATEGORY` / `ITEM_OVERRIDES`, and the `mind_map_app_chat_memory` mapping
key `cf_wf_sync`. It overlaps with `BRIDGE-PROMPT.md` but is not redundant —
`BRIDGE-PROMPT.md` is the spec for building v2, `README.md` records v1's actual
behaviour. Its install instructions do need correcting: they reference
`wf-cc-bridge.js` (v1, being deleted) rather than `wf-cc-bridge-v2.js`.

## ⚠️ Hazard: `app.ps1`

`D:\Coding\#Python_scripts_database\app.ps1` line 74 does:

```
git add -A
git commit -m "Auto sync: update files"
git push origin main
```

Run from this repo it would sweep **everything** — the untracked `Attempt_*` folders,
`preview.html`, and the staged deletions — into `main` and push in one action.
The untracked strays stay exposed to this until `.gitignore` lands.

It is **manual only**: menu-driven (`Git (current folder)` → `Sync`), no timer, no
file-watch, no autostart. Task Scheduler has only Windows built-ins; all `.git/hooks`
are `.sample`; there is no `.github/`. Weekly_focus has no `1_git_auto_sync.bat` of
its own — those bats `cd /d "%~dp0"` and only act on their own folder.

**On PID 4548:** it was flagged for closing, but it is the terminal hosting the Claude
Code session (child process `claude.exe`), not a stray shell. It runs nothing on its
own. Closing it just ends the session.

## Deploy reminder

`sw.js` CACHE is at **v35** on main. Bump it on every deploy — and note
`build-19-stripped` currently regresses it to v23, which must become v36+ before any
part of that build ships.
