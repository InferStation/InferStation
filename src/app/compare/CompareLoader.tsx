"use client";

import { useEffect, useState } from "react";
import CompareView, { type ChartRun } from "./CompareView";
import { fetchAllRuns } from "@/lib/runsClient";

export default function CompareLoader({ modelSlug }: { modelSlug?: string }) {
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
            concurrency: r.concurrency,
            pp_toks_per_s: r.pp_toks_per_s,
            tg_toks_per_s: r.tg_toks_per_s,
            combined_toks_per_s:
              r.combined_toks_per_s ??
              (r.tg_toks_per_s != null && r.concurrency != null
                ? r.tg_toks_per_s * r.concurrency
                : null),
            ttft_ms: r.ttft_ms ?? null,
            tpot_ms: r.tpot_ms ?? null,
            engine: r.engine.name,
          }));
        setNavData(mapped);
        setData(modelSlug ? mapped.filter((r) => r.model_slug === modelSlug) : mapped);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!data || !navData) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;
  return <CompareView runs={data} navRuns={navData} basePath="/compare" />;
}
