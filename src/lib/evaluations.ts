export type EvaluationPublicationStatus = "published" | "draft" | "example";
export type EvaluationStatus = "completed" | "partial" | "failed";
export type EvaluationTargetType = "local_server" | "online_api";
export type EvaluationMetricUnit = "ratio" | "percent" | "score" | "seconds" | "count";
export type EvaluationMetricDirection = "higher_is_better" | "lower_is_better";

export interface EvaluationModel {
  slug: string;
  name: string;
  params_b: number | null;
  source_url: string;
  revision: string;
  quantization: string;
  scheme: string;
}

export interface EvaluationHost {
  slug: string;
  name: string;
  vendor: string;
  chip: string;
  accelerator_count: number;
  vram_gb: number;
}

export interface EvaluationEngine {
  slug: string;
  name: string;
  version: string;
  commit: string;
  backend: string;
}

export interface EvaluationTarget {
  type: EvaluationTargetType;
  provider: string;
  model_id: string;
  endpoint_protocol: string;
  region: string;
  host?: EvaluationHost;
  engine?: EvaluationEngine;
}

export interface EvaluationProducer {
  name: "llm-eval-hub";
  version: string;
  commit: string;
  run_id: string;
  run_fingerprint: string;
}

export interface EvaluationSuite {
  slug: string;
  name: string;
  version: string;
}

export interface EvaluationHarness {
  name: string;
  version: string;
  commit: string;
}

export interface EvaluationAdapter {
  name: string;
  version: string;
  chat_template: string;
  prompt_template_sha256: string;
}

export interface EvaluationGenerationConfig {
  temperature: number | null;
  top_p: number | null;
  seed: number | null;
  max_output_tokens: number | null;
  [key: string]: string | number | boolean | null;
}

export interface EvaluationGrader {
  type: string;
  name: string;
  version: string;
  model_id?: string;
  prompt_sha256?: string;
}

export interface EvaluationConfig {
  spec_id: string;
  suite: EvaluationSuite;
  harness: EvaluationHarness;
  adapter: EvaluationAdapter;
  generation: EvaluationGenerationConfig;
  grader: EvaluationGrader | null;
  command: string;
}

export interface EvaluationMetric {
  name: string;
  label: string;
  value: number;
  unit: EvaluationMetricUnit;
  direction: EvaluationMetricDirection;
  n?: number;
  stderr?: number;
  ci95?: [number, number];
}

export interface EvaluationDataset {
  slug: string;
  name: string;
  version: string;
  split: string;
  subset: string | null;
  category: string;
  source_url: string;
}

export interface EvaluationTaskResult {
  dataset: EvaluationDataset;
  dataset_checksum: string;
  protocol: {
    id: string;
    task_type: string;
    denominator_policy: string;
    on_api_error: string;
    on_parse_error: string;
  };
  status: EvaluationStatus;
  primary_metric: string;
  metrics: EvaluationMetric[];
  counters: {
    total_samples: number;
    scored_samples: number;
    api_errors: number;
    parse_errors: number;
    score_errors: number;
  };
}

export interface EvaluationScoreSummary {
  score: number | null;
  score_label: string;
  normalization: string;
  completed_tasks: number;
  total_tasks: number;
}

export interface EvaluationUsage {
  requests: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  billed_usd: number | null;
}

export interface EvaluationArtifacts {
  source_url: string;
  log_url: string;
  report_url: string;
  samples_url: string;
  samples_sha256: string;
}

export interface EvaluationRun {
  schema_version: 1;
  publication_status: EvaluationPublicationStatus;
  run_date: string;
  started_at: string;
  completed_at: string;
  status: EvaluationStatus;
  model: EvaluationModel;
  target: EvaluationTarget;
  producer: EvaluationProducer;
  evaluation: EvaluationConfig;
  summary: EvaluationScoreSummary;
  tasks: EvaluationTaskResult[];
  usage: EvaluationUsage;
  artifacts: EvaluationArtifacts;
  notes: string;
  raw_output?: unknown;
}

export interface EvaluationRunRecord extends EvaluationRun {
  /** Stable ID derived from the JSON file's path below data/evaluations. */
  id: string;
  /** Repository-relative source path for the GitHub evidence link. */
  source_path: string;
}

export type EvaluationRunSummary = Omit<EvaluationRunRecord, "raw_output">;

export interface EvaluationManifest {
  schema_version: 1;
  generated_at: string;
  runs: EvaluationRunSummary[];
}

export function primaryMetric(task: EvaluationTaskResult): EvaluationMetric | undefined {
  return task.metrics.find((metric) => metric.name === task.primary_metric) ?? task.metrics[0];
}

export function metricPercent(metric: EvaluationMetric): number | null {
  if (metric.unit === "ratio") return metric.value * 100;
  if (metric.unit === "percent") return metric.value;
  return null;
}

export function formatEvaluationMetric(metric: EvaluationMetric, digits = 1): string {
  if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(digits)}%`;
  if (metric.unit === "percent") return `${metric.value.toFixed(digits)}%`;
  if (metric.unit === "seconds") return `${metric.value.toFixed(2)} s`;
  if (metric.unit === "count") return Math.round(metric.value).toLocaleString();
  return metric.value.toFixed(digits);
}

export function evaluationGithubBlobUrl(sourcePath: string): string {
  return `https://github.com/InferStation/InferStation/blob/main/${sourcePath}`;
}
