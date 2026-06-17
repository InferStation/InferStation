"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAllRuns } from "@/lib/runsClient";
import { type RunSummary } from "@/lib/runs";
import { modelReleaseRank } from "@/lib/modelOrder";

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  if (digits === 0 && n >= 100) return Math.round(n).toLocaleString();
  return n.toFixed(digits);
}

function pct(num: number, den: number): string {
  if (!den) return "—";
  const v = (num / den - 1) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

function ratio(num: number, den: number): string {
  if (!den) return "—";
  return `${(num / den).toFixed(2)}×`;
}

interface HostStat {
  slug: string;
  name: string;
  vendor: string;
  chip: string;
  vramGb: number;
  deploymentForm: string;
  runCount: number;
  backends: string[];
  quants: string[];
  bestDecode: { tg: number; quant: string; backend: string; concurrency: number | null } | null;
  bestPrefill: { pp: number; quant: string; backend: string; concurrency: number | null } | null;
}

function aggregateHosts(runs: RunSummary[]): HostStat[] {
  const map = new Map<string, HostStat>();
  for (const r of runs) {
    let h = map.get(r.host.slug);
    if (!h) {
      h = {
        slug: r.host.slug,
        name: r.host.name,
        vendor: r.host.vendor,
        chip: r.host.chip,
        vramGb: r.host.vram_gb,
        deploymentForm: r.host.deployment_form,
        runCount: 0,
        backends: [],
        quants: [],
        bestDecode: null,
        bestPrefill: null,
      };
      map.set(r.host.slug, h);
    }
    h.runCount += 1;
    if (!h.backends.includes(r.engine.backend)) h.backends.push(r.engine.backend);
    if (!h.quants.includes(r.model.quantization)) h.quants.push(r.model.quantization);
    if (r.tg_toks_per_s != null && (!h.bestDecode || r.tg_toks_per_s > h.bestDecode.tg)) {
      h.bestDecode = {
        tg: r.tg_toks_per_s,
        quant: r.model.quantization,
        backend: r.engine.backend,
        concurrency: r.concurrency,
      };
    }
    if (r.pp_toks_per_s != null && (!h.bestPrefill || r.pp_toks_per_s > h.bestPrefill.pp)) {
      h.bestPrefill = {
        pp: r.pp_toks_per_s,
        quant: r.model.quantization,
        backend: r.engine.backend,
        concurrency: r.concurrency,
      };
    }
  }
  return [...map.values()].sort((a, b) => b.runCount - a.runCount);
}

interface BackendCompare {
  hostName: string;
  quant: string;
  concurrency: number;
  cuda: { pp: number; tg: number; combined: number | null };
  vulkan: { pp: number; tg: number; combined: number | null };
}

function pickBackendComparison(runs: RunSummary[]): BackendCompare | null {
  const buckets = new Map<string, RunSummary[]>();
  for (const r of runs) {
    if (r.concurrency == null) continue;
    const k = `${r.host.slug}::${r.model.slug}::${r.model.quantization}::${r.concurrency}`;
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  let best: BackendCompare | null = null;
  for (const arr of buckets.values()) {
    const cuda = arr.find((r) => r.engine.backend.toLowerCase() === "cuda");
    const vk = arr.find((r) => r.engine.backend.toLowerCase() === "vulkan");
    if (!cuda || !vk) continue;
    if (cuda.pp_toks_per_s == null || vk.pp_toks_per_s == null) continue;
    if (cuda.tg_toks_per_s == null || vk.tg_toks_per_s == null) continue;
    if (!best || (cuda.concurrency ?? 0) > best.concurrency) {
      best = {
        hostName: cuda.host.name,
        quant: cuda.model.quantization,
        concurrency: cuda.concurrency ?? 1,
        cuda: {
          pp: cuda.pp_toks_per_s,
          tg: cuda.tg_toks_per_s,
          combined: cuda.combined_toks_per_s ?? null,
        },
        vulkan: {
          pp: vk.pp_toks_per_s,
          tg: vk.tg_toks_per_s,
          combined: vk.combined_toks_per_s ?? null,
        },
      };
    }
  }
  return best;
}

interface BatchingStat {
  hostName: string;
  quant: string;
  backend: string;
  bs1: { pp: number; tg: number; combined: number | null };
  bsN: { n: number; pp: number; tg: number; combined: number | null };
}

function pickBatchingShowcase(runs: RunSummary[]): BatchingStat | null {
  const buckets = new Map<string, RunSummary[]>();
  for (const r of runs) {
    if (r.concurrency == null) continue;
    if (r.engine.backend.toLowerCase() !== "cuda") continue;
    const k = `${r.host.slug}::${r.model.slug}::${r.model.quantization}::${r.engine.backend}`;
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  let best: BatchingStat | null = null;
  let bestGain = 0;
  for (const arr of buckets.values()) {
    const sorted = [...arr].sort((a, b) => (a.concurrency ?? 0) - (b.concurrency ?? 0));
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    if (!lo || !hi || lo === hi) continue;
    if (lo.tg_toks_per_s == null || hi.tg_toks_per_s == null) continue;
    if (lo.pp_toks_per_s == null || hi.pp_toks_per_s == null) continue;
    const gain = hi.tg_toks_per_s / lo.tg_toks_per_s;
    if (gain > bestGain) {
      bestGain = gain;
      best = {
        hostName: hi.host.name,
        quant: hi.model.quantization,
        backend: hi.engine.backend,
        bs1: {
          pp: lo.pp_toks_per_s,
          tg: lo.tg_toks_per_s,
          combined: lo.combined_toks_per_s ?? null,
        },
        bsN: {
          n: hi.concurrency ?? 0,
          pp: hi.pp_toks_per_s,
          tg: hi.tg_toks_per_s,
          combined: hi.combined_toks_per_s ?? null,
        },
      };
    }
  }
  return best;
}

interface QuantStat {
  hostName: string;
  backend: string;
  concurrency: number;
  high: { quant: string; tg: number };
  low: { quant: string; tg: number };
}

function pickQuantShowcase(runs: RunSummary[]): QuantStat | null {
  const buckets = new Map<string, RunSummary[]>();
  for (const r of runs) {
    if (r.concurrency == null) continue;
    if (r.engine.backend.toLowerCase() !== "cuda") continue;
    if (r.concurrency !== 1) continue;
    const k = `${r.host.slug}::${r.model.slug}::${r.engine.backend}::${r.concurrency}`;
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    const valid = arr.filter((r) => r.tg_toks_per_s != null);
    if (valid.length < 2) continue;
    const sorted = [...valid].sort((a, b) => (a.tg_toks_per_s ?? 0) - (b.tg_toks_per_s ?? 0));
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    return {
      hostName: hi.host.name,
      backend: hi.engine.backend,
      concurrency: hi.concurrency ?? 1,
      high: { quant: hi.model.quantization, tg: hi.tg_toks_per_s ?? 0 },
      low: { quant: lo.model.quantization, tg: lo.tg_toks_per_s ?? 0 },
    };
  }
  return null;
}

function StatBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function perfDevice(name: string): "Spark" | "Halo" | null {
  if (/spark|dgx/i.test(name)) return "Spark";
  if (/halo|ryzen|strix/i.test(name)) return "Halo";
  return null;
}

interface PerfCell {
  tps: number;
  engine: string;
  quant: string;
}

interface PerfRow {
  model: string;
  slug: string;
  spark: PerfCell | null;
  halo: PerfCell | null;
}

/** Peak combined throughput (concurrency=32) per model on each device, with the
 *  engine/quant that achieved it. A direct "fastest config" lookup, no narrative. */
function buildPerfTable(runs: RunSummary[]): PerfRow[] {
  const map = new Map<string, PerfRow>();
  for (const r of runs) {
    if (r.concurrency !== 32) continue;
    const total = r.total_toks_per_s ?? r.combined_toks_per_s;
    if (total == null || total <= 0) continue;
    const dev = perfDevice(r.host.name);
    if (!dev) continue;
    const row = map.get(r.model.slug) ?? {
      model: r.model.name,
      slug: r.model.slug,
      spark: null,
      halo: null,
    };
    const fw = /vllm/i.test(r.engine.name) ? "vLLM" : "llama.cpp";
    const cell: PerfCell = { tps: total, engine: fw, quant: r.model.quantization };
    if (dev === "Spark" && (!row.spark || total > row.spark.tps)) row.spark = cell;
    if (dev === "Halo" && (!row.halo || total > row.halo.tps)) row.halo = cell;
    map.set(r.model.slug, row);
  }
  return [...map.values()].sort((a, b) => {
    const ra = modelReleaseRank(a.slug);
    const rb = modelReleaseRank(b.slug);
    if (ra !== rb) return ra - rb;
    return a.model.localeCompare(b.model);
  });
}

export default function Home() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchAllRuns().then(setRuns).catch((e) => setErr(String(e)));
  }, []);
  if (err)
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12 text-sm text-red-600">
        Failed to load: {err}
      </div>
    );
  if (!runs)
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-12 text-sm text-zinc-500">
        Loading…
      </div>
    );
  const hosts = aggregateHosts(runs);
  const perfTable = buildPerfTable(runs);

  const totalRuns = runs.length;
  const totalModels = new Set(runs.map((r) => r.model.slug)).size;
  const totalQuants = new Set(runs.map((r) => r.model.quantization)).size;
  const totalBackends = new Set(runs.map((r) => r.engine.backend.toLowerCase())).size;
  const latestDate = runs[0]?.run_date ?? "";

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
      {/* Hero */}
      <section className="flex flex-col gap-5">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Inference Reference Station · v0
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          LLM inference benchmarks on the hardware{" "}
          <span className="text-emerald-700 dark:text-emerald-400">you can actually buy</span>.
        </h1>
        <p className="max-w-2xl text-base text-zinc-600 dark:text-zinc-400">
          Every number on this site comes from an automated benchmark{" "}
          <Link
            href="/runs"
            className="underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-900 dark:hover:decoration-zinc-100"
          >
            run
          </Link>{" "}
          on self-hosted hardware — exact command, engine commit, and raw output are linked
          from every entry. No vendor edits. No cherry-picked configs.
        </p>
        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          <Link
            href="/charts"
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Explore charts
          </Link>
          <Link
            href="/docs/methodology"
            className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Methodology
          </Link>
          <Link
            href="/runs"
            className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Browse raw runs
          </Link>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Runs published", value: totalRuns.toString() },
          { label: "Models benchmarked", value: totalModels.toString() },
          { label: "Quantizations covered", value: totalQuants.toString() },
          { label: "Backends compared", value: totalBackends.toString() },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{s.label}</div>
          </div>
        ))}
      </section>
      {latestDate ? (
        <p className="mt-3 text-xs text-zinc-500">Last updated {latestDate}.</p>
      ) : null}

      {/* Peak throughput by model */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Peak throughput by model</h2>
          <Link
            href="/charts"
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Full charts
          </Link>
        </div>
        <p className="mt-2 max-w-3xl text-xs text-zinc-500">
          Best combined (prefill + decode) throughput at 32 concurrent requests, with the fastest
          engine and quantization measured on each device.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 text-right font-medium">DGX Spark</th>
                <th className="px-4 py-2 text-right font-medium">Strix Halo</th>
                <th className="px-4 py-2 text-right font-medium">Spark / Halo</th>
              </tr>
            </thead>
            <tbody>
              {perfTable.map((row) => (
                <tr
                  key={row.model}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className="px-4 py-2 font-medium">{row.model}</td>
                  <td className="px-4 py-2 text-right">
                    {row.spark ? (
                      <div>
                        <div className="font-mono font-semibold tabular-nums">
                          {fmt(row.spark.tps)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {row.spark.engine} · {row.spark.quant}
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {row.halo ? (
                      <div>
                        <div className="font-mono font-semibold tabular-nums">
                          {fmt(row.halo.tps)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {row.halo.engine} · {row.halo.quant}
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                    {row.spark && row.halo ? ratio(row.spark.tps, row.halo.tps) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Combined tok/s at concurrency 32. “—” = not benchmarked on that device.
        </p>
      </section>

      {/* Hardware specs */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Hardware specs</h2>
          <Link
            href="/charts"
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Compare on charts
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          {hosts.map((h) => (
            <article
              key={h.slug}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{h.name}</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {h.vendor} {h.chip} · {h.vramGb} GB · {h.deploymentForm.replace(/_/g, " ")}
                  </p>
                </div>
                <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  {h.runCount} runs
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Best prefill
                  </dt>
                  <dd className="mt-0.5 font-mono tabular-nums">
                    {h.bestPrefill ? fmt(h.bestPrefill.pp) : "—"}{" "}
                    <span className="text-[10px] text-zinc-500">tok/s</span>
                  </dd>
                  {h.bestPrefill ? (
                    <dd className="text-[10px] text-zinc-500">
                      {h.bestPrefill.quant} · {h.bestPrefill.backend} · bs=
                      {h.bestPrefill.concurrency ?? "—"}
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Best decode
                  </dt>
                  <dd className="mt-0.5 font-mono tabular-nums">
                    {h.bestDecode ? fmt(h.bestDecode.tg, 1) : "—"}{" "}
                    <span className="text-[10px] text-zinc-500">tok/s</span>
                  </dd>
                  {h.bestDecode ? (
                    <dd className="text-[10px] text-zinc-500">
                      {h.bestDecode.quant} · {h.bestDecode.backend} · bs=
                      {h.bestDecode.concurrency ?? "—"}
                    </dd>
                  ) : null}
                </div>
              </dl>
              <div className="flex flex-wrap gap-1.5">
                {h.backends.map((b) => (
                  <span
                    key={b}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                  >
                    {b}
                  </span>
                ))}
                <span className="text-[10px] text-zinc-400">·</span>
                {h.quants.map((q) => (
                  <span
                    key={q}
                    className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {q}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* What we measure */}
      <section className="mt-12 rounded-lg border border-zinc-200 bg-zinc-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">What we measure</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              t: "Prefill throughput",
              d: "Tokens per second during prompt processing. Drives time-to-first-token.",
            },
            {
              t: "Decode throughput",
              d: "Tokens per second during generation. The number users actually feel.",
            },
            {
              t: "Batched serving",
              d: "Combined tok/s at bs=1, 4, 16, 32 — what concurrent users would see.",
            },
            {
              t: "Reproducibility",
              d: "Exact command, engine commit, build flags, and raw JSON for every run.",
            },
          ].map((x) => (
            <div key={x.t}>
              <h3 className="text-sm font-semibold">{x.t}</h3>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{x.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <Link
            href="/docs/methodology"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            How we run them
          </Link>
          <Link
            href="/about"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            Why this site
          </Link>
        </div>
      </section>
    </div>
  );
}
