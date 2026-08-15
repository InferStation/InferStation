import { describe, expect, it } from "vitest";
import example from "../../data/evaluations/examples/local-server.example.json";
import type { EvaluationRunSummary } from "./evaluations";
import type { RunSummary } from "./runs";
import {
  buildBenchmarkCoverage,
  coverageKey,
  evaluationCoverageKey,
  performanceCoverageKey,
} from "./benchmarkCoverage";

function performance(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    schema_version: 1,
    id: "run-1",
    source_path: "data/runs/2026-08-14/run-1.json",
    run_date: "2026-08-14",
    host: {
      slug: "rtx-4090-sh",
      name: "RTX 4090",
      vendor: "NVIDIA",
      chip: "AD102 (sm_89) x2",
      vram_gb: 96,
      deployment_form: "workstation",
    },
    model: {
      slug: "qwen3.6-35b-a3b",
      name: "Qwen3.6-35B-A3B",
      params_b: 35,
      quantization: "BF16",
      scheme: "W16A16",
      source_url: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B",
    },
    engine: {
      slug: "vllm",
      name: "vLLM",
      version: "g2dfaae752",
      commit: "2dfaae752",
      backend: "CUDA",
      build_flags: "",
    },
    command: "benchmark",
    pp_test: null,
    pp_toks_per_s: null,
    tg_test: null,
    tg_toks_per_s: null,
    ttft_ms: 10,
    ctx: 4096,
    batch: 1,
    concurrency: 1,
    n_gpu_layers: null,
    vram_used_gb: 80,
    scenario: "server",
    usability_tag: "ok",
    log_url: "",
    source_url: "",
    notes: "",
    ...overrides,
  };
}

function evaluation(overrides: Partial<EvaluationRunSummary> = {}): EvaluationRunSummary {
  return {
    ...(example as unknown as EvaluationRunSummary),
    id: "evaluation-1",
    source_path: "data/evaluations/examples/local-server.example.json",
    ...overrides,
  };
}

describe("coverage identity", () => {
  it("normalizes all identity tokens", () => {
    expect(
      coverageKey({
        modelSlug: " Qwen ",
        quantization: "BF16",
        hostSlug: "RTX-4090",
        engineSlug: "vLLM",
        backend: "CUDA",
      }),
    ).toBe("qwen::bf16::rtx-4090::vllm::cuda");
  });

  it("maps matching Performance and local evaluation records to one key", () => {
    expect(performanceCoverageKey(performance())).toBe(evaluationCoverageKey(evaluation()));
  });
});

describe("buildBenchmarkCoverage", () => {
  it("deduplicates Performance concurrency variants and joins the latest evaluation", () => {
    const older = evaluation({ id: "older", completed_at: "2026-08-14T00:00:00Z" });
    const newer = evaluation({ id: "newer", completed_at: "2026-08-15T02:18:42Z" });
    const rows = buildBenchmarkCoverage(
      [
        performance({ id: "c1", concurrency: 1, run_date: "2026-08-13" }),
        performance({ id: "c8", concurrency: 8, run_date: "2026-08-14" }),
      ],
      [older, newer],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      latestPerformanceDate: "2026-08-14",
      state: "published",
      evaluation: { id: "newer" },
    });
  });

  it("excludes broken Performance records and exposes missing coverage", () => {
    const rows = buildBenchmarkCoverage(
      [
        performance({ id: "broken", usability_tag: "broken" }),
        performance({
          id: "missing",
          model: { ...performance().model, slug: "another-model", name: "Another Model" },
        }),
      ],
      [evaluation()],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "missing", model: { slug: "another-model" } });
  });

  it("marks non-completed evaluations as partial", () => {
    const rows = buildBenchmarkCoverage([performance()], [evaluation({ status: "partial" })]);
    expect(rows[0].state).toBe("partial");
  });
});
