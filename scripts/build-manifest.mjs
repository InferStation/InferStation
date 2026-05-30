#!/usr/bin/env node
// Build a runtime-loadable manifest of all bench runs.
//
// Output (relative to repo root, served as static assets by Next):
//   public/data/runs.json       — RunSummary[] (no raw_llamabench), newest first
//   public/data/raw/<id>.json   — full RunRecord per run
//
// This script is the single source of truth for the data the site loads at
// runtime. After it writes these files, the static site can be served as-is
// with no Next.js build needed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const RUNS_DIR = path.join(repoRoot, "data", "runs");
const OUT_DIR = path.join(repoRoot, "public", "data");
const OUT_RAW = path.join(OUT_DIR, "raw");

function* walkJson(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJson(full);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield full;
  }
}

fs.mkdirSync(OUT_RAW, { recursive: true });
// Wipe stale raw files so deleted runs disappear.
for (const f of fs.readdirSync(OUT_RAW)) {
  if (f.endsWith(".json")) fs.unlinkSync(path.join(OUT_RAW, f));
}

const summaries = [];
for (const abs of walkJson(RUNS_DIR)) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    console.warn(`[manifest] skip ${abs}: ${e.message}`);
    continue;
  }
  const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
  const id = rel
    .replace(/^data\/runs\//, "")
    .replace(/\.json$/, "")
    .replace(/\//g, "__");

  // Persist the full record as a per-id asset.
  fs.writeFileSync(path.join(OUT_RAW, `${id}.json`), JSON.stringify({ ...parsed, id, source_path: rel }));

  // Strip the heavy raw_llamabench blob from the summary list.
  const summary = { ...parsed, id, source_path: rel };
  delete summary.raw_llamabench;
  summaries.push(summary);
}

summaries.sort((a, b) => {
  if (a.run_date !== b.run_date) return a.run_date < b.run_date ? 1 : -1;
  return a.id.localeCompare(b.id);
});

fs.writeFileSync(
  path.join(OUT_DIR, "runs.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), runs: summaries }),
);

console.log(`[manifest] wrote ${summaries.length} runs to public/data/runs.json`);
