"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAllRuns, githubBlobUrl } from "@/lib/runsClient";
import type { RunSummary } from "@/lib/runs";

function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

export default function RunsModelClient({ modelSlug }: { modelSlug: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAllRuns()
      .then((all) => setRuns(all.filter((r) => r.model.slug === modelSlug)))
      .catch((e) => setErr(String(e)));
  }, [modelSlug]);

  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!runs) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;

  const first = runs[0];
  if (!first) return <p className="p-8 text-sm text-zinc-500">No runs for {modelSlug}.</p>;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-12">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">
            <Link href="/runs" className="hover:text-zinc-800 dark:hover:text-zinc-200">Runs</Link> / model
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{first.model.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">{runs.length} raw run records</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/charts/${modelSlug}`} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Charts</Link>
          <Link href={`/compare/${modelSlug}`} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Compare</Link>
        </div>
      </section>

      <section className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Device</th>
              <th className="px-3 py-2 font-medium">Framework</th>
              <th className="px-3 py-2 font-medium">Backend</th>
              <th className="px-3 py-2 font-medium">Quant</th>
              <th className="px-3 py-2 text-right font-medium">C</th>
              <th className="px-3 py-2 text-right font-medium">Decode</th>
              <th className="px-3 py-2 text-right font-medium">Prefill</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Links</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {runs.map((r) => (
              <tr key={r.id} className="odd:bg-white even:bg-zinc-50/50 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/40">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">{r.run_date}</td>
                <td className="px-3 py-2">{r.host.name}</td>
                <td className="px-3 py-2">{r.engine.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.engine.backend}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.model.quantization}</td>
                <td className="px-3 py-2 text-right font-mono">{r.concurrency ?? "-"}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.tg_toks_per_s)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.pp_toks_per_s)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.total_toks_per_s ?? r.combined_toks_per_s)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">
                  <Link href={`/runs/detail?id=${encodeURIComponent(r.id)}`} className="underline decoration-zinc-300 underline-offset-2">details</Link>
                  {" · "}
                  <a href={githubBlobUrl(r.source_path)} target="_blank" rel="noreferrer" className="underline decoration-zinc-300 underline-offset-2">json</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
