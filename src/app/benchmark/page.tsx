import type { Metadata } from "next";
import AccuracySummary from "@/components/AccuracySummary";

export const metadata: Metadata = {
  title: "Accuracy — InferStation",
  description: "Performance-aligned accuracy coverage from versioned LLM Eval Hub protocols.",
};

export default function LegacyAccuracyPage() {
  return <AccuracySummary />;
}
