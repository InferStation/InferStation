export const MODEL_RELEASE_ORDER = [
  "mimo-v2.5",
  "qwen3.6-27b",
  "qwen3.6-35b-a3b",
  "diffusiongemma-26b-a4b",
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
  "step-3.5-flash",
  "qwen3-32b",
  "qwen3-30b-a3b",
  "qwen3-14b",
  "qwen3-8b",
  "qwen3-4b",
  "llama-3.3-70b-instruct",
  "llama-3.1-8b-instruct",
];

export function modelReleaseRank(slug: string): number {
  const i = MODEL_RELEASE_ORDER.indexOf((slug || "").toLowerCase());
  return i < 0 ? MODEL_RELEASE_ORDER.length : i;
}
