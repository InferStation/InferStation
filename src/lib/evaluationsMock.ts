import mockRecord from "../../data/evaluations/examples/local-server.example.json";
import type { EvaluationManifest, EvaluationRunSummary } from "./evaluations";

const sourcePath = "data/evaluations/examples/local-server.example.json";

export const evaluationMockManifest: EvaluationManifest = {
  schema_version: 1,
  generated_at: "2026-08-15T02:18:42Z",
  runs: [
    {
      ...mockRecord,
      id: "mock__rtx-4090-sh-qwen3.6-35b-a3b-bf16-vllm",
      source_path: sourcePath,
      raw_output: undefined,
    } as unknown as EvaluationRunSummary,
  ],
};
