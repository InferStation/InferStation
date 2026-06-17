import fs from "node:fs";
import path from "node:path";

export type UsabilityTag = "ok" | "slow" | "fragile" | "broken";

export interface RunRecord {
  schema_version: number;
  run_date: string;
  host: {
    slug: string;
    name: string;
    vendor: string;
    chip: string;
    vram_gb: number;
    deployment_form: string;
  };
  model: {
    slug: string;
    name: string;
    params_b: number;
    quantization: string;
    source_url: string;
  };
  engine: {
    slug: string;
    name: string;
    version: string;
    commit: string;
    backend: string;
    build_flags: string;
  };
  command: string;
  pp_test: string | null;
  pp_toks_per_s: number | null;
  tg_test: string | null;
  tg_toks_per_s: number | null;
  combined_toks_per_s?: number | null;
  ttft_ms: number | null;
  tpot_ms?: number | null;
  prefill_toks_per_s?: number | null;
  decode_toks_per_s?: number | null;
  total_toks_per_s?: number | null;
  ctx: number | null;
  batch: number | null;
  concurrency: number | null;
  n_gpu_layers: number | null;
  vram_used_gb: number | null;
  scenario: string;
  image?: string;
  image_tag?: string;
  usability_tag: UsabilityTag;
  log_url: string;
  source_url: string;
  notes: string;
  raw_llamabench?: unknown;
}

export interface RunSummary extends RunRecord {
  /** Stable id we derive from the JSON file's relative path. */
  id: string;
  /** Repo path relative to the repo root, useful for a GitHub blob link. */
  source_path: string;
}

const RUNS_DIR = path.join(process.cwd(), "data", "runs");

function* walkJson(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJson(full);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      yield full;
    }
  }
}

let cache: RunSummary[] | null = null;

export function getAllRuns(): RunSummary[] {
  if (cache) return cache;
  const out: RunSummary[] = [];
  for (const abs of walkJson(RUNS_DIR)) {
    const raw = fs.readFileSync(abs, "utf8");
    let parsed: RunRecord;
    try {
      parsed = JSON.parse(raw) as RunRecord;
    } catch {
      continue;
    }
    const rel = path.relative(process.cwd(), abs).split(path.sep).join("/");
    const id = rel
      .replace(/^data\/runs\//, "")
      .replace(/\.json$/, "")
      .replace(/\//g, "__");
    // Drop the raw llama-bench payload from the per-run summary list to keep
    // the rendered HTML small; full record stays on the detail page.
    const summary: RunSummary = {
      ...parsed,
      id,
      source_path: rel,
    };
    delete (summary as Partial<RunSummary>).raw_llamabench;
    out.push(summary);
  }
  // Newest first by date, then by host+model for stable ordering.
  out.sort((a, b) => {
    if (a.run_date !== b.run_date) return a.run_date < b.run_date ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  cache = out;
  return out;
}

export function getRunById(id: string): RunSummary | undefined {
  return getAllRuns().find((r) => r.id === id);
}

export function getRunRecord(id: string): RunRecord | undefined {
  const summary = getRunById(id);
  if (!summary) return undefined;
  const abs = path.join(process.cwd(), summary.source_path);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw) as RunRecord;
}

export function getGithubBlobUrl(relPath: string): string {
  return `https://github.com/JoursBleu/InferStation/blob/main/${relPath}`;
}
