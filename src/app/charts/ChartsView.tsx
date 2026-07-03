"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { canonicalModelName, canonicalModelSlug } from "@/lib/modelCanonical";

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
  scheme?: string;
  concurrency: number | null;
  pp_toks_per_s: number | null;
  tg_toks_per_s: number | null;
  combined_toks_per_s: number | null;
  engine: string;
}

type Metric = "tg_toks_per_s" | "pp_toks_per_s" | "combined_toks_per_s";

const METRICS: { key: Metric; label: string; sub: string }[] = [
  { key: "tg_toks_per_s",       label: "Generation (tg)", sub: "decode tokens/s, summed across concurrent streams" },
  { key: "pp_toks_per_s",       label: "Prefill (pp)",    sub: "prefill tokens/s" },
  { key: "combined_toks_per_s", label: "Combined",        sub: "(pp + tg) effective tokens/s" },
];

// Brand colors. Match by lowercase vendor substring.
const VENDOR_COLORS: { match: string; color: string }[] = [
  { match: "nvidia", color: "#76B900" }, // NVIDIA green
  { match: "amd",    color: "#ED1C24" }, // AMD red
  { match: "intel",  color: "#0071C5" }, // Intel blue
  { match: "apple",  color: "#A2AAAD" }, // Apple silver
];
const FALLBACK_COLORS = [
  "#2563eb", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#16a34a", "#dc2626",
];

function vendorColor(vendor: string, fallbackIdx: number): string {
  const v = (vendor || "").toLowerCase();
  for (const e of VENDOR_COLORS) if (v.includes(e.match)) return e.color;
  return FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
}

// Per-device base color. Two boxes from the SAME vendor (DGX Spark + RTX 4090,
// or Strix Halo + R9700) must not collide on the vendor brand color, so each
// known device gets its own hue; unknown hosts fall back to the vendor color.
const DEVICE_COLORS: { match: RegExp; color: string }[] = [
  { match: /dgx|spark/i, color: "#76B900" }, // DGX Spark - NVIDIA green
  { match: /4090|rtx/i, color: "#0891b2" }, // RTX 4090 - cyan
  { match: /halo|ryzen|strix/i, color: "#ED1C24" }, // Strix Halo - AMD red
  { match: /r9700|radeon/i, color: "#d97706" }, // Radeon R9700 - amber
];
function deviceColor(hostSlug: string, hostName: string, vendor: string, fallbackIdx: number): string {
  const s = `${hostSlug} ${hostName}`;
  for (const e of DEVICE_COLORS) if (e.match.test(s)) return e.color;
  return vendorColor(vendor, fallbackIdx);
}

// Same vendor, different backend: keep brand hue, shift the others so the
// bars are visually distinguishable on a per-host group.
function backendShade(baseHex: string, backend: string): string {
  const b = (backend || "").toLowerCase();
  if (b === "vulkan") return lighten(baseHex, 0.35);
  if (b === "vllm") return baseHex;
  if (b === "rocm" || b === "hip") return lighten(baseHex, 0.0);
  return baseHex;
}

function vllmBackendLabel(raw: string): string {
  const b = (raw || "").toLowerCase();
  // vLLM's "default" path is also TRITON_ATTN (quantized units pass
  // --attention-backend TRITON_ATTN without an attn suffix); only flash differs.
  if (b.includes("flash_attn") || b.includes("flash")) return "FLASH_ATTN";
  return "TRITON_ATTN";
}

function displayBackend(r: ChartRun): string {
  if ((r.engine || "").toLowerCase().includes("vllm")) {
    return vllmBackendLabel(r.engine_backend);
  }
  return r.engine_backend;
}

function lighten(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${((1 << 24) | (lr << 16) | (lg << 8) | lb).toString(16).slice(1)}`;
}

function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const dr = Math.round(r * (1 - amount));
  const dg = Math.round(g * (1 - amount));
  const db = Math.round(b * (1 - amount));
  return `#${((1 << 24) | (dr << 16) | (dg << 8) | db).toString(16).slice(1)}`;
}

const QUANT_ORDER = ["BF16", "Q8_0", "FP8", "FP8-block", "Quark-W8A8-INT8", "AWQ-4bit", "UD-Q4_K_M", "Q4_K_M", "Q4_K_S", "UD-Q3_K_M", "UD-Q2_K_XL", "UD-IQ2_M"];

// schemeOf() maps a quant label to a weight/activation precision scheme. It is
// now only a FALLBACK: chart grouping prefers each run's DECLARED `scheme`
// field (tags.scheme, set at the unit level from the model's quantization_config)
// because loose labels like "AWQ" / "AWQ-LLM" don't reliably imply W4A16.
function quantRank(q: string): number {
  const i = QUANT_ORDER.indexOf(q);
  return i >= 0 ? i : QUANT_ORDER.length + 1;
}

// Normalize a quant into a weight/activation precision scheme for the chart
// title (W16A16, W8A8, W6A8, W5A8, W4A8, W4A16, W3A8, W2A8 ...).
//
// Weight bits = the quant's stored weight width (Q6_K->6, Q5_K->5, Q4_K->4,
// Q3_K->3, Q2_K->2, Q8_0/FP8/INT8->8, AWQ-4bit->4, IQ4->4, IQ2->2, IQ1->1).
//
// Activation bits depend on the ENGINE's actual compute path (verified against
// llama.cpp commit 6effcec ggml-cuda mmq/mmvq + ggml-vulkan):
//   • llama.cpp GGUF: every K/legacy/IQ quant uses a Q8_1/Q8_K int8 dynamic
//     dot-product on CUDA (Spark, turing_mma), HIP (Halo gfx1151, amd_wmma)
//     and Vulkan (dotPacked4x8EXT) -> activations are int8 -> WxA8.
//   • vLLM AWQ (awq_marlin) dequantizes int4 weights to fp16, activations stay
//     fp16 -> W4A16. vLLM FP8 / Quark-W8A8-INT8 quantize activations too -> W8A8.
function schemeOf(q: string, engine: string): string {
  const u = (q || "").toUpperCase();
  if (u === "BF16" || u === "F16" || u.includes("FP16")) return "W16A16";
  // Unquantized / native-dtype runs (served without a quant arg) are full precision.
  if (u === "" || u === "?" || u === "DEFAULT" || u === "NONE" || u === "UNQUANTIZED" || u === "AUTO")
    return "W16A16";
  // Quant already given as an explicit WxAy scheme (compressed-tensors style,
  // e.g. "W4A16"): trust it verbatim so it groups with same-scheme quants
  // instead of falling through to its own raw-string chart.
  const sm = /^W(\d+)A(\d+)$/.exec(u);
  if (sm) return `W${sm[1]}A${sm[2]}`;
  const isLlama = (engine || "").toLowerCase().includes("llama");

  // Weight bit width from the quant name.
  let w: number;
  if (u.includes("FP8") || u.includes("W8A8") || (u.includes("INT8") && !u.includes("INT8E")) ||
      u.includes("Q8")) w = 8;
  else if (/Q6|IQ6/.test(u)) w = 6;
  else if (/Q5|IQ5/.test(u)) w = 5;
  else if (u.includes("AWQ") || u.includes("MXFP4") || u.includes("NVFP4") || /Q4|IQ4/.test(u)) w = 4;
  else if (/Q3|IQ3/.test(u)) w = 3;
  else if (/Q2|IQ2/.test(u)) w = 2;
  else if (u.includes("IQ1") || /Q1/.test(u)) w = 1;
  else return q;

  // Activation bit width from the engine's compute path.
  let a: number;
  if (isLlama) a = 8; // GGUF int8 (Q8_1/Q8_K) dot-product activations
  else if (u.includes("FP8") || u.includes("W8A8") || u.includes("INT8")) a = 8; // vLLM real W8A8
  else a = 16; // vLLM weight-only (AWQ) keeps fp16 activations
  return `W${w}A${a}`;
}

interface ModelGroup {
  slug: string;
  name: string;
  params_b: number;
  runs: ChartRun[];
}

interface EngineGroup {
  engine: string;
  label: string;
  models: ModelGroup[];
}

const ENGINE_ORDER = ["vllm", "llama.cpp"];
const ENGINE_LABEL: Record<string, string> = {
  vllm: "vLLM",
  "llama.cpp": "llama.cpp",
};

// 模型侧边栏按 release 从新到旧排列。数组越靠前 = 越新；同系列内旗舰/大参数在前。
// 未列出的型号排到最后（按名字字母序兜底）。
const MODEL_RELEASE_ORDER = [
  // MiMo-V2.5（最新, 2026-04-27）
  "mimo-v2.5",
  // Qwen3.6
  "qwen3.6-27b",
  "qwen3.6-35b-a3b",
  // Gemma-4
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
  // Step-3.5-Flash（2026-02-01）
  "step-3.5-flash",
  // Qwen3
  "qwen3-32b",
  "qwen3-30b-a3b",
  "qwen3-14b",
  "qwen3-8b",
  "qwen3-4b",
  // Llama（最旧）
  "llama-3.3-70b-instruct",
  "llama-3.1-8b-instruct",
];

function modelReleaseRank(slug: string): number {
  const i = MODEL_RELEASE_ORDER.indexOf((slug || "").toLowerCase());
  return i < 0 ? MODEL_RELEASE_ORDER.length : i;
}

export default function ChartsView({ runs, navRuns = runs, basePath = "/charts", selectedFramework }: { runs: ChartRun[]; navRuns?: ChartRun[]; basePath?: string; selectedFramework?: string }) {
  const engines = useMemo<EngineGroup[]>(() => {
    const byEngine = new Map<string, Map<string, ModelGroup>>();
    for (const r of navRuns) {
      const eng = (r.engine || "unknown").toLowerCase();
      const modelSlug = canonicalModelSlug(r.model_slug);
      let mm = byEngine.get(eng);
      if (!mm) {
        mm = new Map();
        byEngine.set(eng, mm);
      }
      let g = mm.get(modelSlug);
      if (!g) {
        g = { slug: modelSlug, name: canonicalModelName(r.model_name, r.model_slug), params_b: r.params_b, runs: [] };
        mm.set(modelSlug, g);
      }
      g.runs.push(r);
    }
    const groups: EngineGroup[] = [];
    for (const [engine, mm] of byEngine) {
      groups.push({
        engine,
        label: ENGINE_LABEL[engine] ?? engine,
        models: Array.from(mm.values()).sort((a, b) => {
          const ra = modelReleaseRank(a.slug);
          const rb = modelReleaseRank(b.slug);
          if (ra !== rb) return ra - rb; // release newest -> oldest
          return a.name.localeCompare(b.name); // 兜底：未登记型号按名字
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

  const firstKey = engines[0]
    ? `${engines[0].engine}::${engines[0].models[0]?.slug ?? ""}`
    : "";
  const [metric, setMetric] = useState<Metric>("tg_toks_per_s");
  const selected = useMemo<ModelGroup | undefined>(() => {
    const r = runs[0];
    if (!r) return undefined;
    return { slug: canonicalModelSlug(r.model_slug), name: canonicalModelName(r.model_name, r.model_slug), params_b: r.params_b, runs };
  }, [runs]);
  const selectedSlug = selected?.slug || firstKey.split("::")[1] || "";
  const activeFramework = (selectedFramework || "").toLowerCase();

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
                  const active = m.slug === selectedSlug && (!activeFramework || eg.engine === activeFramework);
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
        {selected ? (
          <ModelCharts group={selected} metric={metric} setMetric={setMetric} />
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
  const quantGroups = useMemo(() => {
    // Group runs into charts. For vLLM, the chart = a weight/activation precision
    // SCHEME (W4A16 / W8A8 / W16A16). The scheme comes from each run's DECLARED
    // `scheme` field (tags.scheme, baked in at the unit level from the model's
    // quantization_config) — NOT guessed from the quant label, since "AWQ" /
    // "AWQ-LLM" etc. don't reliably imply W4A16. Only runs with no declared
    // scheme fall back to the schemeOf() heuristic. llama.cpp keeps one chart
    // per raw GGUF quant.
    const engine = group.runs[0]?.engine || "";
    const isVllm = (engine || "").toLowerCase().includes("vllm");
    const groups = new Map<string, { key: string; scheme: string; quants: Set<string> }>();
    for (const r of group.runs) {
      const declared = (r.scheme || "").trim();
      const scheme = declared || schemeOf(r.quantization, r.engine);
      const gk = isVllm ? scheme : r.quantization;
      let g = groups.get(gk);
      if (!g) {
        g = { key: gk, scheme: isVllm ? scheme : schemeOf(r.quantization, r.engine), quants: new Set() };
        groups.set(gk, g);
      }
      g.quants.add(r.quantization);
    }
    const arr = Array.from(groups.values()).map((g) => {
      const qs = Array.from(g.quants).sort((a, b) => {
        const r = quantRank(a) - quantRank(b);
        return r !== 0 ? r : a.localeCompare(b);
      });
      // Per-device note: which specific quant each device runs. When every
      // device uses the same single quant we just show that quant name.
      const devQuant = new Map<string, Set<string>>();
      for (const r of group.runs) {
        if (!g.quants.has(r.quantization)) continue;
        let s = devQuant.get(r.host_name);
        if (!s) { s = new Set(); devQuant.set(r.host_name, s); }
        s.add(r.quantization);
      }
      const note =
        qs.length === 1
          ? qs[0]
          : Array.from(devQuant.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([host, set]) =>
                `${host}: ${Array.from(set)
                  .sort((a, b) => quantRank(a) - quantRank(b))
                  .join("/")}`,
              )
              .join("  \u00b7  ");
      return { key: g.key, quants: g.quants, label: g.scheme, note, sortQuant: qs[0] };
    });
    return arr.sort((a, b) => {
      const r = quantRank(a.sortQuant) - quantRank(b.sortQuant);
      return r !== 0 ? r : a.sortQuant.localeCompare(b.sortQuant);
    });
  }, [group]);

  const devices = useMemo(() => {
    // One series per (host, backend) pair so CUDA vs Vulkan on the same box
    // become two side-by-side bars.
    const map = new Map<
      string,
      {
        key: string;
        host_slug: string;
        backend: string;
        name: string;
        vendor: string;
        chip: string;
        color: string;
      }
    >();
    let idx = 0;
    for (const r of group.runs) {
      const backend = displayBackend(r);
      const key = `${r.host_slug}::${backend}`;
      if (!map.has(key)) {
        const base = deviceColor(r.host_slug, r.host_name, r.host_vendor, idx);
        const color = backendShade(base, backend);
        map.set(key, {
          key,
          host_slug: r.host_slug,
          backend,
          name: r.host_name,
          vendor: r.host_vendor,
          chip: r.host_chip,
          color,
        });
        idx++;
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name === b.name
        ? a.backend.localeCompare(b.backend)
        : a.name.localeCompare(b.name),
    );
  }, [group]);

  const allBs = useMemo(() => {
    const set = new Set<number>();
    for (const r of group.runs) if (r.concurrency != null) set.add(r.concurrency);
    return Array.from(set).sort((a, b) => a - b);
  }, [group]);

  function lookup(quants: Set<string>, deviceKey: string, bs: number): number | null {
    for (const r of group.runs) {
      const key = `${r.host_slug}::${displayBackend(r)}`;
      if (
        quants.has(r.quantization) &&
        key === deviceKey &&
        r.concurrency === bs
      ) {
        return r[metric] ?? null;
      }
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {group.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            One chart per quantization. Bars are colored by device; x-axis is
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

      <DeviceLegend devices={devices} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {quantGroups.map((qg) => (
          <BarChart
            key={qg.key}
            title={qg.label}
            note={qg.note}
            subtitle={METRICS.find((m) => m.key === metric)!.sub}
            xValues={allBs}
            xLabel={(bs) => `BS ${bs}`}
            seriesKeys={devices.map((d) => d.key)}
            seriesLabel={(k) => {
              const d = devices.find((d) => d.key === k);
              return d ? `${d.name} \u00b7 ${d.backend}` : k;
            }}
            seriesColor={(k) =>
              devices.find((d) => d.key === k)?.color ?? "#888"
            }
            lookup={(bs, k) => lookup(qg.quants, k, bs)}
          />
        ))}
      </div>
    </div>
  );
}

function DeviceLegend({
  devices,
}: {
  devices: { key: string; backend: string; name: string; vendor: string; chip: string; color: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
      <span className="font-medium uppercase tracking-wider text-zinc-500">Devices:</span>
      {devices.map((d) => (
        <span key={d.key} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: d.color }}
          />
          <span>
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{d.name}</span>{" "}
            <span className="text-zinc-500">· {d.backend}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

interface BarChartProps {
  title: string;
  note?: string;
  subtitle: string;
  xValues: number[];
  xLabel: (v: number) => string;
  seriesKeys: string[];
  seriesLabel: (k: string) => string;
  seriesColor: (k: string) => string;
  lookup: (x: number, seriesKey: string) => number | null;
}

function BarChart({
  title,
  note,
  subtitle,
  xValues,
  seriesKeys,
  seriesLabel,
  seriesColor,
  xLabel,
  lookup,
}: BarChartProps) {
  const W = 640;
  const H = 360;
  const PAD_L = 96;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 64;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  let max = 0;
  for (const x of xValues) {
    for (const s of seriesKeys) {
      const v = lookup(x, s);
      if (v != null && v > max) max = v;
    }
  }
  if (max <= 0) max = 1;
  const niceMax = niceCeil(max * 1.08);
  // Unify decimal precision across all numbers in this chart so axis
  // ticks and bar labels never mix 0.00 with 200.
  const decimals = 1;

  const groupW = plotW / Math.max(1, xValues.length);
  const innerPad = 10;
  const barGap = 3;
  const barsPerGroup = Math.max(1, seriesKeys.length);
  const barW = Math.max(
    3,
    (groupW - innerPad * 2 - barGap * (barsPerGroup - 1)) / barsPerGroup,
  );

  const ticks = 5;
  const yTickValues: number[] = [];
  for (let i = 0; i <= ticks; i++) yTickValues.push((niceMax * i) / ticks);

  return (
    <section className="flex h-full flex-col">
      <div className="mb-2 grid h-20 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 overflow-hidden">
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-semibold">{title}</h3>
          {note ? (
            <p
              className="mt-0.5 overflow-hidden text-xs leading-snug text-zinc-500"
              style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3 }}
            >
              {note}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-right text-xs leading-snug text-zinc-500">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" role="img" aria-label={title}>
          {yTickValues.map((v) => {
            const y = PAD_T + plotH - (v / niceMax) * plotH;
            return (
              <g key={v}>
                <line
                  x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 6} y={y}
                  textAnchor="end" dominantBaseline="middle"
                  className="fill-zinc-500 dark:fill-zinc-400"
                  fontSize={13}
                  fontFamily="var(--font-geist-sans), Inter, system-ui, sans-serif" fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatAxis(v)}
                </text>
              </g>
            );
          })}

          {xValues.map((x, xi) => {
            const gx = PAD_L + xi * groupW;
            const labelX = gx + groupW / 2;
            return (
              <g key={x}>
                {seriesKeys.map((s, si) => {
                  const v = lookup(x, s);
                  const bx = gx + innerPad + si * (barW + barGap);
                  const h = v == null ? 0 : (v / niceMax) * plotH;
                  const by = PAD_T + plotH - h;
                  const color = seriesColor(s);
                  return (
                    <g key={s}>
                      <rect x={bx} y={by} width={barW} height={h} fill={color} rx={2}>
                        <title>
                          {seriesLabel(s)} · {xLabel(x)}: {v == null ? "—" : v.toFixed(1)} tok/s
                        </title>
                      </rect>
                      {v != null ? (
                        <text
                          x={bx + barW / 2}
                          y={by - 6}
                          textAnchor="middle"
                          fontSize={11}
                          fontFamily="var(--font-geist-sans), Inter, system-ui, sans-serif" fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}
                          className="fill-zinc-500 dark:fill-zinc-400"
                        >
                          {formatNum(v, decimals)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                <text
                  x={labelX} y={H - PAD_B + 32}
                  textAnchor="middle" fontSize={14}
                  className="fill-zinc-500 dark:fill-zinc-400"
                  fontFamily="var(--font-geist-sans), Inter, system-ui, sans-serif" fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {xLabel(x)}
                </text>
              </g>
            );
          })}

          <line
            x1={PAD_L} x2={W - PAD_R}
            y1={PAD_T + plotH} y2={PAD_T + plotH}
            stroke="currentColor"
            className="text-zinc-300 dark:text-zinc-700"
            strokeWidth={1}
          />
        </svg>
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

function formatNum(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

function formatAxis(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
