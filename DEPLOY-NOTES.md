# v98.4 — v98.3 + blank subtasks deleted automatically

Copy over `Weekly_focus/`, then reload twice:
- `js/weekly-focus-app.js`
- `sw.js` (cache → `weekly-focus-v98-4`)

## What's new over v98.3
- On every sync tick, any subtask with nothing in it (no text, date, place, tag, context or source) is deleted in WF. Console: `[wf] removed blank subtask(s) in app:…`.
- That covers the two from seq 320 / 404. You don't need to click anything.

Everything else is the same as v98.3: `title` only, a blank title is never sent, and clearing a subtask's text deletes it.

## Check (after ~30 s)
```js
JSON.stringify([__wfSub("app:mrr416csprkfh","mrsknx2t6g089").sub.del, __wfSub("app:mrr8bzglj1kr2","mrr8calv408a2").sub.del])
```
→ `"[true,true]"`
