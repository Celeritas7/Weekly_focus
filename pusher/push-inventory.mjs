#!/usr/bin/env node
/* =====================================================================
 *  Weekly Focus — hands-off inventory pusher
 *  Reads PROJECT_STATUS.md + the Database folder and pushes them to Supabase.
 *  Run it on a schedule, or chain it onto whatever regenerates PROJECT_STATUS.md.
 *
 *  Requires Node 18+ (uses built-in fetch). No npm install needed.
 *  Config comes from environment variables (see .env.example) OR a sibling .env file.
 * ===================================================================== */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---- tiny .env loader (so you don't need the dotenv package) ---- */
const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, ".env");
if (existsSync(envPath)) {
  for (const line of (await readFile(envPath, "utf8")).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,        // service_role key — keep secret, this machine only
  BOARD_ID = "my-week",
  STATUS_FILE,                 // e.g. D:\Coding\App_generation\PROJECT_STATUS.md
  DB_DIR,                      // e.g. D:\#########Database
  MAX_DEPTH = "4",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. See .env.example.");
  process.exit(1);
}

/* ---------------- helpers (mirror the web app exactly) ---------------- */
const stripHash = (s) => s.replace(/^[#]+\s*/, "");
const skipFolder = (n) => n.startsWith("_") || n.startsWith(".") || n === "_ZZ_Review_junk";
const displayDomain = (n) => stripHash(n).toUpperCase();
const displaySub = (n) => stripHash(n);

function dedupeTree(nodes) {
  const seen = new Set(), out = [];
  for (const n of nodes) { if (!seen.has(n.name)) { seen.add(n.name); dedupeTree(n.children); out.push(n); } }
  nodes.length = 0; out.forEach((n) => nodes.push(n));
}

/* ---- parse PROJECT_STATUS.md ---- */
function statusToGroup(c) {
  if (c.includes("\u{1F7E2}")) return "Active";
  if (c.includes("\u{1F535}")) return "Quiet";
  if (c.includes("\u{1F7E1}")) return "Stale";
  if (c.includes("\u{1F527}")) return "Maintenance";
  if (c.includes("\u23F8")) return "Paused";
  if (c.includes("\u26AA")) return "Stale";
  if (c.includes("\u26AB")) return null;     // abandoned -> skip
  return null;
}
const maturityToPri = (m) => /full[- ]?stack/i.test(m) ? "H" : /build setup/i.test(m) ? "M" : "L";

function parseStatus(text) {
  const lines = text.split(/\r?\n/); let cat = null; const apps = [];
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cat = h[1].trim(); continue; }
    const t = line.trim();
    if (t[0] !== "|") continue;
    if (cat && /^quick/i.test(cat)) continue;
    let parts = t.split("|");
    if (parts[0].trim() === "") parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
    const cells = parts.map((c) => c.trim());
    if (cells.length < 5) continue;
    if (/^project$/i.test(cells[0])) continue;
    if (/^:?-{2,}:?$/.test(cells[0])) continue;
    const group = statusToGroup(cells[4]);
    if (!group) continue;
    apps.push({ name: cells[0], category: cat || "Other", group, maturity: cells[2], priAuto: maturityToPri(cells[2]) });
  }
  return apps;
}

/* ---- walk the Database folder into a tree ---- */
async function readDir(dir, depth) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const children = [];
  for (const e of ents) {
    if (!e.isDirectory() || skipFolder(e.name)) continue;
    const node = { name: depth === 0 ? displayDomain(e.name) : displaySub(e.name), raw: e.name, children: [] };
    if (depth < Number(MAX_DEPTH)) node.children = await readDir(path.join(dir, e.name), depth + 1);
    children.push(node);
  }
  children.sort((a, b) => a.raw.localeCompare(b.raw));
  dedupeTree(children);
  return children;
}

/* ---- push to Supabase ---- */
async function upsert(row) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/inventory?on_conflict=board_id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${await res.text()}`);
}

/* ---------------- run ---------------- */
const row = { board_id: BOARD_ID, updated_at: new Date().toISOString() };
if (STATUS_FILE) row.apps = parseStatus(await readFile(STATUS_FILE, "utf8"));
if (DB_DIR) row.study = await readDir(DB_DIR, 0);

await upsert(row);
console.log(
  `Pushed to board "${BOARD_ID}": ` +
  `${row.apps ? row.apps.length + " apps" : "apps unchanged"}, ` +
  `${row.study ? row.study.length + " study domains" : "study unchanged"}.`
);
