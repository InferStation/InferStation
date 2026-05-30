import Link from "next/link";

interface ModelDoc {
  slug: string;
  name: string;
  vendor: string;
  arch: string;
  tagline: string;
  badges: { label: string; tone?: "default" | "emerald" | "amber" | "violet" }[];
  hosts: string[];
  engines: string[];
  quantCount: number;
}

const MODELS: ModelDoc[] = [
  {
    slug: "qwen3-6-35b-a3b",
    name: "Qwen3.6-35B-A3B",
    vendor: "Alibaba Qwen",
    arch: "MoE 256E · 8 active · hybrid linear+full attn · MTP=1 · vision",
    tagline:
      "35B-parameter MoE with ~3B active per token, 40 layers (30 linear / 10 full attn), 256K context, native BF16, vision encoder.",
    badges: [
      { label: "MoE 35B / 3B", tone: "violet" },
      { label: "256K ctx" },
      { label: "BF16 native", tone: "emerald" },
      { label: "vision · MTP=1", tone: "amber" },
    ],
    hosts: ["dgx-spark-01 (GB10, 128 GB unified)"],
    engines: ["llama.cpp CUDA", "llama.cpp Vulkan", "vLLM"],
    quantCount: 24,
  },
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

export default function DocsIndex() {
  return (
    <div className="py-12 sm:py-16">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-10 dark:border-zinc-800">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">Docs</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Model docs</h1>
        <p className="max-w-3xl text-base text-zinc-600 dark:text-zinc-400">
          For each model under test: exact weight repo and file list, host hardware and driver
          stack, engine images with pinned commits, the verbatim benchmark command lines, and a
          link to the raw run records. Every chart bar on{" "}
          <Link className="underline underline-offset-2" href="/charts">/charts</Link> is reproducible from one of these recipes.
        </p>
      </header>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Models</h2>
          <span className="text-[11px] text-zinc-500">{MODELS.length} model · more on the way</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {MODELS.map((m) => (
            <Link
              key={m.slug}
              href={`/docs/${m.slug}`}
              className="group flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
            >
              <div>
                <div className="text-[11px] uppercase tracking-widest text-zinc-500">{m.vendor}</div>
                <h3 className="mt-1 text-xl font-semibold tracking-tight group-hover:underline">{m.name}</h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{m.tagline}</p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {m.badges.map((b) => (
                  <Badge key={b.label} tone={b.tone}>{b.label}</Badge>
                ))}
              </div>

              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Architecture</dt>
                  <dd className="mt-0.5 font-mono text-[11.5px] text-zinc-700 dark:text-zinc-300">{m.arch}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Quants benched</dt>
                  <dd className="mt-0.5 font-mono text-[11.5px] tabular-nums text-zinc-700 dark:text-zinc-300">{m.quantCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Hosts</dt>
                  <dd className="mt-0.5 font-mono text-[11.5px] text-zinc-700 dark:text-zinc-300">
                    {m.hosts.join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Engines</dt>
                  <dd className="mt-0.5 font-mono text-[11.5px] text-zinc-700 dark:text-zinc-300">
                    {m.engines.join(" · ")}
                  </dd>
                </div>
              </dl>

              <div className="mt-1 inline-flex items-center text-xs font-medium text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                Read the doc →
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
