import HistoryLoader from "../HistoryLoader";
import { MODEL_RELEASE_ORDER } from "@/lib/modelOrder";

export function generateStaticParams() {
  return MODEL_RELEASE_ORDER.map((model) => ({ model }));
}

export default async function ModelHistoryPage({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  return <HistoryLoader modelSlug={model} />;
}
