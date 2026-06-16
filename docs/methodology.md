# InferStation methodology (mirror of /methodology)

Scope v0: Strix Halo and DGX Spark. Engines: llama.cpp (HIP), llama.cpp (Vulkan), vLLM.

## Benchmark mode: online serving

All numbers come from an **online serving** benchmark (not an offline batch tool),
so llama.cpp and vLLM are measured with the *same* method and the *same* metric
definitions. We start an OpenAI-compatible server (`llama-server` or `vllm serve`)
and drive it with a streaming client.

Per-unit flow (a fresh container every run, so there is no cross-run state):

1. **Check for stale containers** — remove any leftover server container with the
   same name.
2. **Start a new container** (detached) and **download the model in parallel** —
   the download (HF `hf download`: single-file gguf with sharded fallback, or a
   full repo snapshot for vLLM) runs alongside container startup; both must
   finish before serving.
3. **Start serving** inside the container (`llama-server` / `vllm serve`,
   `--host 0.0.0.0`), then poll `/health` until it returns 200.
4. **Warm up** — a few small requests so first-token latency excludes one-time
   costs (e.g. Vulkan shader compilation).
5. **Run the bench client** — a pure-stdlib streaming client on the host drives
   each concurrency level. The server is started with enough slots
   (`-np` / `--max-num-seqs`) to cover the largest level; the client caps
   concurrency per level, so one server instance measures every batch size.
   Each request uses a **distinct** prompt so the server's prefix cache cannot
   dedupe prefill and serialize the batch.
6. **Stop serving** — the container is removed (and any downloaded model cleaned
   up) on exit via a trap, regardless of success or failure.

Decoupled config ↔ flow: a unit only *declares* what to run (model link, image,
serve start command, bench shape). The dispatcher's generic serve flow reads
those fields and executes the steps above; every serve unit shares one flow.

## Metrics

Measured per concurrency level (batch size), client-side wall-clock:

- **TTFT** — time to first token (ms), mean. Time from request submit to the
  first streamed token.
- **TPOT** — time per output token (ms), mean, excluding the first token:
  `(latency - ttft) / (output_len - 1)`.
- **Prefill throughput** (tok/s) — per request, `input_len / (ttft - one_tpot_step)`.
  Clean at concurrency 1; queue-inclusive at higher concurrency.
- **Decode throughput** (tok/s) — aggregate output tokens / wall-clock.
- **Total throughput** (tok/s) — aggregate (input + output) tokens / wall-clock.

ITL, end-to-end latency, and p50/p99 of each metric are recorded in the raw record.

Note on cross-checking: do **not** read llama.cpp's per-slot `print_timing` as a
per-request latency — under continuous batching (`-np N`) it charges each slot the
full shared batch-step duration, inflating per-token times ~Nx. Trust the
client-side wall-clock, or measure single-stream on an idle server.

## Reproducibility

Every run record carries: engine name + version + git commit + build flags,
model source URL + quantization tag, the exact command line, a link to the raw
log, host hardware + OS/driver versions, and a usability tag (✅ / ⚠️ / ❌).

If a published number cannot be reproduced from the recorded command on the
recorded hardware, the run is flagged and re-tested.

## Inference engine images

All numbers are produced on InferStation's own nightly-built engine images
(Harbor `10.161.176.9:8443/inferstation/*`, public mirror `ghcr.io/inferstation/*`).

**Strix Halo vLLM uses the gfx1151-optimized build** (`vllm-rocm-halo`, tracking
AMD's [ROCm/vllm](https://github.com/ROCm/vllm) `gfx11` branch). This branch ships
AMD's Strix-Halo-specific tuned kernels (W4A16 prefill block sizing, GDN prefill
shape-keyed config, unquantized-weight stride padding off the gfx11x 4096-byte
cliff) and retains `FusedMoE.tp_size` so AWQ MoE loads cleanly. **The published
Strix Halo vLLM daily-test numbers are therefore the AMD-optimized-kernel
numbers, not vanilla upstream vLLM.** DGX Spark vLLM uses the CUDA build
(`vllm-cuda-spark`). llama.cpp uses the HIP / Vulkan / CUDA builds per host.

## Usability tag

Each row carries a usability hint: ✅ usable, ⚠️ runs but slow / fragile,
❌ broken. This captures real-world deployment friction that raw throughput
numbers hide.

Not in v0: PD-disagg, power, multi-GPU sharding.
