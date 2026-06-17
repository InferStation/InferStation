import Link from "next/link";

// Official spec-sheet figures used for the comparison charts.
// DGX Spark: nvidia.com/en-us/products/workstations/dgx-spark (data sheet)
// Strix Halo: amd.com Ryzen AI Max+ 395 product page; whole-unit price = Framework Desktop (128 GB)
interface Device {
  slug: string;
  name: string;
  vendor: string;
  color: string;
  priceUSD: number;
  priceLabel: string;
  memBW: number;         // GB/s
  memGB: number;         // unified memory GB
}

const DEVICES: Device[] = [
  {
    slug: "dgx-spark",
    name: "DGX Spark",
    vendor: "NVIDIA GB10",
    color: "#76B900", // NVIDIA green
    priceUSD: 3999,
    priceLabel: "$3,999",
    memBW: 273,
    memGB: 128,
  },
  {
    slug: "strix-halo",
    name: "Strix Halo",
    vendor: "AMD Ryzen AI Max+ 395",
    color: "#ED1C24", // AMD red
    priceUSD: 1999,
    priceLabel: "$1,999",
    memBW: 256,
    memGB: 128,
  },
];

// Per-precision peak GPU/tensor compute, by precision.
// DGX Spark (GB10 Blackwell 5th-gen Tensor Core): anchored on NVIDIA's official
//   "1 PFLOP FP4 (sparse)"; lower precisions follow Blackwell's 2x-per-step
//   tensor scaling (sparse figures; dense = half).
// Strix Halo (Radeon 8060S, 40 CU RDNA 3.5 @ ~2.9 GHz): GPU shader / WMMA peaks.
// "—" = no dedicated acceleration at that precision on this device.
interface PrecRow {
  prec: string;
  spark: number | null;   // TFLOPS (FP) or TOPS (INT), per unit
  sparkLabel: string;
  halo: number | null;
  haloLabel: string;
}

const PRECISIONS: PrecRow[] = [
  { prec: "FP4",  spark: 1000, sparkLabel: "1000 TOPS (sparse) · 500 dense", halo: null, haloLabel: "—" },
  { prec: "FP8",  spark: 500,  sparkLabel: "500 TFLOPS (sparse) · 250 dense", halo: null, haloLabel: "—" },
  { prec: "BF16/FP16", spark: 250, sparkLabel: "250 TFLOPS (sparse) · 125 dense", halo: 59, haloLabel: "~59 TFLOPS (WMMA)" },
  { prec: "INT8", spark: 500,  sparkLabel: "500 TOPS (sparse) · 250 dense", halo: 118, haloLabel: "~118 TOPS (WMMA)" },
  { prec: "FP32", spark: 31,   sparkLabel: "~31 TFLOPS (CUDA cores)", halo: 30, haloLabel: "~30 TFLOPS (shaders)" },
];

interface Metric {
  key: string;
  title: string;
  unit: string;
  value: (d: Device) => number;
  display: (d: Device) => string;
  note?: string;
}

const METRICS: Metric[] = [
  {
    key: "price",
    title: "Whole-unit price",
    unit: "USD",
    value: (d) => d.priceUSD,
    display: (d) => d.priceLabel,
    note: "lower is better",
  },
  {
    key: "bw",
    title: "Memory bandwidth",
    unit: "GB/s",
    value: (d) => d.memBW,
    display: (d) => `${d.memBW} GB/s`,
  },
  {
    key: "mem",
    title: "Unified memory",
    unit: "GB",
    value: (d) => d.memGB,
    display: (d) => `${d.memGB} GB`,
  },
];

function PrecisionChart() {
  // Bars are normalized PER PRECISION ROW (each row's larger value fills the
  // track) so both devices stay readable despite the FP4..FP32 range spanning
  // ~30 to 1000. A null value (no dedicated path) shows a dashed "—" stub.
  const W = 560;
  const groupH = 64;        // height per precision group (2 bars + label)
  const labelW = 96;        // left gutter for precision name
  const valW = 150;         // right gutter for the value label
  const barH = 16;
  const barGap = 6;
  const trackW = W - labelW - valW;
  const H = PRECISIONS.length * groupH + 8;
  const series: { key: "spark" | "halo"; label: (r: typeof PRECISIONS[number]) => string; val: (r: typeof PRECISIONS[number]) => number | null }[] = [
    { key: "spark", label: (r) => r.sparkLabel, val: (r) => r.spark },
    { key: "halo",  label: (r) => r.haloLabel,  val: (r) => r.halo },
  ];
  const colorOf = { spark: DEVICES[0].color, halo: DEVICES[1].color };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {DEVICES.map((d) => (
          <span key={d.slug} className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
            {d.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Peak AI compute by precision">
        {PRECISIONS.map((r, gi) => {
          const gy = gi * groupH + 6;
          const rowMax = Math.max(r.spark ?? 0, r.halo ?? 0) || 1;
          return (
            <g key={r.prec}>
              <text
                x={0} y={gy + (barH * 2 + barGap) / 2}
                dominantBaseline="middle"
                className="fill-zinc-900 dark:fill-zinc-100"
                fontSize={13} fontWeight={700}
                fontFamily="var(--font-geist-mono), ui-monospace, monospace"
              >
                {r.prec}
              </text>
              {series.map((s, si) => {
                const v = s.val(r);
                const by = gy + si * (barH + barGap);
                const w = v == null ? 0 : Math.max(2, (v / rowMax) * trackW);
                return (
                  <g key={s.key}>
                    {v == null ? (
                      <line
                        x1={labelW} x2={labelW + 14} y1={by + barH / 2} y2={by + barH / 2}
                        stroke={colorOf[s.key]} strokeWidth={2} strokeDasharray="3 2" opacity={0.5}
                      />
                    ) : (
                      <rect x={labelW} y={by} width={w} height={barH} rx={2} fill={colorOf[s.key]} />
                    )}
                    <text
                      x={labelW + trackW + 6} y={by + barH / 2}
                      dominantBaseline="middle"
                      className="fill-zinc-600 dark:fill-zinc-400"
                      fontSize={11}
                      fontFamily="var(--font-geist-mono), ui-monospace, monospace"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {s.label(r)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MetricChart({ metric }: { metric: Metric }) {
  const max = Math.max(...DEVICES.map(metric.value)) * 1.0 || 1;
  const W = 520;
  const rowH = 46;
  const labelW = 130;
  const valW = 120;
  const barMax = W - labelW - valW;
  const H = DEVICES.length * rowH + 8;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{metric.title}</h3>
        {metric.note ? <span className="text-[11px] text-zinc-500">{metric.note}</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={metric.title}>
        {DEVICES.map((d, i) => {
          const y = i * rowH + 4;
          const w = Math.max(2, (metric.value(d) / max) * barMax);
          return (
            <g key={d.slug}>
              <text
                x={0} y={y + rowH / 2}
                dominantBaseline="middle"
                className="fill-zinc-700 dark:fill-zinc-300"
                fontSize={13} fontWeight={600}
                fontFamily="var(--font-geist-sans), Inter, system-ui, sans-serif"
              >
                {d.name}
              </text>
              <rect
                x={labelW} y={y + 8} width={w} height={rowH - 22}
                fill={d.color} rx={3}
              />
              <text
                x={labelW + w + 8} y={y + rowH / 2}
                dominantBaseline="middle"
                className="fill-zinc-700 dark:fill-zinc-300"
                fontSize={13} fontWeight={600}
                fontFamily="var(--font-geist-mono), ui-monospace, monospace"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {metric.display(d)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function DevicesOverview() {
  return (
    <div className="py-10 sm:py-14">
      <nav className="mb-6 text-xs text-zinc-500">
        <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">Docs</Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Devices</span>
      </nav>

      <header className="flex flex-col gap-3 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Devices · Overview</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Test Devices</h1>
        <p className="max-w-3xl text-base text-zinc-600 dark:text-zinc-400">
          Two 128 GB unified-memory mini-PCs at opposite ends of the price/perf curve. Figures below
          are from each vendor&apos;s official spec sheet; the whole-unit price is NVIDIA&apos;s
          Founders Edition for DGX Spark and the Framework Desktop (Ryzen AI Max+ 395, 128 GB) for
          Strix Halo.
        </p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DEVICES.map((d) => (
          <Link
            key={d.slug}
            href={`/docs/${d.slug}`}
            className="group flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: d.color }} />
              <span className="text-[11px] uppercase tracking-widest text-zinc-500">{d.vendor}</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight group-hover:underline">{d.name}</h2>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <span><span className="font-mono text-zinc-900 dark:text-zinc-100">{d.priceLabel}</span> unit</span>
              <span><span className="font-mono text-zinc-900 dark:text-zinc-100">{d.memGB} GB</span> unified</span>
              <span><span className="font-mono text-zinc-900 dark:text-zinc-100">{d.memBW}</span> GB/s</span>
            </div>
          </Link>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-zinc-500">Price &amp; capacity</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {METRICS.map((m) => <MetricChart key={m.key} metric={m} />)}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-zinc-500">Peak AI compute by precision</h2>
        <PrecisionChart />
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          Bars are normalized per precision row. DGX Spark (GB10, Blackwell 5th-gen Tensor Core) is
          anchored on NVIDIA&apos;s official <span className="font-mono">1 PFLOP FP4 (sparse)</span>;
          lower precisions follow Blackwell&apos;s 2×-per-step tensor scaling (sparse shown, dense =
          half). Strix Halo (Radeon 8060S, 40 CU RDNA 3.5) shows GPU shader / WMMA peaks; it has no
          dedicated FP4/FP8 path, and the on-package XDNA 2 NPU adds a separate ~50 TOPS (INT8) not
          used by the llama.cpp / vLLM GPU backends here. Vendor peaks are not apples-to-apples —
          see <Link className="underline underline-offset-2" href="/charts">/charts</Link> for measured
          tokens/s on identical models.
        </p>
      </section>

      <section className="mt-10 border-t border-zinc-200 pt-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Per-device detail:{" "}
        <Link className="underline underline-offset-2" href="/docs/dgx-spark">DGX Spark</Link>
        {" · "}
        <Link className="underline underline-offset-2" href="/docs/strix-halo">Strix Halo</Link>.
      </section>
    </div>
  );
}
