import ChartsLoader from "../../ChartsLoader";
import { staticChartParams } from "@/lib/modelStaticParams";

export function generateStaticParams() {
  return staticChartParams();
}

export default async function ModelFrameworkChartsPage({
  params,
}: {
  params: Promise<{ model: string; framework: string }>;
}) {
  const { model, framework } = await params;
  return <ChartsLoader modelSlug={model} framework={decodeURIComponent(framework)} />;
}
