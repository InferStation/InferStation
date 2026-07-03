import ChartsRedirect from "../ChartsRedirect";
import { staticModelParams } from "@/lib/modelStaticParams";

export function generateStaticParams() {
  return staticModelParams();
}

export default async function ModelChartsPage({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  return <ChartsRedirect model={model} />;
}
