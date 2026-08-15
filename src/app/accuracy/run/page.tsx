import type { Metadata } from "next";
import EvalHubRunConsole from "@/components/EvalHubRunConsole";

export const metadata: Metadata = {
  title: "Run accuracy evaluation — InferStation",
  description:
    "Evaluate an arbitrary OpenAI-compatible model service through LLM Eval Hub.",
};

export default function RunAccuracyEvaluationPage() {
  return <EvalHubRunConsole />;
}
