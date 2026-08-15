import type { EvaluationManifest, EvaluationRunRecord, EvaluationRunSummary } from "./evaluations";

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

let manifestMemo: Promise<EvaluationManifest> | null = null;

export function fetchEvaluationManifest(): Promise<EvaluationManifest> {
  if (manifestMemo) return manifestMemo;
  manifestMemo = fetch(`${BASE}/data/evaluations/index.json`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`evaluation manifest fetch failed: ${response.status}`);
      return response.json() as Promise<EvaluationManifest>;
    })
    .catch((error) => {
      manifestMemo = null;
      throw error;
    });
  return manifestMemo;
}

export async function fetchEvaluationRuns(): Promise<EvaluationRunSummary[]> {
  return (await fetchEvaluationManifest()).runs;
}

export async function fetchEvaluationRun(id: string): Promise<EvaluationRunRecord | undefined> {
  const response = await fetch(
    `${BASE}/data/evaluations/raw/${encodeURIComponent(id)}.json`,
    { cache: "no-store" },
  );
  if (!response.ok) return undefined;
  return (await response.json()) as EvaluationRunRecord;
}
