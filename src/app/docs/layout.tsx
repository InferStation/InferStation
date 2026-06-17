import Link from "next/link";

const NAV_SECTIONS: {
  label: string;
  items: { href: string; label: string; meta?: string }[];
}[] = [
  {
    label: "Models",
    items: [
      { href: "/docs/qwen3-6-35b-a3b",        label: "Qwen3.6-35B-A3B",        meta: "MoE · 35B/3B · 24 quants" },
      { href: "/docs/qwen3-6-27b",            label: "Qwen3.6-27B",            meta: "Dense · 27B · 22 quants" },
      { href: "/docs/qwen3-30b-a3b",          label: "Qwen3-30B-A3B",          meta: "MoE · 30B/3B · Q4_K_M" },
      { href: "/docs/qwen3-32b",              label: "Qwen3-32B",              meta: "Dense · 32B · Q4_K_M" },
      { href: "/docs/qwen3-14b",              label: "Qwen3-14B",              meta: "Dense · 14B · Q4_K_M" },
      { href: "/docs/qwen3-8b",               label: "Qwen3-8B",               meta: "Dense · 8B · Q4_K_M" },
      { href: "/docs/qwen3-4b",               label: "Qwen3-4B",               meta: "Dense · 4B · 26 quants" },
      { href: "/docs/gemma-4-26b-a4b-it",     label: "Gemma-4-26B-A4B-it",     meta: "MoE · 26B/4B · 21 quants" },
      { href: "/docs/llama-3-3-70b-instruct", label: "Llama-3.3-70B-Instruct", meta: "Dense · 70B · Q4/Q8" },
    ],
  },
  {
    label: "Devices",
    items: [
      { href: "/docs/devices",    label: "Overview",   meta: "Price · performance comparison" },
      { href: "/docs/dgx-spark",  label: "DGX Spark",  meta: "NVIDIA GB10 · sm_121 · 128 GB" },
      { href: "/docs/strix-halo", label: "Strix Halo", meta: "AMD Ryzen AI Max+ 395 · gfx1151 · 128 GB" },
    ],
  },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto py-12 pr-2">
            <nav className="flex flex-col gap-6 text-sm">
              {NAV_SECTIONS.map((sec) => (
                <div key={sec.label}>
                  <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-widest text-zinc-500">
                    {sec.label}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {sec.items.map((it) => (
                      <li key={it.href}>
                        <Link
                          href={it.href}
                          className="flex flex-col rounded-md px-2 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                        >
                          <span>{it.label}</span>
                          {it.meta ? (
                            <span className="font-mono text-[10.5px] text-zinc-500">{it.meta}</span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
