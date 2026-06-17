"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { modelReleaseRank } from "@/lib/modelOrder";

export interface HistoryRun {
  id: string;
  host_slug: string;
  host_name: string;
  host_vendor: string;
  host_chip: string;
  engine_backend: string;
  model_slug: string;
  model_name: string;
  params_b: number;
  quantization: string;
  concurrency: number | null;
  pp_toks_per_s: number | null;
  tg_toks_per_s: number | null;
  combined_toks_per_s: number | null;
  engine: string;
  run_date: string;
}

type Metric = "tg_toks_per_s" | "pp_toks_per_s" | "combined_toks_per_s";

const METRICS: { key: Metric; label: string; sub: string }[] = [
  { key: "tg_toks_per_s", label: "Generation (tg)", sub: "decode tokens/s over time" },
  { key: "pp_toks_per_s", label: "Prefill (pp)", sub: "prefill tokens/s over time" },
  { key: "combined_toks_per_s", label: "Combined", sub: "(pp + tg) effective tokens/s over time" },
];

// ---- color helpers (kept in sync with ChartsView) ----
// One color per concurrency line within a chart. Muted, low-saturation palette
// (slate / teal / muted-blue / clay / sage / mauve) for a calmer, more
// professional look that prints well and reads in both light and dark mode.
const LINE_COLORS = ["#475569", "#0f766e", "#1d4ed8", "#b45309", "#4d7c0f", "#9d174d", "#6d28d9"];

function vllmBackendLabel(raw: string): string {
  const b = (raw || "").toLowerCase();
  if (b.includes("flash_attn") || b.includes("flash")) return "FLASH_ATTN";
  return "TRITON_ATTN";
}

function displayBackend(r: HistoryRun): string {
  if ((r.engine || "").toLowerCase().includes("vllm")) return vllmBackendLabel(r.engine_backend);
  return r.engine_backend;
}

const QUANT_ORDER = ["BF16", "Q8_0", "FP8", "FP8-block", "Quark-W8A8-INT8", "AWQ-4bit", "UD-Q4_K_M", "Q4_K_M", "Q4_K_S", "UD-Q3_K_M", "UD-Q2_K_XL", "UD-IQ2_M"];
function quantRank(q: string): number {
  const i = QUANT_ORDER.indexOf(q);
  return i >= 0 ? i : QUANT_ORDER.length + 1;
}

function schemeOf(q: string, engine: string): string {
  const u = (q || "").toUpperCase();
  if (u === "BF16" || u === "F16" || u.includes("FP16")) return "W16A16";
  const isLlama = (engine || "").toLowerCase().includes("llama");
  let w: number;
  if (u.includes("FP8") || u.includes("W8A8") || (u.includes("INT8") && !u.includes("INT8E")) || u.includes("Q8")) w = 8;
  else if (/Q6|IQ6/.test(u)) w = 6;
  else if (/Q5|IQ5/.test(u)) w = 5;
  else if (u.includes("AWQ") || u.includes("MXFP4") || u.includes("NVFP4") || /Q4|IQ4/.test(u)) w = 4;
  else if (/Q3|IQ3/.test(u)) w = 3;
  else if (/Q2|IQ2/.test(u)) w = 2;
  else if (u.includes("IQ1") || /Q1/.test(u)) w = 1;
  else return q;
  let a: number;
  if (isLlama) a = 8;
  else if (u.includes("FP8") || u.includes("W8A8") || u.includes("INT8")) a = 8;
  else a = 16;
  return `W${w}A${a}`;
}

interface ModelGroup {
  slug: string;
  name: string;
  params_b: number;
  runs: HistoryRun[];
}

interface EngineGroup {
  engine: string;
  label: string;
  models: ModelGroup[];
}

const ENGINE_ORDER = ["vllm", "llama.cpp"];
const ENGINE_LABEL: Record<string, string> = { vllm: "vLLM", "llama.cpp": "llama.cpp" };

export default function HistoryView({
  navRuns,
  modelSlug,
  engine,
  basePath = "/history",
}: {
  navRuns: HistoryRun[];
  modelSlug?: string;
  engine?: string;
  basePath?: string;
}) {
  const engines = useMemo<EngineGroup[]>(() => {
    const byEngine = new Map<string, Map<string, ModelGroup>>();
    for (const r of navRuns) {
      const eng = (r.engine || "unknown").toLowerCase();
      let mm = byEngine.get(eng);
      if (!mm) {
        mm = new Map();
        byEngine.set(eng, mm);
      }
      let g = mm.get(r.model_slug);
      if (!g) {
        g = { slug: r.model_slug, name: r.model_name, params_b: r.params_b, runs: [] };
        mm.set(r.model_slug, g);
      }
      g.runs.push(r);
    }
    const groups: EngineGroup[] = [];
    for (const [eng, mm] of byEngine) {
      groups.push({
        engine: eng,
        label: ENGINE_LABEL[eng] ?? eng,
        models: Array.from(mm.values()).sort((a, b) => {
          const ra = modelReleaseRank(a.slug);
          const rb = modelReleaseRank(b.slug);
          if (ra !== rb) return ra - rb;
          return a.name.localeCompare(b.name);
        }),
      });
    }
    return groups.sort((a, b) => {
      const ia = ENGINE_ORDER.indexOf(a.engine);
      const ib = ENGINE_ORDER.indexOf(b.engine);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.engine.localeCompare(b.engine);
    });
  }, [navRuns]);

  // Resolve the active model + engine from props, falling back to the first
  // engine group that actually contains the requested model (so a model with
  // only one framework lands on a non-empty page without a redirect).
  const { activeModel, activeEngine } = useMemo(() => {
    let am = modelSlug;
    let ae = (engine || "").toLowerCase();
    if (am && !ae) {
      const owner = engines.find((eg) => eg.models.some((m) => m.slug === am));
      ae = owner?.engine || engines[0]?.engine || "";
    }
    if (!am) {
      const eg = engines.find((e) => e.engine === ae) || engines[0];
      am = eg?.models[0]?.slug || "";
      ae = eg?.engine || "";
    }
    return { activeModel: am, activeEngine: ae };
  }, [engines, modelSlug, engine]);

  const [metric, setMetric] = useState<Metric>("tg_toks_per_s");

  const selectedRuns = useMemo(
    () =>
      navRuns.filter(
        (r) => r.model_slug === activeModel && (r.engine || "").toLowerCase() === activeEngine,
      ),
    [navRuns, activeModel, activeEngine],
  );
  const selectedName = selectedRuns[0]?.model_name || activeModel;

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-6 py-10">
      <aside className="w-64 shrink-0">
        <div className="flex flex-col gap-5">
          {engines.map((eg) => (
            <div key={eg.engine}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {eg.label}
              </h2>
              <ul className="flex flex-col gap-1">
                {eg.models.map((m) => {
                  const key = `${eg.engine}::${m.slug}`;
                  const active = m.slug === activeModel && eg.engine === activeEngine;
                  return (
                    <li key={key}>
                      <Link
                        href={`${basePath}/${m.slug}/${eg.engine}`}
                        className={`block w-full rounded-md px-3 py-2 text-left text-sm transition ${
                          active
                            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <div className="font-medium">{m.name}</div>
                        <div
                          className={`text-xs ${
                            active ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500"
                          }`}
                        >
                          {m.runs.length} runs
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <ModelHistory name={selectedName} runs={selectedRuns} metric={metric} setMetric={setMetric} />
      </main>
    </div>
  );
}

function ModelHistory({
  name,
  runs,
  metric,
  setMetric,
}: {
  name: string;
  runs: HistoryRun[];
  metric: Metric;
  setMetric: (m: Metric) => void;
}) {
  // One chart per (device + backend, quantization) combo.
  const charts = useMemo(() => {
    const engine = runs[0]?.engine || "";
    const map = new Map<
      string,
      { host_name: string; backend: string; quant: string; runs: HistoryRun[] }
    >();
    for (const r of runs) {
      const backend = displayBackend(r);
      const key = `${r.host_slug}::${backend}::${r.quantization}`;
      let g = map.get(key);
      if (!g) {
        g = { host_name: r.host_name, backend, quant: r.quantization, runs: [] };
        map.set(key, g);
      }
      g.runs.push(r);
    }
    const arr = Array.from(map.entries()).map(([key, g]) => {
      const allDates = Array.from(new Set(g.runs.map((r) => r.run_date))).sort();
      const concs = Array.from(
        new Set(g.runs.filter((r) => r.concurrency != null).map((r) => r.concurrency as number)),
      ).sort((a, b) => a - b);
      // value at each date per concurrency (avg if multiple runs that day)
      const rawSeries = concs.map((c) =>
        allDates.map((d) => {
          const vals = g.runs
            .filter((r) => r.run_date === d && r.concurrency === c)
            .map((r) => r[metric])
            .filter((v): v is number => v != null);
          return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
        }),
      );
      // Drop dates where every series is null or 0 (a failed/zero day) so the
      // line doesn't dip to 0 and back up.
      const keep = allDates
        .map((_, i) => i)
        .filter((i) => rawSeries.some((pts) => pts[i] != null && (pts[i] as number) > 0));
      const dates = keep.map((i) => allDates[i]);
      const series = concs.map((c, ci) => ({
        label: `BS ${c}`,
        color: LINE_COLORS[ci % LINE_COLORS.length],
        points: keep.map((i) => rawSeries[ci][i]),
      }));
      return {
        key,
        host_name: g.host_name,
        backend: g.backend,
        quant: g.quant,
        scheme: schemeOf(g.quant, engine),
        dates,
        series,
      };
    });
    // drop charts with no remaining data, then sort: device name, precision rank
    return arr
      .filter((c) => c.dates.length > 0)
      .sort((a, b) => {
        if (a.host_name !== b.host_name) return a.host_name.localeCompare(b.host_name);
        const r = quantRank(a.quant) - quantRank(b.quant);
        return r !== 0 ? r : a.quant.localeCompare(b.quant);
      });
  }, [runs, metric]);

  const sub = METRICS.find((m) => m.key === metric)!.sub;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Performance history over time. One chart per device &amp; precision; each line is a
            concurrency level (batch size).
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 text-sm dark:border-zinc-700">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`px-3 py-1.5 ${
                m.key === metric
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {charts.length === 0 ? (
        <p className="text-sm text-zinc-500">No data for this selection.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {charts.map((c) => (
            <LineChart
              key={c.key}
              title={`${c.host_name} \u00b7 ${c.backend}`}
              note={`${c.scheme} \u00b7 ${c.quant}`}
              subtitle={sub}
              dates={c.dates}
              series={c.series}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LineSeries {
  label: string;
  color: string;
  points: (number | null)[];
}

function LineChart({
  title,
  note,
  subtitle,
  dates,
  series,
}: {
  title: string;
  note: string;
  subtitle: string;
  dates: string[];
  series: LineSeries[];
}) {
  const W = 640;
  const H = 360;
  const PAD_L = 64;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 56;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  let max = 0;
  for (const s of series) for (const v of s.points) if (v != null && v > max) max = v;
  if (max <= 0) max = 1;
  const niceMax = niceCeil(max * 1.08);

  const n = dates.length;
  const xAt = (i: number) => (n <= 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD_T + plotH - (v / niceMax) * plotH;

  const ticks = 5;
  const yTickValues: number[] = [];
  for (let i = 0; i <= ticks; i++) yTickValues.push((niceMax * i) / ticks);

  // thin date labels so they never crowd (~8 max)
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
        </div>
        <p className="shrink-0 text-xs text-zinc-500">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" role="img" aria-label={title}>
          {yTickValues.map((v) => {
            const y = yAt(v);
            return (
              <g key={v}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 6}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-zinc-500 dark:fill-zinc-400"
                  fontSize={13}
                  fontFamily="var(--font-geist-sans), Inter, system-ui, sans-serif"
                  fontWeight={600}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatAxis(v)}
                </text>
              </g>
            );
          })}

          {dates.map((d, i) =>
            i % labelEvery === 0 ? (
              <text
                key={d}
                x={xAt(i)}
                y={H - PAD_B + 22}
                textAnchor="middle"
                fontSize={12}
                className="fill-zinc-500 dark:fill-zinc-400"
                fontFamily="var(--font-geist-sans), Inter, system-ui, sans-serif"
                fontWeight={600}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {d.slice(5)}
              </text>
            ) : null,
          )}

          {series.map((s) => {
            const segs: string[] = [];
            let started = false;
            s.points.forEach((v, i) => {
              if (v == null) {
                started = false;
                return;
              }
              segs.push(`${started ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
              started = true;
            });
            return (
              <g key={s.label}>
                <path d={segs.join(" ")} fill="none" stroke={s.color} strokeWidth={2} />
                {s.points.map((v, i) =>
                  v == null ? null : (
                    <circle key={i} cx={xAt(i)} cy={yAt(v)} r={3} fill={s.color}>
                      <title>
                        {s.label} · {dates[i]}: {v.toFixed(1)} tok/s
                      </title>
                    </circle>
                  ),
                )}
              </g>
            );
          })}

          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + plotH}
            y2={PAD_T + plotH}
            stroke="currentColor"
            className="text-zinc-300 dark:text-zinc-700"
            strokeWidth={1}
          />
        </svg>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: s.color }} />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  let nm: number;
  if (m <= 1) nm = 1;
  else if (m <= 2) nm = 2;
  else if (m <= 2.5) nm = 2.5;
  else if (m <= 5) nm = 5;
  else nm = 10;
  return nm * base;
}

function formatAxis(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
