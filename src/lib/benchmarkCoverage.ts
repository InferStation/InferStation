import type { EvaluationRunSummary } from "./evaluations";
import type { RunSummary } from "./runs";

export interface BenchmarkCoverageConfig {
  key: string;
  model: RunSummary["model"];
  host: RunSummary["host"];
  engine: RunSummary["engine"];
  latestPerformanceDate: string;
}

export interface BenchmarkCoverageRow extends BenchmarkCoverageConfig {
  evaluation?: EvaluationRunSummary;
  state: "published" | "partial" | "missing";
}

function token(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function coverageKey(parts: {
  modelSlug: string;
  quantization: string;
  hostSlug: string;
  engineSlug: string;
  backend: string;
}): string {
  return [
    parts.modelSlug,
    parts.quantization,
    parts.hostSlug,
    parts.engineSlug,
    parts.backend,
  ]
    .map(token)
    .join("::");
}

export function performanceCoverageKey(run: RunSummary): string {
  return coverageKey({
    modelSlug: run.model.slug,
    quantization: run.model.quantization,
    hostSlug: run.host.slug,
    engineSlug: run.engine.slug,
    backend: run.engine.backend,
  });
}

export function evaluationCoverageKey(run: EvaluationRunSummary): string | null {
  if (run.target.type !== "local_server" || !run.target.host || !run.target.engine) return null;
  return coverageKey({
    modelSlug: run.model.slug,
    quantization: run.model.quantization,
    hostSlug: run.target.host.slug,
    engineSlug: run.target.engine.slug,
    backend: run.target.engine.backend,
  });
}

export function buildBenchmarkCoverage(
  performanceRuns: RunSummary[],
  evaluations: EvaluationRunSummary[],
): BenchmarkCoverageRow[] {
  const configurations = new Map<string, BenchmarkCoverageConfig>();
  for (const run of performanceRuns) {
    if (run.usability_tag === "broken") continue;
    const key = performanceCoverageKey(run);
    const current = configurations.get(key);
    if (current && current.latestPerformanceDate >= run.run_date) continue;
    configurations.set(key, {
      key,
      model: run.model,
      host: run.host,
      engine: run.engine,
      latestPerformanceDate: run.run_date,
    });
  }

  const accepted = new Map<string, EvaluationRunSummary>();
  for (const evaluation of evaluations) {
    const key = evaluationCoverageKey(evaluation);
    if (!key) continue;
    const current = accepted.get(key);
    if (!current || current.completed_at < evaluation.completed_at) accepted.set(key, evaluation);
  }

  return [...configurations.values()]
    .map((configuration) => {
      const evaluation = accepted.get(configuration.key);
      return {
        ...configuration,
        evaluation,
        state: evaluation
          ? evaluation.status === "completed"
            ? "published"
            : "partial"
          : "missing",
      } satisfies BenchmarkCoverageRow;
    })
    .sort((a, b) => {
      const stateRank = { published: 0, partial: 1, missing: 2 } as const;
      return (
        stateRank[a.state] - stateRank[b.state] ||
        a.model.name.localeCompare(b.model.name) ||
        a.host.name.localeCompare(b.host.name) ||
        a.model.quantization.localeCompare(b.model.quantization) ||
        a.engine.name.localeCompare(b.engine.name)
      );
    });
}
