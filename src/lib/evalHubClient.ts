export type EvalHubAuthType = "bearer" | "api-key-header" | "none";

export interface EvalHubEndpoint {
  id: string;
  name: string;
  base_url: string;
  auth_type: EvalHubAuthType;
  status: string;
  active_revision_id: string | null;
  api_key_configured: boolean;
  secret_hint: string | null;
  concurrency_limit: number;
  qps_limit: number;
}

export interface EvalHubEndpointConfig {
  name: string;
  base_url: string;
  auth_type: EvalHubAuthType;
  api_key?: string;
  extra_headers: Record<string, string>;
  concurrency_limit: number;
  qps_limit: number;
}

export interface EvalHubModel {
  id: string;
  endpoint_id: string;
  model_name: string;
  display_name: string;
  enabled: boolean;
  source: string;
}

export interface EvalHubProtocol {
  id: string;
  task_type: string;
  subset_of?: string;
  parser?: {
    type: string;
    version?: string;
    allowed?: string[];
    labels?: Array<string | number>;
    [key: string]: unknown;
  };
  scorer: {
    type?: string;
    version?: string;
    primary_metric: string;
    absolute_tolerance?: number;
    relative_tolerance?: number;
    [key: string]: unknown;
  };
  denominator_policy?: string;
  on_api_error?: string;
  on_parse_error?: string;
}

export interface EvalHubProbe {
  status: string;
  models: string[];
  capabilities: Record<string, unknown>;
  latency_ms: number | null;
  error_type: string | null;
  error_message: string | null;
}

export interface EvalHubDatasetVersion {
  id: string;
  dataset_id: string;
  version: string;
  checksum: string;
  row_count: number;
  manifest_json: {
    metadata: { name: string; display_name: string; version: string };
    protocol: EvalHubProtocol;
  };
}

export interface EvalHubDataset {
  id: string;
  name: string;
  display_name: string;
  description: string;
  versions: EvalHubDatasetVersion[];
}

export interface EvalHubRunDataset {
  id: string;
  dataset_version_id: string;
  protocol_id: string;
  status: string;
  total_samples: number;
  completed_samples: number;
  counters_json: Record<string, number>;
}

export interface EvalHubRun {
  id: string;
  name: string;
  status: string;
  model_id: string;
  endpoint_revision_id: string;
  protocol_fingerprint: string;
  run_spec_json: {
    model_name: string;
    datasets: Array<{
      dataset_version_id: string;
      dataset_checksum: string;
      manifest: EvalHubDatasetVersion["manifest_json"];
    }>;
    inference: Record<string, unknown>;
    execution: Record<string, number>;
  };
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error_message: string | null;
  datasets: EvalHubRunDataset[];
}

export interface EvalHubRunMetrics {
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

export interface EvalHubRunCreate {
  name: string;
  endpoint_id: string;
  model_id: string;
  datasets: Array<{ dataset_version_id: string; protocol_id?: string }>;
  inference: {
    temperature: number;
    top_p: number;
    max_tokens: number;
    seed: number | null;
    stop: string[];
  };
  execution: {
    concurrency: number;
    qps: number;
    timeout_seconds: number;
    max_retries: number;
    shard_size: number;
  };
}

export interface EvalHubValidation {
  valid: boolean;
  sample_count: number;
  effective_concurrency: number;
  warnings: string[];
  dataset_protocols: Array<Record<string, unknown>>;
}

export class EvalHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(message);
    this.name = "EvalHubApiError";
  }
}

export function normalizeEvalHubApiBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Eval Hub URL is required");
  const url = new URL(trimmed);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Eval Hub URL must use HTTP or HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Eval Hub URL cannot contain credentials, query parameters, or fragments");
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) path = "/api/v1";
  else if (path === "/api") path = "/api/v1";
  url.pathname = path;
  return url.toString().replace(/\/$/, "");
}

function errorMessage(status: number, detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const top = detail as Record<string, unknown>;
    const payload = top.detail ?? top.error ?? top;
    if (typeof payload === "string") return payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const item = payload as Record<string, unknown>;
      if (typeof item.message === "string") return item.message;
      if (typeof item.code === "string") return item.code;
    }
  }
  return `Eval Hub request failed (${status})`;
}

export function isEvalHubRunTerminal(status: string): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

export function createEvalHubIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `eval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class EvalHubClient {
  readonly apiBase: string;

  constructor(apiBase: string, private readonly adminKey: string) {
    this.apiBase = normalizeEvalHubApiBase(apiBase);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.adminKey) headers.set("X-API-Key", this.adminKey);
    if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, { ...init, headers });
    } catch (error) {
      throw new Error(
        `Unable to reach Eval Hub at ${this.apiBase}. Check the service URL, network, and CORS configuration. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const detail = contentType.includes("json") ? await response.json() : await response.text();
      throw new EvalHubApiError(errorMessage(response.status, detail), response.status, detail);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  listDatasets(): Promise<EvalHubDataset[]> {
    return this.request("/datasets");
  }

  listEndpoints(): Promise<EvalHubEndpoint[]> {
    return this.request("/endpoints");
  }

  createEndpoint(payload: EvalHubEndpointConfig & {
    model_name: string;
  }): Promise<EvalHubEndpoint> {
    return this.request("/endpoints", { method: "POST", body: JSON.stringify(payload) });
  }

  updateEndpoint(endpointId: string, payload: EvalHubEndpointConfig): Promise<EvalHubEndpoint> {
    return this.request(`/endpoints/${encodeURIComponent(endpointId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  probeEndpoint(endpointId: string, modelName: string, timeoutSeconds = 60): Promise<EvalHubProbe> {
    return this.request(`/endpoints/${encodeURIComponent(endpointId)}/probe`, {
      method: "POST",
      body: JSON.stringify({ model_name: modelName, timeout_seconds: timeoutSeconds }),
    });
  }

  listModels(endpointId: string): Promise<EvalHubModel[]> {
    return this.request(`/endpoints/${encodeURIComponent(endpointId)}/models`);
  }

  addModel(endpointId: string, modelName: string): Promise<EvalHubModel> {
    return this.request(`/endpoints/${encodeURIComponent(endpointId)}/models`, {
      method: "POST",
      body: JSON.stringify({ model_name: modelName, display_name: modelName }),
    });
  }

  validateRun(payload: EvalHubRunCreate): Promise<EvalHubValidation> {
    return this.request("/runs/validate", { method: "POST", body: JSON.stringify(payload) });
  }

  createRun(payload: EvalHubRunCreate, idempotencyKey: string): Promise<EvalHubRun> {
    return this.request("/runs", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Idempotency-Key": idempotencyKey,
        "X-EvalHub-Run-Origin": "inferstation-live-run",
      },
    });
  }

  listRuns({ activeOnly = false, liveOnly = false, limit = 50 }: {
    activeOnly?: boolean;
    liveOnly?: boolean;
    limit?: number;
  } = {}): Promise<EvalHubRun[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (activeOnly) query.set("active", "true");
    if (liveOnly) query.set("live", "true");
    return this.request(`/runs?${query.toString()}`);
  }

  getRun(runId: string): Promise<EvalHubRun> {
    return this.request(`/runs/${encodeURIComponent(runId)}`);
  }

  getRunMetrics(runId: string): Promise<EvalHubRunMetrics> {
    return this.request(`/runs/${encodeURIComponent(runId)}/metrics`);
  }

  cancelRun(runId: string): Promise<EvalHubRun> {
    return this.request(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }
}
