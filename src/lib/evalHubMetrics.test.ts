import { describe, expect, it } from "vitest";
import {
  formatEvalMetric,
  formatEvalPolicy,
  formatProtocolComponent,
  humanMetricName,
} from "./evalHubMetrics";

describe("Eval Hub metric presentation", () => {
  it("formats protocol quality ratios as percentages", () => {
    expect(formatEvalMetric("accuracy", 1)).toBe("100.00%");
    expect(formatEvalMetric("numeric_match", 0.875)).toBe("87.50%");
    expect(formatEvalMetric("macro_f1", 0.5)).toBe("50.00%");
    expect(formatEvalMetric("api_error_rate", 0.125)).toBe("12.50%");
  });

  it("does not turn counts or latency into percentages", () => {
    expect(formatEvalMetric("total_samples", 10)).toBe("10.0000");
    expect(formatEvalMetric("latency_success_p95_ms", 3911.9)).toBe("3911.9000");
    expect(formatEvalMetric("accuracy", null)).toBe("—");
  });

  it("renders the frozen scorer, parser, and denominator policy", () => {
    expect(formatProtocolComponent({ type: "exact_choice", version: "1" })).toBe("Exact Choice · v1");
    expect(formatProtocolComponent({ type: "choice_letter", version: "1", allowed: ["A", "B", "C", "D"] })).toBe("Choice Letter · v1 · allowed: A/B/C/D");
    expect(formatProtocolComponent({ type: "numeric_match", version: "1", primary_metric: "numeric_match", absolute_tolerance: 0, relative_tolerance: 0 })).toBe("Numeric Match · v1 · abs tol: 0 · rel tol: 0");
    expect(formatEvalPolicy("count_as_incorrect")).toBe("Count as incorrect · count_as_incorrect");
  });

  it("turns metric identifiers into readable labels", () => {
    expect(humanMetricName("numeric_match")).toBe("Numeric Match");
  });
});
