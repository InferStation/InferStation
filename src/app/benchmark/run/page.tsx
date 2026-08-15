import type { Metadata } from "next";
import EvalHubRunConsole from "@/components/EvalHubRunConsole";

export const metadata: Metadata = {
  title: "Run benchmark — InferStation",
  description: "Run an arbitrary OpenAI-compatible model service through LLM Eval Hub.",
};

export default function RunBenchmarkPage() {
  return <EvalHubRunConsole />;
}
