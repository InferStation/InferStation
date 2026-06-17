import Link from "next/link";

const SPEC: [string, string][] = [
  ["Chip", "AMD Ryzen AI Max+ 395 — Radeon 8060S iGPU (gfx1151, RDNA 3.5)"],
  ["GPU arch", "RDNA 3.5 · gfx1151 (no INT8 matrix-core acceleration)"],
  ["Memory", "128 GB unified LPDDR5X (UMA; ~120 GB usable as GTT)"],
  ["Form factor", "Strix Halo desktop / mini-PC (APU, unified memory)"],
  ["OS / kernel", "Ubuntu 24.04.4 LTS x86_64 · 6.17.0-1020-oem"],
  ["ROCm", "7.12.0 (rocm/vllm image)"],
  ["HIP override", "HSA_OVERRIDE_GFX_VERSION=11.5.1"],
];

// Official AMD Ryzen AI Max+ 395 (Strix Halo) spec sheet figures.
// Source: amd.com Ryzen AI Max+ 395 product page.
const WHITEPAPER: [string, string][] = [
  ["GPU", "Radeon 8060S · 40 compute units (RDNA 3.5)"],
  ["CPU", "16-core / 32-thread Zen 5, up to 5.1 GHz boost"],
  ["NPU", "AMD XDNA 2 · up to 50 TOPS (INT8)"],
  ["Platform AI perf", "Up to 126 TOPS combined (GPU + NPU + CPU)"],
  ["Memory", "128 GB LPDDR5X-8000 · 256-bit unified (UMA)"],
  ["Memory bandwidth", "~256 GB/s (LPDDR5X-8000, 256-bit)"],
  ["Process", "TSMC N4P"],
  ["Default TDP", "45–120 W (configurable)"],
  ["MSRP", "$1,999 — Framework Desktop (395, 128 GB) whole unit"],
];

const ENGINES: { name: string; backend: string; note: string }[] = [
  { name: "llama.cpp", backend: "HIP/ROCm", note: "-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151. Native ROCm path." },
  { name: "llama.cpp", backend: "Vulkan", note: "-DGGML_VULKAN=ON via radeon_icd. Vendor-neutral baseline." },
  { name: "vLLM", backend: "ROCm/HIP", note: "vllm-rocm-halo image. Triton INT8 works here, so W8A8 (Quark) quants run on Halo (unlike Spark)." },
];

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-t border-zinc-200 py-2 text-sm dark:border-zinc-800">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
      <dd className="font-mono text-[12.5px] text-zinc-700 dark:text-zinc-300">{v}</dd>
    </div>
  );
}

export default function StrixHaloDoc() {
  return (
    <div className="py-10 sm:py-14">
      <nav className="mb-6 text-xs text-zinc-500">
        <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">Docs</Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Strix Halo</span>
      </nav>

      <header className="flex flex-col gap-3 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">AMD · Device</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Strix Halo</h1>
        <p className="max-w-3xl text-base text-zinc-600 dark:text-zinc-400">
          AMD Ryzen AI Max+ 395 with a Radeon 8060S iGPU (gfx1151, RDNA 3.5) and 128 GB unified
          LPDDR5X. Measured memory bandwidth ~237 GB/s.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Hardware &amp; stack</h2>
        <dl className="mt-2">
          {SPEC.map(([k, v]) => <Row key={k} k={k} v={v} />)}
        </dl>
      </section>

      <section className="mt-10">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Spec sheet</h2>
          <a
            href="https://www.amd.com/en/products/processors/laptop/ryzen/ai-max-300-series/amd-ryzen-ai-max-plus-395.html"
            target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            AMD Ryzen AI Max+ 395 specs ↗
          </a>
        </div>
        <dl className="mt-2">
          {WHITEPAPER.map(([k, v]) => <Row key={k} k={k} v={v} />)}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-zinc-500">Engines under test</h2>
        <div className="flex flex-col gap-3">
          {ENGINES.map((e) => (
            <div key={e.name + e.backend} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{e.name}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{e.backend}</span>
              </div>
              <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{e.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-zinc-200 pt-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        See per-model recipes under{" "}
        <Link className="underline underline-offset-2" href="/docs">Model Docs</Link>, or compare this
        device against DGX Spark on{" "}
        <Link className="underline underline-offset-2" href="/charts">/charts</Link>.
      </section>
    </div>
  );
}
