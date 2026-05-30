"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAllRuns, githubBlobUrl as getGithubBlobUrl } from "@/lib/runsClient";
import type { RunSummary } from "@/lib/runs";

function formatTokens(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return n.toFixed(1);
  return n.toFixed(2);
}

const BACKEND_STYLE: Record<string, string> = {
  cuda: "bg-[#76B900]/15 text-[#3d6300] dark:text-[#a3d756]",
  vulkan: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  vllm: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  rocm: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  hip: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  metal: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  cpu: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function BackendBadge({ backend }: { backend: string }) {
  const key = (backend || "").toLowerCase();
  const cls = BACKEND_STYLE[key] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono font-medium ${cls}`}>
      {backend || "—"}
    </span>
  );
}

const TAG_LABEL: Record<string, { label: string; cls: string }> = {
  ok: {
    label: "✅ ok",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  slow: {
    label: "⚠️ slow",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  fragile: {
    label: "⚠️ fragile",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  broken: {
    label: "❌ broken",
    cls: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
};

export default function RunsIndex() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchAllRuns().then(setRuns).catch((e) => setErr(String(e)));
  }, []);
  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!runs) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <section className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Raw benchmark catalog
        </p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          All runs
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Every row is a single workflow run on a self-hosted machine. The exact command,
          engine commit, and raw JSON are linked from every entry. For curated comparisons
          and charts, see{" "}
          <Link href="/charts" className="underline underline-offset-2">
            Charts
          </Link>
          .
        </p>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Latest runs</h2>
          <p className="text-xs text-zinc-500">
            {runs.length} run{runs.length === 1 ? "" : "s"} on record
          </p>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
            No runs yet. Trigger a workflow under{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-900">
              .github/workflows/
            </code>{" "}
            to publish one.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Quant</th>
                  <th className="px-3 py-2 text-right font-medium">BS</th>
                  <th className="px-3 py-2 font-medium">Engine</th>
                  <th className="px-3 py-2 font-medium">Backend</th>
                  <th className="px-3 py-2 text-right font-medium">pp tok/s</th>
                  <th className="px-3 py-2 text-right font-medium">tg tok/s</th>
                  <th className="px-3 py-2 font-medium">Tag</th>
                  <th className="px-3 py-2 font-medium">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {runs.map((r) => {
                  const tag = TAG_LABEL[r.usability_tag] ?? TAG_LABEL.ok;
                  return (
                    <tr
                      key={r.id}
                      className="odd:bg-white even:bg-zinc-50/50 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/40"
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                        {r.run_date}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.host.name}</div>
                        <div className="text-xs text-zinc-500">
                          {r.host.vendor} {r.host.chip} · {r.host.vram_gb}GB
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.model.name}</div>
                        <div className="text-xs text-zinc-500">
                          {r.model.params_b}B params
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                        {r.model.quantization}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {r.concurrency ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div>{r.engine.name}</div>
                        <div className="text-xs text-zinc-500">
                          {r.engine.commit.slice(0, 8) || r.engine.version}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <BackendBadge backend={r.engine.backend} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatTokens(r.pp_toks_per_s)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatTokens(r.tg_toks_per_s)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${tag.cls}`}
                        >
                          {tag.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        <Link
                          href={`/runs/detail?id=${encodeURIComponent(r.id)}`}
                          className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:text-zinc-300 dark:hover:decoration-zinc-100"
                        >
                          details
                        </Link>
                        {" · "}
                        <a
                          href={getGithubBlobUrl(r.source_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:text-zinc-300 dark:hover:decoration-zinc-100"
                        >
                          json
                        </a>
                        {r.log_url ? (
                          <>
                            {" · "}
                            <a
                              href={r.log_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:text-zinc-300 dark:hover:decoration-zinc-100"
                            >
                              run
                            </a>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
