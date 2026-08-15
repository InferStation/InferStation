"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  evaluationGithubBlobUrl,
  formatEvaluationMetric,
  primaryMetric,
  type EvaluationMetric,
  type EvaluationRunRecord,
} from "@/lib/evaluations";
import { fetchEvaluationRun } from "@/lib/evaluationsClient";

function DetailContent() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("run") ?? "";
  const [run, setRun] = useState<EvaluationRunRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    fetchEvaluationRun(runId)
      .then((record) => {
        if (record) setRun(record);
        else setNotFound(true);
      })
      .catch((caught) => setError(String(caught)));
  }, [runId]);

  if (!runId) return <StateMessage>Missing evaluation run ID.</StateMessage>;
  if (error) return <StateMessage tone="error">Failed to load: {error}</StateMessage>;
  if (notFound) return <StateMessage>Evaluation run not found.</StateMessage>;
  if (!run) return <StateMessage>Loading evaluation evidence…</StateMessage>;

  const suite = run.evaluation.suite;
  const sourceUrl = evaluationGithubBlobUrl(run.source_path);
  const artifactLinks = [
    ["Source workflow", run.artifacts.source_url],
    ["Run log", run.artifacts.log_url],
    ["Evaluation report", run.artifacts.report_url],
    ["Sample outputs", run.artifacts.samples_url],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
          <Link href="/accuracy" className="hover:text-indigo-600 dark:hover:text-indigo-400">
            Accuracy
          </Link>{" "}
          / {run.run_date}
        </p>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
            run.status === "completed"
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300"
              : run.status === "partial"
                ? "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {run.status}
        </span>
      </div>

      <header className="mt-4 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
            {suite.name} · {suite.version}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {run.model.name}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            {run.target.type === "local_server"
              ? `${run.target.host?.name ?? "Local server"} · ${run.target.engine?.name ?? "Self-hosted engine"}`
              : `${run.target.provider} · ${run.target.model_id}`}
            {" · "}
            {run.model.quantization}
            {run.model.scheme ? ` / ${run.model.scheme}` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-6 py-4 text-right dark:border-indigo-900 dark:bg-indigo-950/30">
          <div className="text-[11px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Composite score
          </div>
          <div className="mt-1 font-mono text-4xl font-semibold tabular-nums">
            —
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">Not defined in schema v1</div>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Task coverage" value={`${run.summary.completed_tasks}/${run.summary.total_tasks}`} />
        <Stat label="Target type" value={run.target.type === "local_server" ? "Local server" : "Online API"} />
        <Stat label="Completed" value={formatTimestamp(run.completed_at)} />
        <Stat label="Protocol" value={shortHash(run.evaluation.spec_id)} mono />
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Task results</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Scores and uncertainty</h2>
          </div>
          <p className="text-xs text-zinc-500">
            Primary metrics are shown first; raw values remain in the source JSON.
          </p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {run.tasks.map((task) => {
            const metric = primaryMetric(task);
            return (
              <article
                key={`${task.dataset.slug}:${task.dataset.subset ?? ""}`}
                className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{task.dataset.name}</h3>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {task.dataset.category} · {task.dataset.split}
                      {task.dataset.subset ? ` / ${task.dataset.subset}` : ""}
                    </p>
                  </div>
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    {task.status}
                  </span>
                </div>
                {metric ? (
                  <>
                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div>
                        <div className="font-mono text-3xl font-semibold tabular-nums">
                          {formatEvaluationMetric(metric)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{metric.label}</div>
                      </div>
                      {metric.n != null ? (
                        <div className="text-right text-xs text-zinc-500">
                          <div className="font-mono text-zinc-700 dark:text-zinc-300">
                            n={metric.n.toLocaleString()}
                          </div>
                          <div>samples</div>
                        </div>
                      ) : null}
                    </div>
                    <MetricUncertainty metric={metric} />
                  </>
                ) : (
                  <p className="mt-5 text-sm text-zinc-500">No metric published.</p>
                )}
                <div className="mt-5 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500 dark:border-zinc-900">
                  <div className="truncate" title={task.dataset.version}>
                    Dataset: <span className="font-mono">{task.dataset.version}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <InfoCard title="Model identity">
          <InfoRow label="Slug" value={run.model.slug} mono />
          <InfoRow label="Revision" value={run.model.revision || "Not exposed"} mono breakAll />
          <InfoRow label="Quantization" value={run.model.quantization} mono />
          <InfoRow label="Scheme" value={run.model.scheme || "—"} mono />
          <InfoRow label="Parameters" value={run.model.params_b == null ? "—" : `${run.model.params_b}B`} />
        </InfoCard>
        <InfoCard title="Evaluation protocol">
          <InfoRow label="Spec ID" value={run.evaluation.spec_id} mono breakAll />
          <InfoRow
            label="Harness"
            value={`${run.evaluation.harness.name} ${run.evaluation.harness.version}`}
          />
          <InfoRow label="Harness commit" value={run.evaluation.harness.commit || "—"} mono breakAll />
          <InfoRow
            label="Adapter"
            value={`${run.evaluation.adapter.name} ${run.evaluation.adapter.version}`}
          />
          <InfoRow label="Chat template" value={run.evaluation.adapter.chat_template} mono />
        </InfoCard>
        <InfoCard title="Target">
          <InfoRow label="Type" value={run.target.type} mono />
          <InfoRow label="Provider" value={run.target.provider} />
          <InfoRow label="Model ID" value={run.target.model_id} mono breakAll />
          <InfoRow label="Protocol" value={run.target.endpoint_protocol} mono />
          <InfoRow label="Region" value={run.target.region || "—"} />
          {run.target.host ? <InfoRow label="Host" value={`${run.target.host.name} · ${run.target.host.chip}`} /> : null}
          {run.target.engine ? (
            <InfoRow
              label="Engine"
              value={`${run.target.engine.name} ${run.target.engine.version} · ${run.target.engine.backend}`}
            />
          ) : null}
        </InfoCard>
        <InfoCard title="Generation and usage">
          <InfoRow label="Temperature" value={run.evaluation.generation.temperature ?? "—"} />
          <InfoRow label="Top P" value={run.evaluation.generation.top_p ?? "—"} />
          <InfoRow label="Seed" value={run.evaluation.generation.seed ?? "—"} mono />
          <InfoRow label="Max output" value={run.evaluation.generation.max_output_tokens ?? "—"} />
          <InfoRow label="Requests" value={run.usage.requests?.toLocaleString() ?? "—"} />
          <InfoRow label="Input tokens" value={run.usage.input_tokens?.toLocaleString() ?? "—"} />
          <InfoRow label="Output tokens" value={run.usage.output_tokens?.toLocaleString() ?? "—"} />
          <InfoRow
            label="Billed cost"
            value={run.usage.billed_usd == null ? "—" : `$${run.usage.billed_usd.toFixed(2)}`}
          />
        </InfoCard>
      </section>

      {run.evaluation.command ? (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Reproduction command
          </h2>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-6 dark:border-zinc-800 dark:bg-zinc-900/50">
            {run.evaluation.command}
          </pre>
        </section>
      ) : null}

      <section className="mt-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Evidence and artifacts</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              The checked-in JSON is the canonical aggregate record. External artifacts may contain
              logs, reports or per-sample outputs and should match their recorded digest.
            </p>
          </div>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            View JSON on GitHub
          </a>
        </div>
        {artifactLinks.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {artifactLinks.map(([label, href]) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:hover:border-indigo-700 dark:hover:text-indigo-400"
              >
                {label}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-xs text-zinc-500">No external artifacts were published.</p>
        )}
        {run.artifacts.samples_sha256 ? (
          <p className="mt-3 break-all font-mono text-[10px] text-zinc-500">
            Samples SHA-256: {run.artifacts.samples_sha256}
          </p>
        ) : null}
      </section>

      {run.notes ? (
        <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900 dark:bg-amber-950/20">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
            Interpretation notes
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{run.notes}</p>
        </section>
      ) : null}

      {run.raw_output ? (
        <details className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Embedded raw output</summary>
          <pre className="max-h-[520px] overflow-auto border-t border-zinc-200 bg-zinc-50 p-4 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
            {JSON.stringify(run.raw_output, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export default function AccuracyDetailPage() {
  return (
    <Suspense fallback={<StateMessage>Loading evaluation evidence…</StateMessage>}>
      <DetailContent />
    </Suspense>
  );
}

function MetricUncertainty({ metric }: { metric: EvaluationMetric }) {
  if (!metric.ci95 && metric.stderr == null) return null;
  const formatBound = (value: number) =>
    formatEvaluationMetric({ ...metric, value }, metric.unit === "ratio" ? 1 : 2);
  return (
    <div className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500 dark:bg-zinc-900/60">
      {metric.ci95 ? (
        <div className="flex justify-between gap-3">
          <span>95% confidence</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            {formatBound(metric.ci95[0])}–{formatBound(metric.ci95[1])}
          </span>
        </div>
      ) : null}
      {metric.stderr != null ? (
        <div className="mt-1 flex justify-between gap-3">
          <span>Standard error</span>
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            {formatBound(metric.stderr)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StateMessage({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={`mx-auto w-full max-w-6xl px-6 py-12 text-sm ${
        tone === "error" ? "text-red-600" : "text-zinc-500"
      }`}
    >
      {children}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <dl className="space-y-2.5">{children}</dl>
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono,
  breakAll,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`${mono ? "font-mono text-xs" : ""} ${breakAll ? "break-all" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortHash(value: string): string {
  return value.length > 22 ? `${value.slice(0, 21)}…` : value;
}
