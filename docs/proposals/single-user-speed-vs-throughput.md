# Proposal: single-user speed vs. aggregate throughput reporting

**Status:** Proposed — NOT yet implemented (2026-06-13)
**Scope:** serve-mode benchmark presentation (charts + methodology wording).
Frontend-only; no re-measurement of any run is required.
**Related docs:** [`../methodology.md`](../methodology.md) (user-facing),
[`../serve-bench-architecture.md`](../serve-bench-architecture.md) (internal design).

## Motivation

Make the benchmark reflect how a real user actually experiences the service:

- At **concurrency 1** (a single user), what matters is **that user's speed** —
  how fast they see the first token (TTFT) and how fast tokens then stream.
- Under **concurrency** (many users at once), what matters is **aggregate
  throughput** — how much total work the server does. A single request's speed
  naturally degrades as the batch fills, so under load the per-user speed is
  **reference-only**, not the headline.

## Core principle

| Scenario          | Primary metric                              | Single-user speed                       |
| ----------------- | ------------------------------------------- | --------------------------------------- |
| c = 1 (one user)  | single-user speed (TTFT + per-stream tok/s) | **is** the headline                     |
| c > 1 (concurrent)| aggregate throughput (total/decode tok/s)   | reference only (degrades under load)    |

## Current state (gap analysis)

**The data already exists.** Every serve run JSON stores `ttft_ms`, `tpot_ms`,
and the three aggregate throughputs (`decode/prefill/total_toks_per_s`).
`RunRecord` in `src/lib/runs.ts` already types `ttft_ms` / `tpot_ms`.

**But the charts only plot aggregate throughput.** In `src/app/charts/ChartsView.tsx`:

- `Metric = "tg_toks_per_s" | "pp_toks_per_s" | "combined_toks_per_s"` — three
  aggregate throughputs only.
- Default is `tg_toks_per_s`, whose own subtitle reads
  *"decode tokens/s, summed across concurrent streams"*.
- x-axis = concurrency (BS 1/4/16/32); one bar per device.
- The `ChartRun` interface exposes only those three throughputs —
  **`ttft_ms` / `tpot_ms` are not threaded through**, so the chart cannot draw them.

**Consequence:** the `tg` line silently mixes two meanings — at **c=1** the bar
*is* the single-user speed (one stream, so aggregate == per-user); at **c>1** it
is aggregate throughput — but this is never labelled. Two single-user-experience
signals are missing from the charts entirely:

1. **TTFT** (first-token latency) — captured, never plotted.
2. **Per-stream single-user speed under load** = `1000 / tpot_ms` (what one user
   actually feels inside a batch) — captured (`tpot_ms`), never plotted.

## Proposed change

Surface the two semantics as distinct curves so the trade-off is visible:

| Curve                | Definition                          | c = 1                                  | c > 1                              |
| -------------------- | ----------------------------------- | -------------------------------------- | --------------------------------- |
| Single-user speed    | per-stream tok/s = `1000 / tpot_ms` | headline (real single-user experience) | falls with load → reference only  |
| Aggregate throughput | total/decode summed tok/s           | == single-user speed (they coincide)   | headline, rises with load         |
| First-token latency  | TTFT (ms)                           | headline (single-user feel)            | rises, reference                  |

This makes the principle visible in one chart: as concurrency rises,
**aggregate throughput climbs while single-user speed drops** — exactly
"under load look at throughput; single-user speed is reference only".

## Presentation options (pick one before implementing)

- **A. Dual-line chart** — plot single-user speed (drops with c) and aggregate
  throughput (rises with c) on one chart; they meet at c=1. Best at showing the
  trade-off at a glance.
- **B. Extra metric buttons (smallest change)** — add "Single-user speed
  (per-stream)" and "TTFT" to `METRICS`; subtitle notes
  *"c=1 = single-user experience; c>1 reference only"*.
- **C. Summary cards** — for each (model, device) show two headline numbers:
  **single-user speed @ c1** (tok/s + TTFT) and **peak throughput @ c_max**
  (total tok/s) — directly answering "how fast for one user" and "how many users
  it can serve".

**Leaning:** B as the base (add the metrics + label the semantics), optionally
plus A (dual-line trade-off) once the data is wired through.

## Implementation scope (when approved)

Frontend only; no re-measurement.

1. Thread `ttft_ms` / `tpot_ms` through `ChartRun` (already present in
   `RunRecord` and in the run JSON; just carry them in the ChartsLoader mapping).
2. Add a derived metric `single_user_tok_s = 1000 / tpot_ms`.
3. Add the metric(s) + main/reference labelling to `ChartsView` per the chosen
   option.
4. Sync `docs/methodology.md` "Reading the numbers" so the wording matches the
   new chart semantics (the prose already states the principle).

## Related: diffusion (block-diffusion) models

The same single-user-vs-throughput lens is also the correct framing for
DiffusionGemma / block-diffusion models, where the autoregressive TTFT/TPOT
definitions break down: denoising steps emit no tokens and a *commit* emits a
whole 256-token block at once, so per-chunk TPOT/ITL are distorted. For those
models the honest single-user signal is **c=1 end-to-end latency + TTFT**
(diffusion trades ~9x higher TTFT for ~3.3x faster end-to-end), and aggregate
throughput should be read from the server's diffusion Prometheus metrics
(`vllm:diffusion_*` → committed-token throughput) rather than per-chunk timing.
Tracked separately from this proposal.
