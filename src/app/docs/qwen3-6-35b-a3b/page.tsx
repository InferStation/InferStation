import Link from "next/link";
import { CopyBlock } from "@/components/CopyBlock";

interface QuantInfo {
  name: string;
  bytes: number;
  family: "UD" | "Standard" | "MXFP4";
  note?: string;
}

const QUANTS: QuantInfo[] = [
  { name: "UD-IQ1_M",     bytes: 10047749088, family: "UD", note: "smallest" },
  { name: "UD-IQ2_XXS",   bytes: 10756586464, family: "UD" },
  { name: "UD-IQ2_M",     bytes: 11522702304, family: "UD" },
  { name: "UD-Q2_K_XL",   bytes: 12290628576, family: "UD" },
  { name: "UD-IQ3_XXS",   bytes: 13211155424, family: "UD" },
  { name: "UD-IQ3_S",     bytes: 13676723168, family: "UD" },
  { name: "UD-Q3_K_S",    bytes: 15359196128, family: "UD" },
  { name: "UD-Q3_K_M",    bytes: 16600710112, family: "UD" },
  { name: "UD-Q3_K_XL",   bytes: 16845511648, family: "UD" },
  { name: "UD-IQ4_XS",    bytes: 17730509792, family: "UD" },
  { name: "UD-IQ4_NL",    bytes: 18040888288, family: "UD" },
  { name: "UD-IQ4_NL_XL", bytes: 19500506080, family: "UD" },
  { name: "UD-Q4_K_S",    bytes: 20893015008, family: "UD" },
  { name: "MXFP4_MOE",    bytes: 21706144736, family: "MXFP4", note: "needs recent llama.cpp" },
  { name: "UD-Q4_K_M",    bytes: 22134528992, family: "UD", note: "sweet spot" },
  { name: "UD-Q4_K_XL",   bytes: 22360456160, family: "UD" },
  { name: "UD-Q5_K_S",    bytes: 24942050272, family: "UD" },
  { name: "UD-Q5_K_M",    bytes: 26456194016, family: "UD" },
  { name: "UD-Q5_K_XL",   bytes: 26592508896, family: "UD" },
  { name: "UD-Q6_K",      bytes: 29308320736, family: "UD" },
  { name: "UD-Q6_K_XL",   bytes: 31843777504, family: "UD" },
  { name: "Q8_0",         bytes: 36903140320, family: "Standard" },
  { name: "UD-Q8_K_XL",   bytes: 38451182560, family: "UD", note: "highest fidelity GGUF" },
];

function gb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

const SECTIONS: { id: string; label: string }[] = [
  { id: "overview",     label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "weights",      label: "Weights" },
  { id: "hosts",        label: "Hosts" },
  { id: "engines",      label: "Engines" },
  { id: "reproduce",    label: "How to reproduce" },
  { id: "metrics",      label: "Metrics" },
  { id: "caveats",      label: "Caveats" },
  { id: "sources",      label: "Sources" },
];

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "emerald" | "amber" | "violet" }) {
  const map = {
    default: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber:   "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    violet:  "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-4 text-xs uppercase tracking-widest text-zinc-500">{label}</h2>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}>
      {children}
    </div>
  );
}




export default function Qwen3635BA3BDoc() {
  return (
    <div className="py-10 sm:py-14">
      {/* breadcrumb */}
      <nav className="mb-6 text-xs text-zinc-500">
        <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">Docs</Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Qwen3.6-35B-A3B</span>
      </nav>

      {/* HERO */}
      <header className="flex flex-col gap-5 border-b border-zinc-200 pb-10 dark:border-zinc-800">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Model · MoE · Alibaba Qwen</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Qwen3.6-35B-A3B</h1>
        <p className="max-w-3xl text-base text-zinc-600 dark:text-zinc-400">
          A Mixture-of-Experts model from the Qwen3.6 family with hybrid linear / full attention,
          multimodal vision input, multi-token prediction (MTP=1), and a 256K context window.
          Roughly 35B total parameters and ~3B activated per token.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="violet">MoE 256E · 8 active</Badge>
          <Badge>40 layers · hybrid attn</Badge>
          <Badge>256K context</Badge>
          <Badge tone="emerald">BF16 native</Badge>
          <Badge tone="amber">Vision · MTP=1</Badge>
        </div>
        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          <a
            href="https://huggingface.co/unsloth/Qwen3.6-35B-A3B"
            target="_blank" rel="noreferrer"
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            BF16 weights →
          </a>
          <a
            href="https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF"
            target="_blank" rel="noreferrer"
            className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            GGUF quants →
          </a>
          <Link
            href="/charts"
            className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            See in /charts →
          </Link>
        </div>
      </header>

      {/* AT-A-GLANCE STATS */}
      <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total / Active params", value: "35B / ~3B" },
          { label: "Experts (total / active)", value: "256 / 8" },
          { label: "Context window", value: "262 144" },
          { label: "Quants benched", value: `${QUANTS.length + 1}` },
        ].map((s) => (
          <Card key={s.label}>
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
          </Card>
        ))}
      </section>


      {/* MAIN GRID */}
      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_180px]">
        <main className="flex flex-col gap-12 min-w-0">
          {/* OVERVIEW */}
          <Section id="overview" label="Overview">
            <Card>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Family", "Qwen3.6 (Alibaba Qwen)"],
                  ["Architecture", "MoE · hybrid linear+full attention"],
                  ["Multimodal", "Text + vision (Qwen3.5-MoE vision encoder)"],
                  ["License", "See model card on Hugging Face"],
                  ["Repo (BF16)", "unsloth/Qwen3.6-35B-A3B"],
                  ["Repo (GGUF)", "unsloth/Qwen3.6-35B-A3B-GGUF"],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
                    <dd className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">{v}</dd>
                  </div>
                ))}
              </div>
            </Card>
          </Section>

          {/* ARCHITECTURE */}
          <Section id="architecture" label="Architecture (from config.json)">
            <Card>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                {[
                  ["model_type", "qwen3_5_moe"],
                  ["hidden_size", "2048"],
                  ["num_hidden_layers", "40"],
                  ["attn_output_gate", "true"],
                  ["num_attention_heads", "16"],
                  ["num_key_value_heads", "2"],
                  ["head_dim", "256"],
                  ["partial_rotary_factor", "0.25"],
                  ["rope_theta", "10 000 000"],
                  ["num_experts", "256"],
                  ["num_experts_per_tok", "8"],
                  ["moe_intermediate_size", "512"],
                  ["shared_expert_intermediate", "512"],
                  ["mtp_num_hidden_layers", "1"],
                  ["max_position_embeddings", "262 144"],
                  ["vocab_size", "248 320"],
                  ["full_attention_interval", "4 (3 linear → 1 full)"],
                  ["torch_dtype", "bfloat16"],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
                    <dd className="font-mono text-[13px] tabular-nums text-zinc-800 dark:text-zinc-200">{v}</dd>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs text-zinc-500">
                Hybrid attention pattern: the 40 layers are arranged as <span className="font-mono">[linear, linear, linear, full] × 10</span> —
                30 linear-attention layers (Mamba-style SSM with conv kernel dim 4, 16 K / 32 V heads, head_dim 128) interleaved with 10 full-attention layers.
                Vision tower: 27-layer ViT, hidden 1152, patch 16, projected to 2048.
              </p>
            </Card>
          </Section>

          {/* WEIGHTS */}
          <Section id="weights" label="Weights under test">
            <div className="flex flex-col gap-4">
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">BF16 safetensors</div>
                    <div className="mt-1 font-mono text-sm">unsloth/Qwen3.6-35B-A3B</div>
                  </div>
                  <div className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">~70 GB · 2 shards</div>
                </div>
                <p className="mt-2 text-xs text-zinc-500">Used by vLLM. Two-shard BF16 snapshot of the original release.</p>
              </Card>

              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">GGUF quants · unsloth/Qwen3.6-35B-A3B-GGUF</div>
                  <div className="text-[11px] text-zinc-500">{QUANTS.length} files · sorted by size</div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {QUANTS.map((q) => (
                    <div
                      key={q.name}
                      className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[13px]">{q.name}</div>
                        {q.note ? (
                          <div className="text-[10px] text-zinc-500">{q.note}</div>
                        ) : null}
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <div className="font-mono text-[12.5px] tabular-nums text-zinc-700 dark:text-zinc-300">{gb(q.bytes)} GB</div>
                        <div className="text-[10px] text-zinc-500">
                          {q.family === "UD" ? "unsloth-dynamic" : q.family === "MXFP4" ? "MS FP4" : "standard"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* HOSTS */}
          <Section id="hosts" label="Hosts in the lab">
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-semibold">dgx-spark-01 — NVIDIA DGX Spark</div>
                <Badge tone="emerald">GB10 · 128 GB unified</Badge>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Chip", "NVIDIA GB10 (Grace + Blackwell)"],
                  ["Memory", "128 GB unified LPDDR5X"],
                  ["OS", "Ubuntu 24.04 LTS, kernel 6.x"],
                  ["Driver", "DGX Spark bundled NVIDIA Open driver"],
                  ["CUDA (container)", "13.2 — nvcr.io/nvidia/cuda:13.2.0-cudnn-devel-ubuntu24.04"],
                  ["Vulkan ICD", "NVK / nv-vulkan-icd from driver"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
                    <dd className="font-mono text-[13px]">{v}</dd>
                  </div>
                ))}
              </div>
            </Card>
          </Section>

          {/* ENGINES */}
          <Section id="engines" label="Engines">
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    <th className="px-4 py-2.5">Engine</th>
                    <th className="px-4 py-2.5">Backend</th>
                    <th className="px-4 py-2.5">Image</th>
                    <th className="px-4 py-2.5">Version</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  <tr>
                    <td className="px-4 py-2.5">llama.cpp</td>
                    <td className="px-4 py-2.5"><Badge tone="emerald">CUDA</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px]">inferstation/llamacpp-cuda:master</td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-zinc-500">commit recorded per-run</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5">llama.cpp</td>
                    <td className="px-4 py-2.5"><Badge>Vulkan</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px]">inferstation/llamacpp-vulkan:master</td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-zinc-500">commit recorded per-run</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5">vLLM</td>
                    <td className="px-4 py-2.5"><Badge tone="emerald">CUDA</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px]">nvcr.io/nvidia/vllm:26.03-py3</td>
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-zinc-500">vLLM 0.17.1+a03ca76a.nv26.03</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </Section>

          {/* REPRODUCE */}
          <Section id="reproduce" label="How to reproduce">
            <div className="flex flex-col gap-4">
              <CopyBlock
                title="llama.cpp · CUDA"
                code={`docker run --rm --gpus all \\
  -v /home/bench/models/Qwen3.6-35B-A3B:/models:ro \\
  inferstation/llamacpp-cuda:master \\
  llama-batched-bench \\
    -m /models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\
    --output-format jsonl`}
              />
              <CopyBlock
                title="llama.cpp · Vulkan"
                code={`docker run --rm --device=/dev/dri --group-add video \\
  -v /home/bench/models/Qwen3.6-35B-A3B:/models:ro \\
  inferstation/llamacpp-vulkan:master \\
  llama-batched-bench \\
    -m /models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\
    --output-format jsonl`}
              />
              <CopyBlock
                title="vLLM · BF16 safetensors"
                code={`docker run --rm --gpus all --ipc=host \\
  -v /home/bench/models/Qwen3.6-35B-A3B-BF16:/model:ro \\
  nvcr.io/nvidia/vllm:26.03-py3 \\
  vllm bench throughput \\
    --model /model --dtype bfloat16 \\
    --max-model-len 2048 --max-num-seqs 32 \\
    --gpu-memory-utilization 0.85 \\
    --dataset-name random --input-len 512 --output-len 128 \\
    --num-prompts 1024`}
              />
              <p className="text-xs text-zinc-500">
                Every run on <Link className="underline underline-offset-2" href="/charts">/charts</Link> links back to a raw JSON
                record that captures the full command line, engine commit, and host snapshot.
              </p>
            </div>
          </Section>

          {/* METRICS */}
          <Section id="metrics" label="Metrics">
            <Card>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="font-mono text-[12px] uppercase tracking-wide text-zinc-500">pp tok/s</dt>
                  <dd className="mt-1">Aggregate input-token throughput across concurrent streams. For vLLM derived as <span className="font-mono">num_prompts · input_len / elapsed</span>.</dd>
                </div>
                <div>
                  <dt className="font-mono text-[12px] uppercase tracking-wide text-zinc-500">tg tok/s</dt>
                  <dd className="mt-1">Aggregate output-token throughput across concurrent streams. For vLLM derived as <span className="font-mono">num_prompts · output_len / elapsed</span>.</dd>
                </div>
                <div>
                  <dt className="font-mono text-[12px] uppercase tracking-wide text-zinc-500">combined</dt>
                  <dd className="mt-1">Engine&apos;s end-to-end throughput where available (vLLM <span className="font-mono">tokens_per_second</span>, llama-batched-bench <span className="font-mono">speed</span>), else <span className="font-mono">pp + tg</span>.</dd>
                </div>
              </dl>
            </Card>
          </Section>

          {/* CAVEATS */}
          <Section id="caveats" label="Caveats">
            <Card>
              <ul className="flex flex-col gap-3 text-sm">
                <li>
                  Active params are only ~3B; throughput is bandwidth-bound and very sensitive to quant tier.
                  Decode at <span className="font-mono">bs=1</span> is dominated by weight-load latency;{" "}
                  <span className="font-mono">bs=32</span> exposes batched GEMM efficiency.
                </li>
                <li>
                  <span className="font-mono">MXFP4_MOE</span> requires a recent llama.cpp build with the MXFP4 weight type compiled in.
                  Older Vulkan drivers may fall back to slower kernels — the recorded commit hash is the source of truth.
                </li>
                <li>
                  vLLM <span className="font-mono">--max-model-len</span> is sized at <span className="font-mono">(pp + tg) · 2 + 1024</span> because
                  the <span className="font-mono">random</span> dataset emits prompts that occasionally exceed the nominal input length.
                </li>
              </ul>
            </Card>
          </Section>

          {/* SOURCES */}
          <Section id="sources" label="Sources">
            <Card>
              <ul className="flex flex-col gap-2 text-sm">
                <li>
                  Bench driver:{" "}
                  <a className="underline underline-offset-2" target="_blank" rel="noreferrer"
                     href="https://github.com/JoursBleu/InferStation/blob/main/scripts/bench-batch.py">
                    scripts/bench-batch.py
                  </a>
                </li>
                <li>
                  Registry (one entry per quant × concurrency × backend):{" "}
                  <a className="underline underline-offset-2" target="_blank" rel="noreferrer"
                     href="https://github.com/JoursBleu/InferStation/blob/main/bench/registry.yaml">
                    bench/registry.yaml
                  </a>
                </li>
                <li>
                  Raw run records:{" "}
                  <a className="underline underline-offset-2" target="_blank" rel="noreferrer"
                     href="https://github.com/JoursBleu/InferStation/tree/main/data/runs">
                    data/runs/
                  </a>
                </li>
              </ul>
            </Card>
          </Section>
        </main>

        {/* STICKY RIGHT-SIDE TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <div className="mb-3 text-[11px] uppercase tracking-widest text-zinc-500">On this page</div>
            <ul className="flex flex-col gap-1.5 border-l border-zinc-200 dark:border-zinc-800">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block border-l-2 border-transparent pl-3 text-[12.5px] text-zinc-600 hover:border-zinc-900 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
                    style={{ marginLeft: "-1px" }}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
