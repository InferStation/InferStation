export interface EndpointCapability {
  models_list?: boolean;
  chat_completions?: boolean;
  usage?: boolean;
  stream?: boolean | string;
  seed?: boolean | string;
  logprobs?: boolean | string;
}

export interface Endpoint {
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  status: string;
  owner: string;
  active_revision_id: string;
  api_key_configured: boolean;
  secret_hint: string | null;
  concurrency_limit: number;
  qps_limit: number;
  capability: EndpointCapability | null;
  created_at: string;
  updated_at: string;
}

export interface Model {
  id: string;
  endpoint_id: string;
  model_name: string;
  display_name: string;
  enabled: boolean;
  source: string;
}

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version: string;
  checksum: string;
  row_count: number;
  manifest_json: {
    metadata: { name: string; display_name: string; version: string };
    protocol: { id: string; task_type: string; scorer: { primary_metric: string } };
  };
  created_at: string;
}

export interface Dataset {
  id: string;
  name: string;
  display_name: string;
  owner: string;
  sensitivity: string;
  description: string;
  versions: DatasetVersion[];
  created_at: string;
  updated_at: string;
}

export interface RunDataset {
  id: string;
  dataset_version_id: string;
  protocol_id: string;
  status: string;
  total_samples: number;
  completed_samples: number;
  counters_json: Record<string, number>;
}

export interface Run {
  id: string;
  name: string;
  status: string;
  created_by: string;
  model_id: string;
  endpoint_revision_id: string;
  protocol_fingerprint: string;
  baseline_run_id: string | null;
  cancel_requested: boolean;
  run_spec_json: {
    model_name: string;
    inference: Record<string, unknown>;
    execution: Record<string, number>;
    datasets: Array<{ dataset_version_id: string }>;
  };
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  datasets: RunDataset[];
}

export interface SampleExecution {
  id: string;
  run_dataset_id: string;
  sample_id: string;
  inputs_json: Record<string, unknown>;
  reference_json: unknown;
  metadata_json: Record<string, unknown>;
  rendered_request_json: Record<string, unknown> | null;
  raw_response_json: Record<string, unknown> | null;
  output_text: string | null;
  parsed_value_json: unknown;
  parse_status: string | null;
  status: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error_type: string | null;
  error_message_redacted: string | null;
  primary_score: number | null;
  passed: boolean | null;
  score_reason: string | null;
}

export interface RunMetrics {
  run_id: string;
  datasets: Array<{
    run_dataset_id: string;
    dataset_version_id: string;
    protocol_id: string;
    metrics: Record<string, number | null>;
    denominators: Record<string, number>;
    metadata: Record<string, Record<string, unknown>>;
    groups: Array<{
      group_key: string;
      group_value: string;
      metrics: Record<string, number | null>;
      denominators: Record<string, number>;
    }>;
  }>;
}
