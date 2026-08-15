import { readResponseBody } from "./response";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";
const KEY_STORAGE = "evalhub.apiKey";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(apiErrorMessage(status, detail));
    this.status = status;
    this.detail = detail;
  }
}

function apiErrorMessage(status: number, detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (!detail || typeof detail !== "object") return `API request failed (${status})`;

  const response = detail as Record<string, unknown>;
  const payload = response.detail ?? response.error ?? response;
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const structured = payload as Record<string, unknown>;
    if (typeof structured.message === "string") return structured.message;
    if (typeof structured.code === "string") return structured.code;
  }
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0];
    if (first && typeof first === "object" && typeof (first as Record<string, unknown>).msg === "string") {
      return (first as Record<string, string>).msg;
    }
  }
  return `API request failed (${status})`;
}

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) || "inferstation-local-dev-key";
}

export function setApiKey(value: string): void {
  localStorage.setItem(KEY_STORAGE, value);
}

export function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", getApiKey());
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = await readResponseBody(response);
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function downloadExport(runId: string, format: "jsonl" | "csv"): Promise<void> {
  const response = await fetch(`${API_BASE}/runs/${runId}/export?format=${format}`, {
    headers: { "X-API-Key": getApiKey() },
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `run-${runId}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function streamRunEvents(
  runId: string,
  onEvent: () => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/runs/${runId}/events`, {
    headers: { "X-API-Key": getApiKey() },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      if (event.includes("data:")) onEvent();
    }
  }
}
