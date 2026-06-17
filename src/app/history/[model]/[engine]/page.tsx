import HistoryLoader from "../../HistoryLoader";
import { MODEL_RELEASE_ORDER } from "@/lib/modelOrder";

const ENGINES = ["llama.cpp", "vllm"];

export function generateStaticParams() {
  const params: { model: string; engine: string }[] = [];
  for (const model of MODEL_RELEASE_ORDER) {
    for (const engine of ENGINES) {
      params.push({ model, engine });
    }
  }
  return params;
}

export default async function ModelEngineHistoryPage({
  params,
}: {
  params: Promise<{ model: string; engine: string }>;
}) {
  const { model, engine } = await params;
  return <HistoryLoader modelSlug={model} engine={decodeURIComponent(engine)} />;
}
