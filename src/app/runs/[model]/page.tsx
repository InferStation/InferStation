import { MODEL_RELEASE_ORDER } from "@/lib/modelOrder";
import RunsModelClient from "./RunsModelClient";

export function generateStaticParams() {
  return MODEL_RELEASE_ORDER.map((model) => ({ model }));
}

export default async function ModelRunsPage({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  return <RunsModelClient modelSlug={model} />;
}
