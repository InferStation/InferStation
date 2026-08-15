import type { EvalHubProtocol } from "@/lib/evalHubClient";

type ProtocolComponent = EvalHubProtocol["parser"] | EvalHubProtocol["scorer"];

export function humanMetricName(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatEvalMetric(name: string, value: number | null | undefined): string {
  if (value == null) return "—";
  if (name === "accuracy" || name.endsWith("_rate") || name.endsWith("_match") || name.endsWith("_f1")) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toFixed(4);
}

export function formatProtocolComponent(component: ProtocolComponent | undefined): string {
  if (!component?.type) return "—";
  const details = [humanMetricName(component.type)];
  if (component.version) details.push(`v${component.version}`);

  const allowed = component.allowed;
  if (Array.isArray(allowed) && allowed.length) details.push(`allowed: ${allowed.join("/")}`);

  if (component.type === "numeric_match") {
    const absolute = component.absolute_tolerance;
    const relative = component.relative_tolerance;
    if (typeof absolute === "number") details.push(`abs tol: ${absolute}`);
    if (typeof relative === "number") details.push(`rel tol: ${relative}`);
  }
  return details.join(" · ");
}

export function formatEvalPolicy(value: string | undefined): string {
  if (!value) return "—";
  const descriptions: Record<string, string> = {
    all_scoring_samples: "All scoring samples",
    valid_responses_only: "Valid responses only",
    count_as_incorrect: "Count as incorrect",
    exclude_and_report: "Exclude and report",
  };
  return descriptions[value] ? `${descriptions[value]} · ${value}` : value;
}
