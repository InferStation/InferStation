"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BenchmarkNav from "@/components/BenchmarkNav";
import {
  buildBenchmarkCoverage,
  type BenchmarkCoverageRow,
} from "@/lib/benchmarkCoverage";
import {
  formatEvaluationMetric,
  primaryMetric,
  type EvaluationRunSummary,
} from "@/lib/evaluations";
import { fetchEvaluationManifest } from "@/lib/evaluationsClient";
import { evaluationMockManifest } from "@/lib/evaluationsMock";
import { fetchAllRuns } from "@/lib/runsClient";

const SCHEMA_URL =
  "https://github.com/InferStation/InferStation/blob/main/data/evaluations/SCHEMA.md";

type CoverageState = "all" | BenchmarkCoverageRow["state"];

function suiteKey(run: EvaluationRunSummary): string {
  return `${run.evaluation.suite.slug}@${run.evaluation.suite.version}`;
}

function sourceUrl(sourcePath: string): string {
  return `https://github.com/InferStation/InferStation/blob/main/${sourcePath}`;
}

function StateBadge({ state }: { state: BenchmarkCoverageRow["state"] }) {
  const style = {
    published:
      "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300",
    partial:
      "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
    missing:
      "bg-zinc-100 text-zinc-500 ring-zinc-500/15 dark:bg-zinc-900 dark:text-zinc-400",
  }[state];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${style}`}>
      {state}
    </span>
  );
}

export default function BenchmarkSummary() {
  const [performanceRuns, setPerformanceRuns] = useState<Awaited<ReturnType<typeof fetchAllRuns>> | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationRunSummary[] | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [host, setHost] = useState("all");
  const [backend, setBackend] = useState("all");
  const [state, setState] = useState<CoverageState>("all");
  const [suite, setSuite] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([fetchAllRuns(), fetchEvaluationManifest()])
      .then(([performance, manifest]) => {
        setPerformanceRuns(performance);
        if (manifest.runs.length === 0) {
          setEvaluations(evaluationMockManifest.runs);
          setIsMock(true);
        } else {
          setEvaluations(manifest.runs);
          setIsMock(false);
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  const suites = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of evaluations ?? []) {
      map.set(suiteKey(run), `${run.evaluation.suite.name} · ${run.evaluation.suite.version}`);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [evaluations]);
  const activeSuite = suites.some((item) => item.key === suite) ? suite : suites[0]?.key ?? "";

  const comparableEvaluations = useMemo(
    () => (evaluations ?? []).filter((run) => !activeSuite || suiteKey(run) === activeSuite),
    [activeSuite, evaluations],
  );
  const rows = useMemo(
    () => buildBenchmarkCoverage(performanceRuns ?? [], comparableEvaluations),
    [comparableEvaluations, performanceRuns],
  );
  const hosts = useMemo(
    () => [...new Map(rows.map((row) => [row.host.slug, row.host.name])).entries()],
    [rows],
  );
  const backends = useMemo(
    () => [...new Set(rows.map((row) => row.engine.backend))].sort(),
    [rows],
  );
  const datasets = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of comparableEvaluations) {
      for (const task of run.tasks) map.set(task.dataset.slug, task.dataset.name);
    }
    return [...map.entries()].map(([slug, name]) => ({ slug, name }));
  }, [comparableEvaluations]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (host !== "all" && row.host.slug !== host) return false;
      if (backend !== "all" && row.engine.backend !== backend) return false;
      if (state !== "all" && row.state !== state) return false;
      if (!needle) return true;
      return [
        row.model.name,
        row.model.slug,
        row.model.quantization,
        row.host.name,
        row.host.slug,
        row.engine.name,
        row.engine.backend,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [backend, host, query, rows, state]);
  const visibleRows = showAll ? filtered : filtered.slice(0, 150);

  if (error) {
    return <StateMessage tone="error">Failed to load Benchmark data: {error}</StateMessage>;
  }
  if (!performanceRuns || !evaluations) {
    return <StateMessage>Loading Performance coverage and Benchmark results…</StateMessage>;
  }

  const published = rows.filter((row) => row.state === "published").length;
  const partial = rows.filter((row) => row.state === "partial").length;
  const modelCount = new Set(rows.map((row) => row.model.slug)).size;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-9 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BenchmarkNav active="summary" />
        <Link
          href="/benchmark/run"
          className="rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Run an evaluation →
        </Link>
      </div>

      <header className="mt-6 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 px-6 py-8 dark:border-indigo-950 dark:from-indigo-950/40 dark:via-zinc-950 dark:to-cyan-950/30 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700 dark:text-indigo-300">
          Benchmark summary
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Quality coverage for every meaningful serving configuration.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The matrix starts from the same models, machines, quantizations, and backends represented
          by Performance. Accuracy metrics stay isolated by their versioned Eval Hub protocol.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm">
          <a
            href={SCHEMA_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-indigo-200 bg-white/80 px-3 py-1.5 hover:bg-white dark:border-indigo-800 dark:bg-zinc-950/70"
          >
            Data schema
          </a>
          <span className="rounded-md border border-indigo-200 bg-white/50 px-3 py-1.5 text-zinc-600 dark:border-indigo-900 dark:bg-zinc-950/40 dark:text-zinc-400">
            No composite ranking
          </span>
        </div>
      </header>

      {isMock ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
          <span>
            <strong>Preview mode:</strong> no published accuracy JSON exists yet, so one clearly
            labeled synthetic Eval Hub result is shown to validate the page.
          </span>
          <a
            href={sourceUrl(evaluationMockManifest.runs[0].source_path)}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            View mock JSON
          </a>
        </div>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Expected configs", value: rows.length, note: "From Performance" },
          { label: "Evaluated", value: published, note: "Complete results" },
          { label: "Missing", value: Math.max(0, rows.length - published - partial), note: "Visible work queue" },
          { label: "Models", value: modelCount, note: "Canonical identities" },
          { label: "Datasets", value: datasets.length, note: "Current suite" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="font-mono text-2xl font-semibold tabular-nums">{item.value.toLocaleString()}</div>
            <div className="mt-1 text-xs font-medium">{item.label}</div>
            <div className="mt-1 text-[11px] text-zinc-500">{item.note}</div>
          </div>
        ))}
      </section>

      <section className="mt-7 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Filter label="Suite">
            <select value={activeSuite} onChange={(event) => setSuite(event.target.value)} className={controlClass}>
              {suites.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </Filter>
          <Filter label="Machine">
            <select value={host} onChange={(event) => setHost(event.target.value)} className={controlClass}>
              <option value="all">All machines</option>
              {hosts.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
            </select>
          </Filter>
          <Filter label="Backend">
            <select value={backend} onChange={(event) => setBackend(event.target.value)} className={controlClass}>
              <option value="all">All backends</option>
              {backends.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Filter>
          <Filter label="Coverage">
            <select value={state} onChange={(event) => setState(event.target.value as CoverageState)} className={controlClass}>
              <option value="all">All states</option>
              <option value="published">Published</option>
              <option value="partial">Partial</option>
              <option value="missing">Missing</option>
            </select>
          </Filter>
          <Filter label="Find configuration">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Model, quant, engine…" className={controlClass} />
          </Filter>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Coverage matrix</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Performance-aligned accuracy</h2>
          </div>
          <span className="text-xs text-zinc-500">{filtered.length.toLocaleString()} configurations</span>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[1050px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/80 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-3 font-medium">Model / quantization</th>
                <th className="px-3 py-3 font-medium">Machine</th>
                <th className="px-3 py-3 font-medium">Engine / backend</th>
                {datasets.map((dataset) => <th key={dataset.slug} className="px-3 py-3 text-right font-medium">{dataset.name}</th>)}
                <th className="px-3 py-3 text-right font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key} className="border-b border-zinc-100 last:border-0 hover:bg-indigo-50/30 dark:border-zinc-900 dark:hover:bg-indigo-950/10">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{row.model.name}</div>
                    <div className="mt-1 font-mono text-[11px] text-zinc-500">{row.model.quantization}{row.model.scheme ? ` · ${row.model.scheme}` : ""}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div>{row.host.name}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{row.host.chip}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div>{row.engine.name}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{row.engine.backend} · {row.engine.version}</div>
                  </td>
                  {datasets.map((dataset) => {
                    const task = row.evaluation?.tasks.find((item) => item.dataset.slug === dataset.slug);
                    const metric = task ? primaryMetric(task) : undefined;
                    return (
                      <td key={dataset.slug} className="px-3 py-3 text-right font-mono tabular-nums">
                        {metric ? formatEvaluationMetric(metric) : <span className="text-zinc-400">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right"><StateBadge state={row.state} /></td>
                  <td className="px-4 py-3 text-right">
                    {row.evaluation ? (
                      <a href={sourceUrl(row.evaluation.source_path)} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {isMock ? "Mock JSON" : row.evaluation.run_date}
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-400">Not evaluated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 ? <div className="px-6 py-14 text-center text-sm text-zinc-500">No configurations match these filters.</div> : null}
        </div>
        {filtered.length > 150 ? (
          <div className="mt-4 text-center">
            <button type="button" onClick={() => setShowAll((value) => !value)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
              {showAll ? "Show first 150" : `Show all ${filtered.length.toLocaleString()}`}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

const controlClass = "h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>{children}</label>;
}

function StateMessage({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "error" }) {
  return <div className={`mx-auto w-full max-w-7xl px-6 py-12 text-sm ${tone === "error" ? "text-red-600" : "text-zinc-500"}`}>{children}</div>;
}
