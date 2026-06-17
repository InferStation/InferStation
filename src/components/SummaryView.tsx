"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchAllRuns } from "@/lib/runsClient";
import type { RunSummary } from "@/lib/runs";

const MODEL_RELEASE_DATES: Record<string, string> = {
  "Llama-3.1-8B-Instruct": "2024-07-18",
  "Llama-3.3-70B-Instruct": "2024-11-26",
  "Qwen3-4B": "2025-04-27",
  "Qwen3-8B": "2025-04-27",
  "Qwen3-14B": "2025-04-27",
  "Qwen3-30B-A3B": "2025-04-27",
  "Qwen3-32B": "2025-04-27",
  "Step-3.5-Flash": "2026-02-01",
  "Gemma-4-31B-it": "2026-03-11",
  "Gemma-4-26B-A4B-it": "2026-03-11",
  "Qwen3.6-35B-A3B": "2026-04-15",
  "Qwen3.6-27B": "2026-04-21",
  "MiMo-V2.5": "2026-04-27",
};

type PerfSlot = "BF16" | "8b" | "4b";

interface PerfCell {
  tps: number;
  quant: string;
}

interface PerfSummaryRow {
  model: string;
  release: string;
  framework: string;
  backend: string;
  device: string;
  BF16: PerfCell | null;
  "8b": PerfCell | null;
  "4b": PerfCell | null;
}

function perfDevice(r: RunSummary): string {
  const h = r.host.name || "";
  if (h.includes("Spark") || h.includes("DGX")) return "Spark";
  if (h.includes("Halo") || h.includes("Ryzen") || h.includes("Strix")) return "Halo";
  return h || "-";
}

function perfFramework(r: RunSummary): string {
  const e = (r.engine.name || "").toLowerCase();
  if (e.includes("vllm")) return "vLLM";
  if (e.includes("llama")) return "llama.cpp";
  return r.engine.name || "-";
}

function perfBackend(r: RunSummary): string {
  const fw = perfFramework(r);
  const b = (r.engine.backend || "").toLowerCase();
  const scenario = (r.scenario || "").toLowerCase();
  if (fw === "vLLM") {
    // vLLM's "default" path also runs TRITON_ATTN (quantized units pass
    // --attention-backend TRITON_ATTN without an attn suffix in the name), so
    // fold default into TRITON_ATTN; only the explicit flash bucket stays apart.
    if (b.includes("flash") || scenario.includes("attn-flash")) return "FLASH_ATTN";
    return "TRITON_ATTN";
  }
  if (b.includes("vulkan")) return "Vulkan";
  if (b.includes("cuda") || b.includes("hip") || b.includes("rocm")) return "CUDA/ROCm/HIP";
  return r.engine.backend || "-";
}

function perfSlot(quant: string): PerfSlot | null {
  const q = (quant || "").toUpperCase();
  if (q === "BF16") return "BF16";
  if (q.includes("Q8") || q.includes("FP8") || q.includes("INT8") || q.includes("W8A8")) return "8b";
  if (q.includes("Q4") || q.includes("AWQ") || q.includes("4BIT")) return "4b";
  return null;
}

const FW_ORDER: Record<string, number> = { vLLM: 0, "llama.cpp": 1 };
const BE_ORDER: Record<string, number> = {
  TRITON_ATTN: 0,
  Vulkan: 2,
  "CUDA/ROCm/HIP": 3,
  FLASH_ATTN: 9,
};
const DEV_ORDER: Record<string, number> = { Spark: 0, Halo: 1 };

/** Best combined (total) tok/s at concurrency 32, bucketed by
 *  model × framework × backend × device, with the fastest quant per
 *  precision slot (BF16 / 8-bit / 4-bit). Mirrors the admin perf-summary. */
function buildPerfSummary(runs: RunSummary[]): PerfSummaryRow[] {
  const best = new Map<string, { tps: number; quant: string }>();
  for (const r of runs) {
    if (r.concurrency !== 32) continue;
    const total = r.total_toks_per_s ?? r.combined_toks_per_s;
    if (total == null || total <= 0) continue;
    const slot = perfSlot(r.model.quantization);
    if (!slot) continue;
    const key = `${r.model.name}|${perfFramework(r)}|${perfBackend(r)}|${perfDevice(r)}|${slot}`;
    const prev = best.get(key);
    if (!prev || total > prev.tps) best.set(key, { tps: total, quant: r.model.quantization });
  }
  const grouped = new Map<string, PerfSummaryRow>();
  for (const [key, cell] of best) {
    const [model, framework, backend, device, slot] = key.split("|");
    const gk = `${model}|${framework}|${backend}|${device}`;
    let row = grouped.get(gk);
    if (!row) {
      row = {
        model,
        release: MODEL_RELEASE_DATES[model] ?? "",
        framework,
        backend,
        device,
        BF16: null,
        "8b": null,
        "4b": null,
      };
      grouped.set(gk, row);
    }
    row[slot as PerfSlot] = cell;
  }
  return [...grouped.values()].sort((a, b) => {
    const ra = (a.release || "0000-00-00").replace(/-/g, "");
    const rb = (b.release || "0000-00-00").replace(/-/g, "");
    if (ra !== rb) return rb.localeCompare(ra);
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    const fa = FW_ORDER[a.framework] ?? 9, fb = FW_ORDER[b.framework] ?? 9;
    if (fa !== fb) return fa - fb;
    const ba = BE_ORDER[a.backend] ?? 9, bb = BE_ORDER[b.backend] ?? 9;
    if (ba !== bb) return ba - bb;
    return (DEV_ORDER[a.device] ?? 9) - (DEV_ORDER[b.device] ?? 9);
  });
}

function PerfCellView({ cell }: { cell: PerfCell | null }) {
  if (!cell) return <span className="text-zinc-300 dark:text-zinc-700">—</span>;
  return (
    <div>
      <div className="font-mono font-semibold tabular-nums">{Math.round(cell.tps).toLocaleString()}</div>
      <div className="text-[10px] text-zinc-500">{cell.quant}</div>
    </div>
  );
}

export default function SummaryView() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchAllRuns().then(setRuns).catch((e) => setErr(String(e)));
  }, []);

  const rows = useMemo<PerfSummaryRow[]>(() => (runs ? buildPerfSummary(runs) : []), [runs]);
  const latest = useMemo(() => (runs ? runs.reduce((m, r) => (r.run_date > m ? r.run_date : m), "") : ""), [runs]);

  if (err) return <p className="p-8 text-sm text-red-600">Failed to load: {err}</p>;
  if (!runs) return <p className="p-8 text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-widest text-zinc-500">Performance summary</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Throughput at a glance
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Best combined (prefill + decode) throughput at 32 concurrent requests, bucketed by
          framework, backend, and device. Each precision column shows the fastest quantization
          measured for that bucket.
        </p>
        {latest ? <p className="mt-2 text-xs text-zinc-500">Last updated {latest}.</p> : null}
      </header>

      <section className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Released</th>
              <th className="px-3 py-2 font-medium">Framework</th>
              <th className="px-3 py-2 font-medium">Backend</th>
              <th className="px-3 py-2 font-medium">Device</th>
              <th className="px-3 py-2 text-right font-medium">BF16</th>
              <th className="px-3 py-2 text-right font-medium">8-bit</th>
              <th className="px-3 py-2 text-right font-medium">4-bit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const newModel = i === 0 || rows[i - 1].model !== row.model;
              return (
                <tr
                  key={`${row.model}|${row.framework}|${row.backend}|${row.device}`}
                  className={`text-zinc-700 dark:text-zinc-300 ${
                    newModel
                      ? "border-t border-zinc-200 dark:border-zinc-800"
                      : "border-t border-zinc-100 dark:border-zinc-900"
                  }`}
                >
                  <td className="px-3 py-2 font-medium">
                    {newModel ? (
                      <Link href={`/charts/${row.model.toLowerCase()}`} className="hover:underline">
                        {row.model}
                      </Link>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{newModel ? row.release : ""}</td>
                  <td className="px-3 py-2 text-xs">{row.framework}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">{row.backend}</td>
                  <td className="px-3 py-2 text-xs">{row.device}</td>
                  <td className="px-3 py-2 text-right"><PerfCellView cell={row.BF16} /></td>
                  <td className="px-3 py-2 text-right"><PerfCellView cell={row["8b"]} /></td>
                  <td className="px-3 py-2 text-right"><PerfCellView cell={row["4b"]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="mt-2 text-[11px] text-zinc-500">
        Combined tok/s at concurrency 32 · {rows.length} buckets. “—” = not benchmarked for that precision.
      </p>
    </div>
  );
}
