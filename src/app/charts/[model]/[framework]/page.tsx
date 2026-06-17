import ChartsLoader from "../../ChartsLoader";
import { MODEL_RELEASE_ORDER } from "@/lib/modelOrder";

const FRAMEWORKS = ["llama.cpp", "vllm"];

export function generateStaticParams() {
  const params: { model: string; framework: string }[] = [];
  for (const model of MODEL_RELEASE_ORDER) {
    for (const framework of FRAMEWORKS) {
      params.push({ model, framework });
    }
  }
  return params;
}

export default async function ModelFrameworkChartsPage({
  params,
}: {
  params: Promise<{ model: string; framework: string }>;
}) {
  const { model, framework } = await params;
  return <ChartsLoader modelSlug={model} framework={decodeURIComponent(framework)} />;
}
