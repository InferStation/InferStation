"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAllRuns } from "@/lib/runsClient";
import { type RunSummary } from "@/lib/runs";

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
  const compare = pickBackendComparison(runs);
  const batching = pickBatchingShowcase(runs);
  const quantShow = pickQuantShowcase(runs);

  const totalRuns = runs.length;
  const totalHosts = hosts.length;
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
          Every number on this site comes from a real{" "}
          <a
            href="https://github.com/JoursBleu/InferStation/actions"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-900 dark:hover:decoration-zinc-100"
          >
            GitHub Actions run
          </a>{" "}
          on a self-hosted machine — exact command, engine commit, and raw output are linked
          from every entry. No vendor edits. No cherry-picked configs.
        </p>
        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          <Link
            href="/charts"
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Explore charts →
          </Link>
          <Link
            href="/methodology"
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
          { label: "Hosts in the lab", value: totalHosts.toString() },
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

      {/* Key findings */}
      <section className="mt-12">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Key findings</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {compare ? (
            <article className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">CUDA vs Vulkan on {compare.hostName}</h3>
                <span className="font-mono text-xs text-zinc-500">bs={compare.concurrency}</span>
              </div>
              <p className="text-xs text-zinc-500">
                Same model ({compare.quant}), same hardware — the backend gap on prefill is
                large, the gap on decode is smaller.
              </p>
              <div className="mt-1 flex flex-col gap-3 text-sm">
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      Prefill tok/s
                    </span>
                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      CUDA {ratio(compare.cuda.pp, compare.vulkan.pp)} faster
                    </span>
                  </div>
                  <StatBar value={compare.cuda.pp} max={compare.cuda.pp} color="bg-[#76B900]" />
                  <div className="mt-1 flex justify-between text-xs font-mono">
                    <span>CUDA {fmt(compare.cuda.pp)}</span>
                  </div>
                  <StatBar value={compare.vulkan.pp} max={compare.cuda.pp} color="bg-rose-500" />
                  <div className="mt-1 flex justify-between text-xs font-mono">
                    <span>Vulkan {fmt(compare.vulkan.pp)}</span>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      Decode tok/s
                    </span>
                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      CUDA {ratio(compare.cuda.tg, compare.vulkan.tg)} faster
                    </span>
                  </div>
                  <StatBar value={compare.cuda.tg} max={compare.cuda.tg} color="bg-[#76B900]" />
                  <div className="mt-1 flex justify-between text-xs font-mono">
                    <span>CUDA {fmt(compare.cuda.tg, 1)}</span>
                  </div>
                  <StatBar value={compare.vulkan.tg} max={compare.cuda.tg} color="bg-rose-500" />
                  <div className="mt-1 flex justify-between text-xs font-mono">
                    <span>Vulkan {fmt(compare.vulkan.tg, 1)}</span>
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          {batching ? (
            <article className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="text-sm font-semibold">Batching: bs=1 → bs={batching.bsN.n}</h3>
              <p className="text-xs text-zinc-500">
                {batching.hostName} · {batching.quant} · {batching.backend} — single-stream
                interactive vs concurrent server use.
              </p>
              <dl className="grid grid-cols-3 gap-2 text-center font-mono text-sm">
                <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Decode</dt>
                  <dd className="mt-1 text-base font-semibold tabular-nums">
                    {ratio(batching.bsN.tg, batching.bs1.tg)}
                  </dd>
                  <dd className="text-[10px] text-zinc-500">
                    {fmt(batching.bs1.tg, 1)} → {fmt(batching.bsN.tg, 1)}
                  </dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Prefill</dt>
                  <dd className="mt-1 text-base font-semibold tabular-nums">
                    {ratio(batching.bsN.pp, batching.bs1.pp)}
                  </dd>
                  <dd className="text-[10px] text-zinc-500">
                    {fmt(batching.bs1.pp)} → {fmt(batching.bsN.pp)}
                  </dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Combined</dt>
                  <dd className="mt-1 text-base font-semibold tabular-nums">
                    {batching.bs1.combined && batching.bsN.combined
                      ? ratio(batching.bsN.combined, batching.bs1.combined)
                      : "—"}
                  </dd>
                  <dd className="text-[10px] text-zinc-500">
                    {fmt(batching.bs1.combined)} → {fmt(batching.bsN.combined)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-zinc-500">
                Decode tok/s scales near-linearly until memory bandwidth saturates; combined
                throughput is the right metric for a serving workload.
              </p>
            </article>
          ) : null}

          {quantShow ? (
            <article className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="text-sm font-semibold">Quant size vs speed</h3>
              <p className="text-xs text-zinc-500">
                {quantShow.hostName} · {quantShow.backend} · bs={quantShow.concurrency} —
                smaller quants trade quality for tokens/sec.
              </p>
              <div className="flex flex-col gap-3 font-mono text-sm">
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      {quantShow.high.quant}
                    </span>
                    <span className="tabular-nums">{fmt(quantShow.high.tg, 1)} tok/s</span>
                  </div>
                  <StatBar
                    value={quantShow.high.tg}
                    max={quantShow.high.tg}
                    color="bg-[#76B900]"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">
                      {quantShow.low.quant}
                    </span>
                    <span className="tabular-nums">{fmt(quantShow.low.tg, 1)} tok/s</span>
                  </div>
                  <StatBar
                    value={quantShow.low.tg}
                    max={quantShow.high.tg}
                    color="bg-zinc-400 dark:bg-zinc-600"
                  />
                </div>
              </div>
              <p className="text-xs text-zinc-500">
                {pct(quantShow.high.tg, quantShow.low.tg)} on decode going from{" "}
                {quantShow.low.quant} → {quantShow.high.quant}. Pick the largest quant your
                quality budget allows.
              </p>
            </article>
          ) : null}
        </div>
      </section>

      {/* Hardware in the lab */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Hardware in the lab</h2>
          <Link
            href="/charts"
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Compare on charts →
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
            href="/methodology"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            How we run them →
          </Link>
          <Link
            href="/about"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            Why this site →
          </Link>
        </div>
      </section>
    </div>
  );
}
