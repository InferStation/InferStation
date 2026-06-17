import Link from "next/link";
import type { ReactNode } from "react";
import { CopyBlock } from "@/components/CopyBlock";

export type Tone = "default" | "emerald" | "amber" | "violet";

export interface ModelDocProps {
  slug: string;
  name: string;
  vendor: string;
  kicker: string; // e.g. "Model · Dense · Meta"
  tagline: string;
  badges: { label: string; tone?: Tone }[];
  links: { label: string; href: string; primary?: boolean; external?: boolean }[];
  atGlance: { label: string; value: string }[];
  overview: [string, string][];
  weightsBF16?: { repo: string; note: string; size?: string };
  quants: { name: string; family: "UD" | "Standard" | "MXFP4"; note?: string; sizeGB?: string }[];
  ggufRepo?: string;
  hosts: ("spark" | "halo")[];
  engineRows: {
    engine: string;
    badge?: { label: string; tone?: Tone };
    host: "dgx-spark-01" | "ryzen-ai-max-395-03";
    imageHtml: ReactNode;
    versionHtml: ReactNode;
  }[];
  reproduce: { title: string; code: string }[];
  caveats: ReactNode[];
}

const SECTIONS: { id: string; label: string }[] = [
  { id: "overview",  label: "Overview" },
  { id: "weights",   label: "Weights" },
  { id: "hosts",     label: "Hardware" },
  { id: "engines",   label: "Engines" },
  { id: "reproduce", label: "How To Reproduce" },
  { id: "metrics",   label: "Metrics" },
  { id: "caveats",   label: "Caveats" },
  { id: "sources",   label: "Sources" },
];

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
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

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}>
      {children}
    </div>
  );
}

function Section({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-4 text-xs uppercase tracking-widest text-zinc-500">{label}</h2>
      {children}
    </section>
  );
}

const SPARK_INFO: [string, string][] = [
  ["Chip", "NVIDIA GB10 (Grace ARMv9 + Blackwell)"],
  ["Memory", "128 GB unified LPDDR5X"],
  ["OS / kernel", "Ubuntu 24.04.3 LTS aarch64 · 6.11.0-1014-nvidia"],
  ["NVIDIA driver", "580.82.09 (DGX Spark Open driver)"],
  ["Vulkan ICD", "/usr/share/vulkan/icd.d/nvidia_icd.json (set VK_DRIVER_FILES)"],
  ["SSH alias", "spark2"],
  ["Models dir", "/opt/inferstation/models  (bind-mounted as /models)"],
];

const HALO_INFO: [string, string][] = [
  ["Chip", "AMD Ryzen AI Max+ 395 · Radeon 8060S iGPU (gfx1151)"],
  ["Memory", "128 GB unified LPDDR5X"],
  ["OS / kernel", "Ubuntu 24.04.4 LTS x86_64 · 6.17.0-1020-oem"],
  ["ROCm", "7.12.0 (rocm/vllm image)"],
  ["HIP override", "HSA_OVERRIDE_GFX_VERSION=11.5.1"],
  ["SSH alias", "halo6"],
  ["Models dir", "/home/amd/models  (bind-mounted as /models)"],
];

export function ModelDocPage(p: ModelDocProps) {
  return (
    <div className="py-10 sm:py-14">
      <nav className="mb-6 text-xs text-zinc-500">
        <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">Docs</Link>
        <span className="mx-1.5">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">{p.name}</span>
      </nav>

      <header className="flex flex-col gap-5 border-b border-zinc-200 pb-10 dark:border-zinc-800">
        <p className="text-[11px] uppercase tracking-widest text-zinc-500">{p.kicker}</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{p.name}</h1>
        <p className="max-w-3xl text-base text-zinc-600 dark:text-zinc-400">{p.tagline}</p>
        <div className="flex flex-wrap gap-2">
          {p.badges.map((b) => <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}
        </div>
        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          {p.links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
              className={
                l.primary
                  ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  : "rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }
            >
              {l.label}
            </a>
          ))}
          <Link href="/charts" className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
            See in /charts
          </Link>
        </div>
      </header>

      <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {p.atGlance.map((s) => (
          <Card key={s.label}>
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
          </Card>
        ))}
      </section>

      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_180px]">
        <main className="flex flex-col gap-12 min-w-0">
          <Section id="overview" label="Overview">
            <Card>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                {p.overview.map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
                    <dd className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">{v}</dd>
                  </div>
                ))}
              </div>
            </Card>
          </Section>

          <Section id="weights" label="Weights Under Test">
            <div className="flex flex-col gap-4">
              {p.weightsBF16 ? (
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-zinc-500">BF16 safetensors</div>
                      <div className="mt-1 font-mono text-sm">{p.weightsBF16.repo}</div>
                    </div>
                    {p.weightsBF16.size && (
                      <div className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">{p.weightsBF16.size}</div>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{p.weightsBF16.note}</p>
                </Card>
              ) : null}

              {p.quants.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                      GGUF quants{p.ggufRepo ? ` · ${p.ggufRepo}` : ""}
                    </div>
                    <div className="text-[11px] text-zinc-500">{p.quants.length} files</div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {p.quants.map((q) => (
                      <div
                        key={q.name}
                        className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[13px]">{q.name}</div>
                          {q.note ? <div className="text-[10px] text-zinc-500">{q.note}</div> : null}
                        </div>
                        <div className="ml-3 shrink-0 text-right">
                          {q.sizeGB ? (
                            <div className="font-mono text-[12.5px] tabular-nums text-zinc-700 dark:text-zinc-300">{q.sizeGB} GB</div>
                          ) : null}
                          <div className="text-[10px] text-zinc-500">
                            {q.family === "UD" ? "unsloth-dynamic" : q.family === "MXFP4" ? "MS FP4" : "standard"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Section>

          <Section id="hosts" label="Hardware">
            <div className="flex flex-col gap-4">
              {p.hosts.includes("spark") && (
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold">dgx-spark-01 — NVIDIA DGX Spark</div>
                    <Badge tone="emerald">GB10 · 128 GB unified</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                    {SPARK_INFO.map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
                        <dd className="font-mono text-[13px]">{v}</dd>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {p.hosts.includes("halo") && (
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-semibold">ryzen-ai-max-395-03 — AMD Ryzen AI Max+ 395 (Strix Halo)</div>
                    <Badge tone="amber">Radeon 8060S · 128 GB unified</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                    {HALO_INFO.map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</dt>
                        <dd className="font-mono text-[13px]">{v}</dd>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </Section>

          <Section id="engines" label="Engines">
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    <th className="px-4 py-2.5">Engine</th>
                    <th className="px-4 py-2.5">Host</th>
                    <th className="px-4 py-2.5">Binary / Image</th>
                    <th className="px-4 py-2.5">Build commit + flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {p.engineRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5">
                        {r.engine}{" "}
                        {r.badge ? <Badge tone={r.badge.tone}>{r.badge.label}</Badge> : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{r.host}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{r.imageHtml}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{r.versionHtml}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="mt-3 text-xs text-zinc-500">
              Engine slugs in <span className="font-mono">/runs</span>:{" "}
              <span className="font-mono">llamacpp-cuda · llamacpp-vulkan · llamacpp-hip · vllm</span>.
            </p>
          </Section>

          <Section id="reproduce" label="How To Reproduce">
            <div className="flex flex-col gap-4">
              <p className="text-xs text-zinc-500">
                Verbatim commands as dispatched by the InferStation runner. Each unit file lives at
                {" "}<span className="font-mono">/home/amd/inferstation/admin_api/units/&lt;id&gt;.json</span> on the dispatcher host;
                the dispatcher SSHes to the target host alias and executes the <span className="font-mono">launch_cmd</span> below.
              </p>
              {p.reproduce.map((r) => (
                <CopyBlock key={r.title} title={r.title} code={r.code} />
              ))}
              <p className="text-xs text-zinc-500">
                <span className="font-mono">-npl 1,4,16,32</span> sweeps four concurrency levels in one llama-batched-bench run;
                each is ingested as a separate record in <Link className="underline underline-offset-2" href="/runs">/runs</Link>.
              </p>
            </div>
          </Section>

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

          <Section id="caveats" label="Caveats">
            <Card>
              <ul className="flex flex-col gap-3 text-sm">
                {p.caveats.map((c, i) => <li key={i}>{c}</li>)}
                {p.hosts.includes("spark") && (
                  <li>
                    On Spark, Vulkan benchmarks <strong>must</strong> set{" "}
                    <span className="font-mono">VK_DRIVER_FILES=/usr/share/vulkan/icd.d/nvidia_icd.json</span>;
                    without it the loader picks mesa <span className="font-mono">freedreno</span> /{" "}
                    <span className="font-mono">lvp</span> and returns wrong-device numbers.
                  </li>
                )}
                {p.hosts.includes("halo") && (
                  <li>
                    On Halo <span className="font-mono">HSA_OVERRIDE_GFX_VERSION=11.5.1</span> is required: gfx1151
                    has no shipped ROCm code-object, so we report as gfx1150. Removing the override breaks every HIP
                    launch with &quot;no kernel image&quot;.
                  </li>
                )}
              </ul>
            </Card>
          </Section>

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
                  Unit registry on dispatcher:{" "}
                  <span className="font-mono">/home/amd/inferstation/admin_api/units/*.json</span>
                </li>
                <li>
                  Raw run records: <Link className="underline underline-offset-2" href="/runs">/runs</Link>
                </li>
              </ul>
            </Card>
          </Section>
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <div className="mb-3 text-[11px] uppercase tracking-widest text-zinc-500">On This Page</div>
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
