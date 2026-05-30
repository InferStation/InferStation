// Runtime / client-side data loader. Reads the manifest written by
// scripts/build-manifest.mjs and served as a static asset by Next.
//
// This deliberately does NOT touch node:fs — the whole point is that the
// site can be refreshed by replacing public/data/* on disk, no rebuild.

import type { RunRecord, RunSummary } from "./runs";

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

interface Manifest {
  generated_at: string;
  runs: RunSummary[];
}

let memo: Promise<Manifest> | null = null;

export function fetchManifest(): Promise<Manifest> {
  if (memo) return memo;
  memo = fetch(`${BASE}/data/runs.json`, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
      return r.json() as Promise<Manifest>;
    })
    .catch((e) => {
      // Surface and forget so a retry has a fresh chance.
      memo = null;
      throw e;
    });
  return memo;
}

export async function fetchAllRuns(): Promise<RunSummary[]> {
  return (await fetchManifest()).runs;
}

export async function fetchRunRecord(id: string): Promise<RunRecord | undefined> {
  const r = await fetch(`${BASE}/data/raw/${encodeURIComponent(id)}.json`, {
    cache: "no-store",
  });
  if (!r.ok) return undefined;
  return (await r.json()) as RunRecord;
}

export function githubBlobUrl(relPath: string): string {
  return `https://github.com/JoursBleu/InferStation/blob/main/${relPath}`;
}
