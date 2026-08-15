import type { Metadata } from "next";
import BenchmarkSummary from "@/components/BenchmarkSummary";

export const metadata: Metadata = {
  title: "Benchmark — InferStation",
  description: "Performance-aligned accuracy coverage from versioned LLM Eval Hub protocols.",
};

export default function BenchmarkPage() {
  return <BenchmarkSummary />;
}
