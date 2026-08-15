import type { Metadata } from "next";
import BenchmarkSummary from "@/components/BenchmarkSummary";

export const metadata: Metadata = {
  title: "Accuracy — InferStation",
  description:
    "Reproducible model accuracy evaluations for local inference servers and online APIs.",
};

export default function AccuracyPage() {
  return <BenchmarkSummary />;
}
