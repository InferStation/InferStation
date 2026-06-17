"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { RunRecord, RunSummary } from "@/lib/runs";
import { fetchAllRuns, fetchRunRecord, githubBlobUrl as getGithubBlobUrl } from "@/lib/runsClient";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return Number(n).toFixed(digits);
}

function RunDetailInner() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchAllRuns(), fetchRunRecord(id)])
      .then(([all, rec]) => {
        const s = all.find((r) => r.id === id) ?? null;
        setSummary(s);
        setRecord(rec ?? null);
      })
      .catch((e) => setErr(String(e)));
  }, [id]);

  if (!id) return <p className="p-8 text-sm text-zinc-500">Missing run id.</p>;
  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!summary || !record) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <p className="text-xs uppercase tracking-widest text-zinc-500">
        <Link href="/runs" className="hover:text-zinc-800 dark:hover:text-zinc-200">
          Runs
        </Link>{" "}
        / {record.run_date}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {record.model.name}{" "}
        <span className="font-mono text-base text-zinc-500">
          ({record.model.quantization})
        </span>
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        on {record.host.name} · {record.engine.name} {record.engine.backend} @{" "}
        <span className="font-mono">
          {record.engine.commit.slice(0, 8) || record.engine.version}
        </span>
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <Stat label="Prefill (pp)">
          <span className="font-mono text-2xl">{fmt(record.pp_toks_per_s, 2)}</span>{" "}
          <span className="text-sm text-zinc-500">tok/s</span>
          <div className="text-xs text-zinc-500">{record.pp_test ?? "—"}</div>
        </Stat>
        <Stat label="Decode (tg)">
          <span className="font-mono text-2xl">{fmt(record.tg_toks_per_s, 2)}</span>{" "}
          <span className="text-sm text-zinc-500">tok/s</span>
          <div className="text-xs text-zinc-500">{record.tg_test ?? "—"}</div>
        </Stat>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <Card title="Host">
          <Row k="name" v={record.host.name} />
          <Row k="vendor" v={record.host.vendor} />
          <Row k="chip" v={record.host.chip} />
          <Row k="VRAM" v={`${record.host.vram_gb} GB`} />
          <Row k="form" v={record.host.deployment_form} mono />
        </Card>
        <Card title="Model">
          <Row k="slug" v={record.model.slug} mono />
          <Row k="quant" v={record.model.quantization} mono />
          {record.model.source_url ? (
            <Row
              k="source"
              v={
                <a
                  href={record.model.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline decoration-zinc-300 hover:decoration-zinc-900 dark:hover:decoration-zinc-100"
                >
                  {record.model.source_url.replace(/^https?:\/\//, "")}
                </a>
              }
            />
          ) : null}
        </Card>
        <Card title="Engine">
          <Row k="name" v={record.engine.name} />
          <Row k="backend" v={record.engine.backend} mono />
          <Row k="version" v={record.engine.version} mono />
          <Row k="commit" v={record.engine.commit} mono breakAll />
          <Row k="build" v={record.engine.build_flags} mono breakAll />
        </Card>
        <Card title="Scenario">
          <Row k="scenario" v={record.scenario} mono />
          <Row k="ctx" v={record.ctx ?? "—"} />
          <Row k="batch" v={record.batch ?? "—"} />
          <Row k="ngl" v={record.n_gpu_layers ?? "—"} />
          <Row k="usability" v={record.usability_tag} mono />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Command
        </h2>
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
          {record.command}
        </pre>
      </section>

      <section className="mt-8 flex flex-wrap gap-2 text-sm">
        <a
          href={getGithubBlobUrl(summary.source_path)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          View JSON on GitHub
        </a>
        {record.log_url ? (
          <a
            href={record.log_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Workflow run log
          </a>
        ) : null}
      </section>

      {record.raw_llamabench ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Raw llama-bench output
          </h2>
          <pre className="max-h-[480px] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs dark:border-zinc-800 dark:bg-zinc-900">
            {JSON.stringify(record.raw_llamabench, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

export default function RunDetailPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-500">Loading…</p>}>
      <RunDetailInner />
    </Suspense>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <dl className="space-y-1 text-sm">{children}</dl>
    </div>
  );
}

function Row({
  k,
  v,
  mono,
  breakAll,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-xs uppercase text-zinc-500">{k}</dt>
      <dd
        className={[
          "min-w-0 flex-1",
          mono ? "font-mono text-xs" : "text-sm",
          breakAll ? "break-all" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {v}
      </dd>
    </div>
  );
}
