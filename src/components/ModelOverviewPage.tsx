"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchAllRuns } from "@/lib/runsClient";
import type { RunSummary } from "@/lib/runs";
import { modelReleaseRank } from "@/lib/modelOrder";

type SectionKind = "charts" | "compare" | "runs";

const COPY: Record<SectionKind, { eyebrow: string; title: string; body: string; action: string }> = {
  charts: {
    eyebrow: "Charts overview",
    title: "Choose a model to inspect charted benchmark results",
    body: "Each model page shows its chart view without loading every model into one workspace. Use this page as a compact index into the current benchmark corpus.",
    action: "Open charts",
  },
  compare: {
    eyebrow: "Compare overview",
    title: "Choose a model to compare devices, frameworks, and precision",
    body: "Each model page keeps the full comparison controls focused on one model: device type, framework/backend, precision, and concurrency.",
    action: "Open compare",
  },
  runs: {
    eyebrow: "Runs overview",
    title: "Choose a model to browse raw run records",
    body: "Each model page lists the underlying run records, commands, commits, and JSON links for that model only.",
    action: "Open runs",
  },
};

interface ModelCard {
  slug: string;
  name: string;
  params: number;
  runs: number;
  latest: string;
  devices: string[];
  frameworks: string[];
  quants: string[];
}

interface DockerImageSummary {
  repo: string;
  ref: string;
  displayRef: string;
  count: number;
  ghcrUrl: string;
}

function dockerRepo(ref: string): string {
  const m = /inferstation\/([^:/]+)(?::[^/]+)?$/.exec(ref || "");
  return m?.[1] ?? ref;
}

function dockerRef(image: string, tag?: string): string {
  if (!image) return "";
  if (image.includes(":")) return image;
  return tag ? `${image}:${tag}` : image;
}

function dockerTag(ref: string): string {
  const i = ref.lastIndexOf(":");
  return i >= 0 ? ref.slice(i + 1) : "latest";
}

function nightlyRank(tag: string): number {
  const m = /^nightly-(\d{8})$/.exec(tag || "");
  return m ? Number(m[1]) : 0;
}

function deviceLabel(r: RunSummary): string {
  const h = r.host.name || "";
  if (h.includes("Spark") || h.includes("DGX")) return "Spark";
  if (h.includes("Halo") || h.includes("Ryzen")) return "Halo";
  return h || "-";
}

function frameworkLabel(r: RunSummary): string {
  return r.engine.name || r.engine.backend || "-";
}

export default function ModelOverviewPage({ kind }: { kind: SectionKind }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAllRuns().then(setRuns).catch((e) => setErr(String(e)));
  }, []);

  const cards = useMemo<ModelCard[]>(() => {
    if (!runs) return [];
    const map = new Map<string, ModelCard>();
    for (const r of runs) {
      let c = map.get(r.model.slug);
      if (!c) {
        c = {
          slug: r.model.slug,
          name: r.model.name,
          params: r.model.params_b,
          runs: 0,
          latest: r.run_date || "",
          devices: [],
          frameworks: [],
          quants: [],
        };
        map.set(r.model.slug, c);
      }
      c.runs += 1;
      if (r.run_date > c.latest) c.latest = r.run_date;
      const dev = deviceLabel(r);
      const fw = frameworkLabel(r);
      if (!c.devices.includes(dev)) c.devices.push(dev);
      if (!c.frameworks.includes(fw)) c.frameworks.push(fw);
      if (!c.quants.includes(r.model.quantization)) c.quants.push(r.model.quantization);
    }
    return [...map.values()].sort((a, b) => {
      const ra = modelReleaseRank(a.slug);
      const rb = modelReleaseRank(b.slug);
      if (ra !== rb) return ra - rb;
      return b.params - a.params || a.name.localeCompare(b.name);
    });
  }, [runs]);

  const dockerImages = useMemo<DockerImageSummary[]>(() => {
    if (!runs) return [];
    const byRepo = new Map<string, Map<string, number>>();
    for (const r of runs) {
      const ref = dockerRef(r.image || "", r.image_tag);
      if (!ref) continue;
      const repo = dockerRepo(ref);
      const tag = dockerTag(ref);
      if (!nightlyRank(tag)) continue;
      const tags = byRepo.get(repo) ?? new Map<string, number>();
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
      byRepo.set(repo, tags);
    }
    return [...byRepo.entries()].map(([repo, tags]) => {
      const tag = [...tags.keys()].sort((a, b) => nightlyRank(b) - nightlyRank(a))[0];
      return {
        repo,
        ref: `${repo}:${tag}`,
        displayRef: `ghcr.io/inferstation/${repo}:${tag}`,
        count: tags.get(tag) ?? 0,
        ghcrUrl: `https://github.com/orgs/InferStation/packages/container/package/${encodeURIComponent(repo)}`,
      };
    }).sort((a, b) => a.repo.localeCompare(b.repo));
  }, [runs]);

  const copy = COPY[kind];
  const base = `/${kind}`;

  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!runs) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-6 py-10">
      <aside className="w-64 shrink-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Models</h2>
        <ul className="flex flex-col gap-1">
          {cards.map((m) => (
            <li key={m.slug}>
              <Link
                href={kind === "charts" ? `${base}/${m.slug}/vllm` : `${base}/${m.slug}`}
                className="block w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-zinc-500">{m.runs} runs</div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-w-0 flex-1">
        <section className="max-w-3xl">
          <p className="text-xs uppercase tracking-widest text-zinc-500">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.body}</p>
        </section>

        <section className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Models</div>
            <div className="mt-1 text-2xl font-semibold">{cards.length}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Runs</div>
            <div className="mt-1 text-2xl font-semibold">{runs.length}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Latest</div>
            <div className="mt-1 text-2xl font-semibold">{cards[0]?.latest ?? "-"}</div>
          </div>
        </section>

        <section className="mt-8 max-w-3xl rounded-lg border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
          Select a model from the left sidebar to open its {copy.action.toLowerCase()} page.
          The overview stays intentionally compact so the heavy charts and run tables load only on model pages.
        </section>

        <section className="mt-8 max-w-3xl rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Docker images used by these runs</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Links open the public GitHub Packages page. Showing the latest nightly tag per image repository.
          </p>
          <div className="mt-4 grid gap-2">
            {dockerImages.map((img) => (
              <div key={img.ref} className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
                <a href={img.ghcrUrl} target="_blank" rel="noreferrer" className="font-medium underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:hover:decoration-zinc-100">
                  {img.repo}
                </a>
                <a href={img.ghcrUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:text-zinc-400 dark:hover:decoration-zinc-100">
                  {img.displayRef}
                </a>
                <span className="text-zinc-500">{img.count} runs</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
