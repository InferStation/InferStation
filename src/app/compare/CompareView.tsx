"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

export interface ChartRun {
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
  ttft_ms: number | null;
  tpot_ms: number | null;
  engine: string;
}

type Metric =
  | "tg_toks_per_s"
  | "pp_toks_per_s"
  | "combined_toks_per_s"
  | "ttft_ms"
  | "tpot_ms";

const METRICS: {
  key: Metric;
  label: string;
  sub: string;
  unit: string;
  lowerBetter: boolean;
}[] = [
  { key: "tg_toks_per_s",       label: "Decode",  sub: "decode throughput, tok/s (aggregate over streams)",  unit: "tok/s", lowerBetter: false },
  { key: "pp_toks_per_s",       label: "Prefill", sub: "prefill throughput, tok/s",                          unit: "tok/s", lowerBetter: false },
  { key: "combined_toks_per_s", label: "Total",   sub: "total (input + output) throughput, tok/s",           unit: "tok/s", lowerBetter: false },
  { key: "ttft_ms",             label: "TTFT",    sub: "time to first token, mean ms (lower is better)",     unit: "ms",    lowerBetter: true },
  { key: "tpot_ms",             label: "TPOT",    sub: "time per output token, mean ms (lower is better)",   unit: "ms",    lowerBetter: true },
];

// Distinct categorical palette for line series (the Cartesian product of the
// device / framework / precision filters). Cycled if there are more lines.
const LINE_PALETTE = [
  "#4e79a7", "#59a14f", "#9c755f", "#b07aa1", "#76b7b2",
  "#e1a14f", "#a0686f", "#6b8e9e", "#7b9e6f", "#8c8c8c",
];

// Precision ordering, roughly high → low bit-width, for the filter row.
const QUANT_ORDER = [
  "BF16", "F16",
  "UD-Q8_K_XL", "Q8_0", "FP8", "FP8-block", "Quark-W8A8-INT8",
  "UD-Q6_K_XL", "UD-Q6_K", "Q6_K",
  "UD-Q5_K_XL", "UD-Q5_K_M", "UD-Q5_K_S", "Q5_K_M", "Q5_K_S",
  "UD-Q4_K_XL", "UD-Q4_K_M", "UD-Q4_K_S", "Q4_K_M", "Q4_K_S", "Q4_1", "Q4_0", "AWQ-4bit",
  "UD-IQ4_NL_XL", "UD-IQ4_NL", "IQ4_NL", "UD-IQ4_XS", "IQ4_XS", "MXFP4_MOE",
  "UD-Q3_K_XL", "UD-Q3_K_M", "UD-Q3_K_S", "Q3_K_M", "Q3_K_S",
  "UD-IQ3_S", "UD-IQ3_XXS",
  "UD-Q2_K_XL", "Q2_K_L", "Q2_K", "UD-IQ2_M", "UD-IQ2_XXS",
  "UD-IQ1_M", "UD-IQ1_S",
];

// Normalize a run's host into a device *type*, merging same-model hosts (e.g.
// spark1/spark2, halo5/halo6) into a single type by stripping the trailing
// parenthetical and keying on vendor + base name.
//
// Display names use the platform/architecture codename where it is the more
// recognizable label (e.g. AMD "Ryzen AI Max+ 395" → "Strix Halo").
const DEVICE_LABEL_OVERRIDES: { match: RegExp; label: string }[] = [
  { match: /ryzen\s*ai\s*max\+?\s*395/i, label: "Strix Halo" },
];

function deviceType(r: ChartRun): { key: string; label: string; vendor: string } {
  const base = (r.host_name || "").replace(/\s*\(.*\)\s*$/, "").trim() || r.host_name;
  let label = base;
  for (const o of DEVICE_LABEL_OVERRIDES) {
    if (o.match.test(r.host_name || "") || o.match.test(r.host_chip || "")) {
      label = o.label;
      break;
    }
  }
  return { key: `${r.host_vendor}|${label}`, label, vendor: r.host_vendor };
}

// "llama.cpp · CUDA/ROCm" / "llama.cpp · Vulkan" / "vLLM · TRITON_ATTN".
// CUDA (NVIDIA) and ROCm/HIP (AMD) are the same engine's native GPU path and
// never coexist on one device type, so they collapse into ONE label/series;
// the vendor is encoded by line style (AMD solid / NVIDIA dashed) instead.
function vllmBackendLabel(raw: string): string {
  const b = (raw || "").toLowerCase();
  // vLLM's "default" path is also TRITON_ATTN (quantized units pass
  // --attention-backend TRITON_ATTN without an attn suffix); only flash differs.
  if (b.includes("flash_attn") || b.includes("flash")) return "FLASH_ATTN";
  return "TRITON_ATTN";
}

function frameworkLabel(r: ChartRun): string {
  const eng = r.engine || "";
  const bk = r.engine_backend || "";
  const bl = bk.toLowerCase();
  if (eng.toLowerCase().includes("vllm")) return `${eng} · ${vllmBackendLabel(bk)}`;
  if (bl === "cuda" || bl === "hip" || bl === "rocm/hip" || bl === "rocm")
    return `${eng} · CUDA/ROCm`;
  if (!bk || bl === eng.toLowerCase()) return eng || bk;
  return `${eng} · ${bk}`;
}

function quantRank(q: string): number {
  const i = QUANT_ORDER.indexOf(q);
  return i >= 0 ? i : QUANT_ORDER.length + 1;
}

// Collapse a specific dtype into a coarse precision bucket for the filter row.
// Lines still carry the specific dtype label; only the filter is simplified.
function precisionBucket(q: string): string {
  const u = (q || "").toUpperCase();
  if (u === "BF16" || u === "F16" || u.includes("FP16")) return "16-bit";
  if (u.includes("Q8") || u.includes("FP8") || u.includes("INT8") || u.includes("W8A8")) return "8-bit";
  return "4-bit";
}
const PRECISION_ORDER = ["16-bit", "8-bit", "4-bit"];
function precisionRank(p: string): number {
  const i = PRECISION_ORDER.indexOf(p);
  return i >= 0 ? i : PRECISION_ORDER.length + 1;
}

interface ModelGroup {
  slug: string;
  name: string;
  params_b: number;
  runs: ChartRun[];
}

// Sidebar order: base-model release date, newest first. Same-day releases keep
// the larger/flagship models first.
const MODEL_RELEASE_ORDER = [
  "mimo-v2.5",
  "qwen3.6-27b",
  "qwen3.6-35b-a3b",
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
  "step-3.5-flash",
  "qwen3-32b",
  "qwen3-30b-a3b",
  "qwen3-14b",
  "qwen3-8b",
  "qwen3-4b",
  "llama-3.3-70b-instruct",
  "llama-3.1-8b-instruct",
];

function modelReleaseRank(slug: string): number {
  const i = MODEL_RELEASE_ORDER.indexOf((slug || "").toLowerCase());
  return i < 0 ? MODEL_RELEASE_ORDER.length : i;
}

export default function CompareView({ runs, navRuns = runs, basePath = "/compare" }: { runs: ChartRun[]; navRuns?: ChartRun[]; basePath?: string }) {
  const models = useMemo<ModelGroup[]>(() => {
    const byModel = new Map<string, ModelGroup>();
    for (const r of navRuns) {
      let g = byModel.get(r.model_slug);
      if (!g) {
        g = { slug: r.model_slug, name: r.model_name, params_b: r.params_b, runs: [] };
        byModel.set(r.model_slug, g);
      }
      g.runs.push(r);
    }
    return Array.from(byModel.values()).sort((a, b) => {
      const ra = modelReleaseRank(a.slug);
      const rb = modelReleaseRank(b.slug);
      if (ra !== rb) return ra - rb;
      return b.params_b - a.params_b || a.name.localeCompare(b.name);
    });
  }, [navRuns]);

  const [metric, setMetric] = useState<Metric>("tg_toks_per_s");
  const selected = useMemo<ModelGroup | undefined>(() => {
    const r = runs[0];
    if (!r) return undefined;
    return { slug: r.model_slug, name: r.model_name, params_b: r.params_b, runs };
  }, [runs]);
  const selectedSlug = selected?.slug || models[0]?.slug || "";

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-6 py-10">
      <aside className="w-64 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Models
        </h2>
        <ul className="flex flex-col gap-1">
          {models.map((m) => {
            const key = m.slug;
            const active = key === selectedSlug;
            return (
              <li key={key}>
                <Link
                  href={`${basePath}/${m.slug}`}
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
      </aside>

      <main className="min-w-0 flex-1">
        {selected ? (
          <ModelCharts
            key={selected.slug}
            group={selected}
            metric={metric}
            setMetric={setMetric}
          />
        ) : (
          <p className="text-sm text-zinc-500">No data.</p>
        )}
      </main>
    </div>
  );
}

function ModelCharts({
  group,
  metric,
  setMetric,
}: {
  group: ModelGroup;
  metric: Metric;
  setMetric: (m: Metric) => void;
}) {
  // Available options for the three filter rows, scoped to this model.
  const deviceOpts = useMemo(() => {
    const map = new Map<string, { key: string; label: string; vendor: string }>();
    for (const r of group.runs) {
      const d = deviceType(r);
      if (!map.has(d.key)) {
        map.set(d.key, { key: d.key, label: d.label, vendor: d.vendor });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [group]);

  const fwOpts = useMemo(() => {
    const set = new Set<string>();
    for (const r of group.runs) set.add(frameworkLabel(r));
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => ({ key: k, label: k }));
  }, [group]);

  const quantOpts = useMemo(() => {
    const set = new Set<string>();
    for (const r of group.runs) set.add(r.quantization);
    return Array.from(set)
      .sort((a, b) => quantRank(a) - quantRank(b) || a.localeCompare(b))
      .map((k) => ({ key: k, label: k }));
  }, [group]);

  // Coarse precision buckets (16/8/4-bit) present in this model's data — used
  // for the simplified Precision filter row.
  const precisionOpts = useMemo(() => {
    const set = new Set<string>();
    for (const r of group.runs) set.add(precisionBucket(r.quantization));
    return Array.from(set)
      .sort((a, b) => precisionRank(a) - precisionRank(b))
      .map((k) => ({ key: k, label: k }));
  }, [group]);

  // Default precision bucket: the one with the most data points for this model.
  const defaultPrecision = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const r of group.runs) {
      const b = precisionBucket(r.quantization);
      cnt.set(b, (cnt.get(b) ?? 0) + 1);
    }
    let best = "";
    let bestN = -1;
    for (const { key } of precisionOpts) {
      const c = cnt.get(key) ?? 0;
      if (c > bestN || (c === bestN && precisionRank(key) < precisionRank(best))) {
        best = key;
        bestN = c;
      }
    }
    return best;
  }, [group, precisionOpts]);

  // Selections. The component is remounted per model (key=slug in the parent),
  // so these initialise fresh whenever a different model is opened.
  const [selDevices, setSelDevices] = useState<Set<string>>(
    () => new Set(deviceOpts.map((o) => o.key)),
  );
  const [selFws, setSelFws] = useState<Set<string>>(
    () => new Set(fwOpts.map((o) => o.key)),
  );
  const [selQuants, setSelQuants] = useState<Set<string>>(
    () => new Set(defaultPrecision ? [defaultPrecision] : []),
  );

  function toggle(
    set: Set<string>,
    setSet: (s: Set<string>) => void,
    key: string,
  ) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSet(next);
  }

  const xValues = useMemo(() => {
    const s = new Set<number>();
    for (const r of group.runs) if (r.concurrency != null) s.add(r.concurrency);
    return Array.from(s).sort((a, b) => a - b);
  }, [group]);

  // (deviceType, framework+backend, precision, batch) -> best metric value.
  // "Best" means max for throughput metrics, min for latency metrics (TTFT/TPOT).
  const lowerBetter = METRICS.find((m) => m.key === metric)!.lowerBetter;
  const valueMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of group.runs) {
      if (r.concurrency == null) continue;
      const v = r[metric];
      if (v == null) continue;
      const k = `${deviceType(r).key}@@${frameworkLabel(r)}@@${r.quantization}@@${r.concurrency}`;
      const prev = m.get(k);
      if (prev == null || (lowerBetter ? v < prev : v > prev)) m.set(k, v);
    }
    return m;
  }, [group, metric, lowerBetter]);

  // Visible lines = Cartesian product of the selected filters. Combos with no
  // data are dropped. Color encodes (framework × precision) so the AMD and
  // NVIDIA card of the same combo share a color; line style encodes the
  // vendor instead (AMD = solid, NVIDIA = dashed).
  const series = useMemo<LineSeries[]>(() => {
    const out: LineSeries[] = [];
    const colorByCombo = new Map<string, string>();
    let ci = 0;
    for (const d of deviceOpts) {
      if (!selDevices.has(d.key)) continue;
      const dashed = (d.vendor || "").toLowerCase().includes("nvidia");
      for (const f of fwOpts) {
        if (!selFws.has(f.key)) continue;
        for (const q of quantOpts) {
          if (!selQuants.has(precisionBucket(q.key))) continue;
          const points = xValues.map((x) => ({
            x,
            y: valueMap.get(`${d.key}@@${f.key}@@${q.key}@@${x}`) ?? null,
          }));
          if (points.every((p) => p.y == null)) continue;
          const comboKey = `${f.key}@@${q.key}`;
          let color = colorByCombo.get(comboKey);
          if (!color) {
            color = LINE_PALETTE[ci % LINE_PALETTE.length];
            colorByCombo.set(comboKey, color);
            ci++;
          }
          out.push({
            key: `${d.key}@@${f.key}@@${q.key}`,
            label: `${d.label} · ${f.label} · ${q.label}`,
            color,
            dashed,
            points,
          });
        }
      }
    }
    return out;
  }, [deviceOpts, fwOpts, quantOpts, selDevices, selFws, selQuants, xValues, valueMap]);

  const metricSub = METRICS.find((m) => m.key === metric)!.sub;
  const metricMeta = METRICS.find((m) => m.key === metric)!;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {group.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            One line per device-type × framework × precision; x-axis is
            concurrency (batch size).
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

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <FilterRow
          title="Device"
          options={deviceOpts}
          selected={selDevices}
          onToggle={(k) => toggle(selDevices, setSelDevices, k)}
        />
        <FilterRow
          title="Framework"
          options={fwOpts}
          selected={selFws}
          onToggle={(k) => toggle(selFws, setSelFws, k)}
        />
        <FilterRow
          title="Precision"
          options={precisionOpts}
          selected={selQuants}
          onToggle={(k) => toggle(selQuants, setSelQuants, k)}
        />
      </div>

      {series.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Select at least one tag in each row to draw lines.
        </p>
      ) : (
        <LineChart
          subtitle={metricSub}
          title={`${metricMeta.label} vs concurrency`}
          unit={metricMeta.unit}
          xValues={xValues}
          xLabel={(bs) => `BS ${bs}`}
          series={series}
          legend={
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-zinc-200 pb-2 text-xs text-zinc-500 dark:border-zinc-800">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="22" height="8" className="shrink-0">
                    <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  AMD (solid)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg width="22" height="8" className="shrink-0">
                    <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" />
                  </svg>
                  NVIDIA (dashed)
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {series.map((s) => (
                  <li key={s.key} className="inline-flex items-center gap-2">
                    <svg width="22" height="10" className="shrink-0">
                      <line
                        x1="1"
                        y1="5"
                        x2="21"
                        y2="5"
                        stroke={s.color}
                        strokeWidth="2.5"
                        strokeDasharray={s.dashed ? "5 3" : undefined}
                      />
                      <circle cx="11" cy="5" r="2.6" fill={s.color} />
                    </svg>
                    <span className="truncate text-zinc-700 dark:text-zinc-200">{s.label}</span>
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}
    </div>
  );
}

interface FilterOption {
  key: string;
  label: string;
  color?: string;
}

function FilterRow({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-semibold text-zinc-500">
        {title}
      </span>
      {options.map((o) => {
        const active = selected.has(o.key);
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onToggle(o.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
              active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {o.color ? (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: o.color }}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface LineSeries {
  key: string;
  label: string;
  color: string;
  dashed: boolean;
  points: { x: number; y: number | null }[];
}

function LineChart({
  subtitle,
  title,
  unit,
  xValues,
  xLabel,
  series,
  legend,
}: {
  subtitle: string;
  title: string;
  unit: string;
  xValues: number[];
  xLabel: (v: number) => string;
  series: LineSeries[];
  legend?: ReactNode;
}) {
  const W = 820;
  const H = 440;
  const PAD_L = 76;
  const PAD_R = 24;
  const PAD_T = 20;
  const PAD_B = 56;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  let max = 0;
  for (const s of series)
    for (const p of s.points) if (p.y != null && p.y > max) max = p.y;
  if (max <= 0) max = 1;
  const ticks = 5;
  const step = niceStep(max / ticks);
  const niceMax = step * ticks;

  const n = xValues.length;
  const xToIdx = new Map<number, number>();
  xValues.forEach((x, i) => xToIdx.set(x, i));
  const px = (i: number) =>
    n <= 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW;
  const py = (v: number) => PAD_T + plotH - (v / niceMax) * plotH;

  const yTickValues: number[] = [];
  for (let i = 0; i <= ticks; i++) yTickValues.push(step * i);

  function pathFor(s: LineSeries): string {
    let d = "";
    let pen = false;
    for (const p of s.points) {
      const i = xToIdx.get(p.x);
      if (p.y == null || i == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(p.y).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
      {legend ? <div className="mb-3 flex flex-col gap-2">{legend}</div> : null}
      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          className="block"
          role="img"
          aria-label={title.toLowerCase()}
        >
          {yTickValues.map((v) => {
            const y = py(v);
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
                  x={PAD_L - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-zinc-500 dark:fill-zinc-400"
                  fontSize={13}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatAxis(v)}
                </text>
              </g>
            );
          })}

          {xValues.map((x, i) => (
            <text
              key={x}
              x={px(i)}
              y={H - PAD_B + 24}
              textAnchor="middle"
              fontSize={13}
              className="fill-zinc-500 dark:fill-zinc-400"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {xLabel(x)}
            </text>
          ))}

          {series.map((s) => (
            <path
              key={s.key}
              d={pathFor(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {series.map((s) =>
            s.points.map((p) => {
              const i = xToIdx.get(p.x);
              if (p.y == null || i == null) return null;
              return (
                <circle
                  key={`${s.key}:${p.x}`}
                  cx={px(i)}
                  cy={py(p.y)}
                  r={3.2}
                  fill={s.color}
                >
                  <title>
                    {s.label} · {xLabel(p.x)}: {p.y.toFixed(1)} {unit}
                  </title>
                </circle>
              );
            }),
          )}

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
      </div>
    </section>
  );
}

function niceStep(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const m = v / base;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const s of steps) if (m <= s + 1e-9) return s * base;
  return 10 * base;
}

function formatAxis(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}
