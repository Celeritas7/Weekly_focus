# Deploy v40.1 (cache v41) — task tags, Claude Chats tab, paragraph editing

## What changed
1. **Per-task tags** — every checklist point gets a small chip: tap it to cycle
   Claude AI → Claude Design → Cowork → none. The tag sits on the point, not the block.
   (Hover a row to see the faint "+ tag" chip; on phones it's always faintly visible.)
2. **Claude Chats tab** — new "Chats" tab in the bottom bar. Save a topic + the
   claude.ai chat link; "Open chat ↗" jumps straight back into the conversation.
   Click a topic to rename. Synced across devices with the board.
3. **Paragraph editing** — editing a point now opens a multi-line box that grows
   with the text (no more single-line squeeze). Enter saves, Shift+Enter adds a
   line, Escape cancels. Line breaks are kept when displayed.
4. Note: the 24h backlog hold for flagged/starred blocks already shipped —
   backlogging such a block parks it and auto-returns it to This Week after 24h.
5. sw.js cache bumped to v40.

## Copy these over your Weekly_focus root
    sw.js
    index.html
    js/weekly-focus-app.js
    css/weekly-focus.css
    css/home-screens.css

## v40.1 follow-up
- Routines & Places merged into ONE tab (Places section now lives inside Routines) — 6 tabs, one row.
- Chats rows simplified: just the title + "Open chat ↗" (+ delete). Click title to rename.
