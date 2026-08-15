import { describe, expect, it } from "vitest";
import type { EvalHubRun } from "./evalHubClient";
import {
  evalHubProgressPercent,
  formatEvalHubProgressPercent,
  getEvalHubDatasetProgress,
} from "./evalHubRunProgress";

const multiDatasetRun = {
  status: "RUNNING",
  run_spec_json: {
    datasets: [
      {
        dataset_version_id: "smoke-version",
        manifest: {
          metadata: {
            name: "inferstation-accuracy-pipeline-smoke-10",
            display_name: "Smoke 10",
            version: "smoke-v1",
          },
        },
      },
      {
        dataset_version_id: "mmlu-version",
        manifest: {
          metadata: {
            name: "mmlu-full-native",
            display_name: "MMLU Full",
            version: "native-v1",
          },
        },
      },
    ],
  },
  datasets: [
    {
      id: "run-smoke",
      dataset_version_id: "smoke-version",
      protocol_id: "smoke-choice-v1",
      status: "RUNNING",
      total_samples: 10,
      completed_samples: 10,
      counters_json: {},
    },
    {
      id: "run-mmlu",
      dataset_version_id: "mmlu-version",
      protocol_id: "mmlu-choice-v1",
      status: "RUNNING",
      total_samples: 14_042,
      completed_samples: 21,
      counters_json: {},
    },
  ],
} as EvalHubRun;

describe("Eval Hub multi-dataset progress", () => {
  it("keeps every dataset independent and resolves its frozen identity", () => {
    const progress = getEvalHubDatasetProgress(multiDatasetRun);

    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({
      displayName: "Smoke 10",
      version: "smoke-v1",
      completedSamples: 10,
      totalSamples: 10,
      percent: 100,
      status: "SAMPLES COMPLETE",
    });
    expect(progress[1]).toMatchObject({
      displayName: "MMLU Full",
      version: "native-v1",
      completedSamples: 21,
      totalSamples: 14_042,
      status: "RUNNING",
    });
  });

  it("shows useful precision for a large run that has just started", () => {
    const percent = evalHubProgressPercent(21, 14_042);

    expect(percent).toBeCloseTo(0.1496, 3);
    expect(formatEvalHubProgressPercent(percent)).toBe("0.1%");
    expect(formatEvalHubProgressPercent(100)).toBe("100%");
  });
});
