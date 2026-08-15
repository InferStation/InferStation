import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EvalHubClient,
  isEvalHubRunTerminal,
  normalizeEvalHubApiBase,
  type EvalHubRun,
  type EvalHubRunCreate,
} from "./evalHubClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeEvalHubApiBase", () => {
  it("adds the upstream API prefix to a bare web origin", () => {
    expect(normalizeEvalHubApiBase(" http://eval.internal:18080/ ")).toBe(
      "http://eval.internal:18080/api/v1",
    );
    expect(normalizeEvalHubApiBase("https://eval.internal/api")).toBe(
      "https://eval.internal/api/v1",
    );
  });

  it("preserves an explicit API version and rejects secrets in URLs", () => {
    expect(normalizeEvalHubApiBase("https://eval.internal/api/v1/")).toBe(
      "https://eval.internal/api/v1",
    );
    expect(() => normalizeEvalHubApiBase("https://admin:secret@eval.internal")).toThrow(
      /cannot contain credentials/i,
    );
    expect(() => normalizeEvalHubApiBase("https://eval.internal?key=secret")).toThrow(
      /cannot contain credentials/i,
    );
  });
});

describe("EvalHubClient", () => {
  it("sends the admin key in a header when listing datasets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new EvalHubClient("http://eval.internal:18080", "admin-runtime-only").listDatasets();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://eval.internal:18080/api/v1/datasets");
    expect(new Headers(init.headers).get("X-API-Key")).toBe("admin-runtime-only");
    expect(url).not.toContain("admin-runtime-only");
  });

  it("keeps the create-run idempotency key and payload in headers/body", async () => {
    const run = { id: "run-1", status: "QUEUED" } as EvalHubRun;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(run), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      name: "smoke",
      endpoint_id: "endpoint-1",
      model_id: "model-1",
      datasets: [{ dataset_version_id: "dataset-1", protocol_id: "native-chat-v1" }],
      inference: { temperature: 0, top_p: 1, max_tokens: 32, seed: 42, stop: [] },
      execution: { concurrency: 2, qps: 2, timeout_seconds: 60, max_retries: 2, shard_size: 50 },
    } satisfies EvalHubRunCreate;

    await new EvalHubClient("http://eval.internal/api/v1", "admin").createRun(
      payload,
      "idempotency-1",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("http://eval.internal/api/v1/runs");
    expect(headers.get("Idempotency-Key")).toBe("idempotency-1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it("updates an existing endpoint without putting its credential in the URL", async () => {
    const endpoint = { id: "endpoint-1", name: "provider" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(endpoint), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new EvalHubClient("http://eval.internal", "").updateEndpoint("endpoint-1", {
      name: "provider",
      base_url: "https://provider.example/v1",
      auth_type: "bearer",
      api_key: "target-runtime-only",
      extra_headers: {},
      concurrency_limit: 2,
      qps_limit: 1,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://eval.internal/api/v1/endpoints/endpoint-1");
    expect(url).not.toContain("target-runtime-only");
    expect(JSON.parse(String(init.body)).api_key).toBe("target-runtime-only");
  });

  it("passes a bounded model timeout to the endpoint probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "healthy", models: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new EvalHubClient("http://eval.internal", "").probeEndpoint(
      "endpoint-1",
      "slow-model",
      180,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      model_id: "slow-model",
      timeout_seconds: 180,
    });
  });

  it("turns upstream JSON failures into typed errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: { message: "endpoint rejected" } }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      new EvalHubClient("http://eval.internal", "admin").listDatasets(),
    ).rejects.toMatchObject({
      name: "EvalHubApiError",
      message: "endpoint rejected",
      status: 422,
    });
  });
});

describe("isEvalHubRunTerminal", () => {
  it.each(["SUCCEEDED", "FAILED", "CANCELLED"])("accepts %s as terminal", (status) => {
    expect(isEvalHubRunTerminal(status)).toBe(true);
  });

  it.each(["QUEUED", "RUNNING", "CANCELLING"])("keeps %s active", (status) => {
    expect(isEvalHubRunTerminal(status)).toBe(false);
  });
});
