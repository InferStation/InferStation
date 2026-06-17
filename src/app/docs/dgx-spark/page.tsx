import Link from "next/link";

const SPEC: [string, string][] = [
  ["Chip", "NVIDIA GB10 — Grace ARMv9 CPU + Blackwell GPU (SoC)"],
  ["GPU arch", "Blackwell · compute capability sm_121 (SM121)"],
  ["Memory", "128 GB unified LPDDR5X (CPU+GPU coherent)"],
  ["Form factor", "DGX Spark desktop / mini-PC (APU, unified memory)"],
  ["OS / kernel", "Ubuntu 24.04.3 LTS aarch64 · 6.11.0-1014-nvidia"],
  ["NVIDIA driver", "580.82.09 (DGX Spark Open driver)"],
];

// Official NVIDIA GB10 / DGX Spark spec sheet figures.
// Source: nvidia.com/en-us/products/workstations/dgx-spark (data sheet).
const WHITEPAPER: [string, string][] = [
  ["AI performance", "Up to 1 PFLOP (1000 TFLOP) FP4 — sparse"],
  ["GPU", "Blackwell GPU · 5th-gen Tensor Cores (FP4 support)"],
  ["CPU", "20-core NVIDIA Grace (10× Cortex-X925 + 10× Cortex-A725, ARMv9)"],
  ["Memory", "128 GB LPDDR5X coherent unified system memory"],
  ["Memory bandwidth", "273 GB/s"],
  ["Storage", "Up to 4 TB NVMe M.2 (self-encrypting)"],
  ["Networking", "ConnectX-7 Smart NIC · up to 200 GbE (RDMA)"],
  ["Power", "240 W (external PSU)"],
  ["MSRP", "$3,999 (NVIDIA Founders Edition)"],
];

const ENGINES: { name: string; backend: string; note: string }[] = [
  { name: "llama.cpp", backend: "CUDA", note: "-DGGML_CUDA=ON, sm_121. Built natively for aarch64 / GB10." },
  { name: "llama.cpp", backend: "Vulkan", note: "-DGGML_VULKAN=ON via nvidia_icd. Vendor-neutral baseline." },
  { name: "vLLM", backend: "CUDA", note: "vllm-cuda-spark image. Use --attention-backend TRITON_ATTN (prebuilt flash-attn PTX is incompatible with driver 580); official FP8 weights (SM121 has no INT8 W8A8 kernel)." },
];

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-t border-zinc-200 py-2 text-sm dark:border-zinc-800">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
      <dd className="font-mono text-[12.5px] text-zinc-700 dark:text-zinc-300">{v}</dd>
    </div>
  );
}

export default function DgxSparkDoc() {
  return (
    <div className="py-10 sm:py-14">
      <nav className="mb-6 text-xs text-zinc-500">
        <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">Docs</Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">DGX Spark</span>
      </nav>

      <header className="flex flex-col gap-3 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">NVIDIA · Device</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">DGX Spark</h1>
        <p className="max-w-3xl text-base text-zinc-600 dark:text-zinc-400">
          NVIDIA GB10 (Grace + Blackwell) unified-memory desktop. 128 GB of coherent LPDDR5X shared
          between CPU and GPU, so even BF16 weights up to ~120 GB fit without offload.
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
            href="https://www.nvidia.com/en-us/products/workstations/dgx-spark/"
            target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            NVIDIA DGX Spark data sheet ↗
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
        device against Strix Halo on{" "}
        <Link className="underline underline-offset-2" href="/charts">/charts</Link>.
      </section>
    </div>
  );
}
