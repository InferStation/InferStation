import CompareLoader from "../CompareLoader";
import { MODEL_RELEASE_ORDER } from "@/lib/modelOrder";

export function generateStaticParams() {
  return MODEL_RELEASE_ORDER.map((model) => ({ model }));
}

export default async function ModelComparePage({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  return <CompareLoader modelSlug={model} />;
}
