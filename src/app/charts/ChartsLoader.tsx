"use client";

import { useEffect, useState } from "react";
import ChartsView, { type ChartRun } from "./ChartsView";
import { fetchAllRuns } from "@/lib/runsClient";

export default function ChartsLoader({ modelSlug, framework }: { modelSlug?: string; framework?: string }) {
  const [data, setData] = useState<ChartRun[] | null>(null);
  const [navData, setNavData] = useState<ChartRun[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAllRuns()
      .then((runs) => {
        const mapped = runs.map((r) => ({
            id: r.id,
            host_slug: r.host.slug,
            host_name: r.host.name,
            host_vendor: r.host.vendor,
            host_chip: r.host.chip,
            engine_backend: r.engine.backend,
            model_slug: r.model.slug,
            model_name: r.model.name,
            params_b: r.model.params_b,
            quantization: r.model.quantization,
            scheme: r.model.scheme ?? "",
            concurrency: r.concurrency,
            pp_toks_per_s: r.pp_toks_per_s,
            tg_toks_per_s: r.tg_toks_per_s,
            combined_toks_per_s:
              r.combined_toks_per_s ??
              (r.tg_toks_per_s != null && r.concurrency != null
                ? r.tg_toks_per_s * r.concurrency
                : null),
            engine: r.engine.name,
          }));
        setNavData(mapped);
        const fw = (framework || "").toLowerCase();
        setData(
          mapped.filter(
            (r) =>
              (!modelSlug || r.model_slug === modelSlug) &&
              (!fw || (r.engine || "").toLowerCase() === fw),
          ),
        );
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!data || !navData) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;
  return <ChartsView runs={data} navRuns={navData} basePath="/charts" selectedFramework={framework} />;
}
