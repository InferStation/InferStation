import type { EvalHubRun } from "./evalHubClient";

export interface EvalHubDatasetProgress {
  id: string;
  datasetVersionId: string;
  displayName: string;
  version: string;
  status: string;
  completedSamples: number;
  totalSamples: number;
  percent: number;
}

export function evalHubProgressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, completed / total * 100));
}

export function formatEvalHubProgressPercent(percent: number): string {
  if (percent > 0 && percent < 10) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(0)}%`;
}

export function getEvalHubDatasetProgress(run: EvalHubRun): EvalHubDatasetProgress[] {
  const snapshots = new Map(
    run.run_spec_json.datasets.map((dataset) => [dataset.dataset_version_id, dataset.manifest] as const),
  );

  return run.datasets.map((dataset) => {
    const manifest = snapshots.get(dataset.dataset_version_id);
    const samplesComplete = dataset.total_samples > 0
      && dataset.completed_samples >= dataset.total_samples;
    const status = samplesComplete && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(dataset.status)
      ? "SAMPLES COMPLETE"
      : dataset.status;

    return {
      id: dataset.id,
      datasetVersionId: dataset.dataset_version_id,
      displayName: manifest?.metadata.display_name ?? dataset.protocol_id,
      version: manifest?.metadata.version ?? "Stored version",
      status,
      completedSamples: dataset.completed_samples,
      totalSamples: dataset.total_samples,
      percent: evalHubProgressPercent(dataset.completed_samples, dataset.total_samples),
    };
  });
}
