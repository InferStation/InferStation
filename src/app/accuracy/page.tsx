import type { Metadata } from "next";
import AccuracySummary from "@/components/AccuracySummary";

export const metadata: Metadata = {
  title: "Accuracy — InferStation",
  description:
    "Reproducible model accuracy evaluations for local inference servers and online APIs.",
};

export default function AccuracyPage() {
  return <AccuracySummary />;
}
