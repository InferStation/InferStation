import ChartsRedirect from "../ChartsRedirect";
import { MODEL_RELEASE_ORDER } from "@/lib/modelOrder";

export function generateStaticParams() {
  return MODEL_RELEASE_ORDER.map((model) => ({ model }));
}

export default async function ModelChartsPage({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  return <ChartsRedirect model={model} />;
}
