## Status update · 2026-11-01 (live build v129)

**Phase 10 (sync safety) — closed.** v104/v105 shipped the outbox, per-key board merge and old-build guard; **v106** added the empty-read guard and closed the phase.

### Phases

| Phase | Status |
|---|---|
| 1 · v88 follow-ups | **Mostly done.** Old deploy folders removed from the repo (Attempt_*, Temp/, old notes). Akatsuki report for v88 sent and confirmed: contract matches, nothing to change. Exercise gets no purchase route until it registers with the hub. **Open:** check the sender tag on the next real request from Sukkiri / Cost (none since 2026-09-30). |
| 3 · Focus groups (v90) | **Live.** Code on main; `weekly_focus_groups` and `weekly_focus_group_apps` exist with own-rows RLS. |
| 4 · Focus view as default (v94) | **Live.** On main since v94. |
| 5 · Vault copy helpers (v95 plan) | **Done in v118.** 日本語 / EN switch per record (`wf_vlang`), 番地 `1-1-22` ⇄ `1丁目1番22号`, postal code halves (`336` / `0025`), phone as `090-…` / `+81 …` / digits only. |
| 10 · Sync safety | **Closed by v106.** |

### Small fixes (not in the plan)
- Footer on phones: the Cloud sync build line stays on one line (v125).
- Sign-in text: "nothing is stored locally" and "magic link" replaced by the real flow, email + 6-digit code (v124).
- **Gift-list card: still open.** Decide: bring it back as a card (4 open items) or delete it (migration `20261014_02` backs it up first).

### Shipped since v106 (not in the plan)
- **v107–v114 · Sphere Draft.** Game-style "Add to sphere": orrery with the Five and an orbit, bubbles grouped by category, details window, drag and keys, compact filters on phones. Akatsuki is the core (red moon, dimmed when clear).
- **v109–v117 · Shared app logos.** Logos come from Akatsuki's store (R038), else the app's live site. **Set logo** (upload or emoji) in the details window.
- **v118 · Vault copy helpers** (Phase 5, above).
- **v119 · Open all quick links**, filtered by kind (Claude design / AI / Code, live app, GitHub, PC folder).
- **v120 · Code folder → .zip.**
- **v121–v123 · Share Code folders by link.** Fixed, live, read-only links on `snippet-room.vercel.app/code#…`; on / off / new link; migration `20261029_01`.
- **v124–v125 · Text and footer fixes** (above).
- **v126–v129 · Import from Tapal into Vault Addresses** via Akatsuki's `akatsuki_addresses` (R057): review before saving, India / Japan shapes, Japanese lines split into 都道府県 / 市区町村 / 番地 / 建物名, and a **Split building & room out** button in the Edit form.

### Infrastructure
- Second deploy on **Vercel** next to GitHub Pages (same repo, no build step).
- **Security fix:** `wf_subtasks_flat` was readable without sign-in; closed by migration `20261024_01`.
- Old app copies removed from the repo; `.gitignore` keeps them out.

### Still open (outside the phases)
- Four other apps' views readable without sign-in (Dhara, Calendar, Chatak, Sift); fixes need the owner's OK.
- Ideas, not started: outer orbit in the sphere, core bar always shown (dimmed), logos offline, PNG icons for 12 apps.
