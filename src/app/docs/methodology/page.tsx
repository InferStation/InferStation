export default function Methodology() {
  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-16 prose prose-zinc dark:prose-invert">
      <h1>Methodology</h1>

      <h2>Scope (v0)</h2>
      <ul>
        <li>
          <strong>Hardware:</strong> AMD Strix Halo (Ryzen AI Max+ 395, 128 GB unified), NVIDIA DGX
          Spark (GB10, 128 GB unified).
        </li>
        <li>
          <strong>Engines:</strong> llama.cpp (HIP), llama.cpp (Vulkan), vLLM. Each version is
          pinned by commit hash in every run.
        </li>
        <li>
          <strong>Not yet covered:</strong> prefill/decode disaggregation, power consumption,
          multi-GPU sharding. These come later, separately, and only when reproducible across
          engines.
        </li>
      </ul>

      <h2>Benchmark mode: online serving</h2>
      <p>
        All numbers come from an <strong>online serving</strong> benchmark, not an offline batch
        tool, so llama.cpp and vLLM are measured with the <em>same</em> method and the{" "}
        <em>same</em> metric definitions. We start an OpenAI-compatible server (
        <code>llama-server</code> or <code>vllm serve</code>) and drive it with a streaming client.
      </p>
      <p>A fresh container every run, so there is no cross-run state:</p>
      <ol>
        <li>
          <strong>Check for stale containers</strong> — remove any leftover server container with
          the same name.
        </li>
        <li>
          <strong>Start a new container</strong> (detached) and{" "}
          <strong>download the model in parallel</strong> — the HF download (single-file gguf with
          sharded fallback, or a full repo snapshot for vLLM) runs alongside container startup; both
          must finish before serving.
        </li>
        <li>
          <strong>Start serving</strong> inside the container, then poll <code>/health</code> until
          it returns 200.
        </li>
        <li>
          <strong>Warm up</strong> — a few small requests so first-token latency excludes one-time
          costs (e.g. Vulkan shader compilation).
        </li>
        <li>
          <strong>Run the bench client</strong> — a streaming client on the host drives each
          concurrency level. The server is started with enough slots (<code>-np</code> /{" "}
          <code>--max-num-seqs</code>) to cover the largest level; the client caps concurrency per
          level, so one server instance measures every batch size. Each request uses a{" "}
          <strong>distinct prompt</strong> so the prefix cache cannot dedupe prefill and serialize
          the batch.
        </li>
        <li>
          <strong>Stop serving</strong> — the container is removed (and any downloaded model cleaned
          up) on exit, regardless of success or failure.
        </li>
      </ol>
      <p>
        Decoupled config ↔ flow: a unit only <em>declares</em> what to run (model link, image, serve
        start command, bench shape). One generic serve flow reads those fields and runs the steps
        above; every serve unit shares it.
      </p>

      <h2>Metrics</h2>
      <p>Measured per concurrency level (batch size), client-side wall-clock:</p>
      <ul>
        <li>
          <strong>TTFT</strong> — time to first token (ms), mean. From request submit to the first
          streamed token.
        </li>
        <li>
          <strong>TPOT</strong> — time per output token (ms), mean, excluding the first token:{" "}
          <code>(latency − ttft) / (output_len − 1)</code>.
        </li>
        <li>
          <strong>Prefill throughput</strong> (tok/s) — per request,{" "}
          <code>input_len / (ttft − one_tpot_step)</code>. Clean at concurrency 1; queue-inclusive
          higher up.
        </li>
        <li>
          <strong>Decode throughput</strong> (tok/s) — aggregate output tokens / wall-clock.
        </li>
        <li>
          <strong>Total throughput</strong> (tok/s) — aggregate (input + output) tokens /
          wall-clock.
        </li>
      </ul>
      <p>
        ITL, end-to-end latency, and p50/p99 of each metric are kept in the raw record. Note: we do
        not read llama.cpp&apos;s per-slot timing as a per-request latency — under continuous
        batching it charges each slot the full shared batch-step duration, inflating per-token
        times. We trust the client-side wall-clock.
      </p>

      <h2>Reproducibility</h2>
      <p>Every run record carries:</p>
      <ul>
        <li>Engine name, version, git commit, build flags</li>
        <li>Model source URL and quantization tag</li>
        <li>The exact command line used</li>
        <li>A link to the raw log file</li>
        <li>Host hardware and OS/driver versions</li>
      </ul>
      <p>
        If a published number cannot be reproduced from the recorded command on the recorded
        hardware, the run is flagged and re-tested.
      </p>

      <h2>Inference engine images</h2>
      <p>
        All numbers are produced on InferStation&apos;s own nightly-built engine images
        (public mirror <code>ghcr.io/inferstation/*</code>).
      </p>
      <p>
        <strong>Strix Halo vLLM uses the gfx1151-optimized build</strong> (
        <code>vllm-rocm-halo</code>, tracking AMD&apos;s{" "}
        <a href="https://github.com/ROCm/vllm" target="_blank" rel="noreferrer">
          ROCm/vllm
        </a>{" "}
        <code>gfx11</code> branch). It ships AMD&apos;s Strix-Halo-specific tuned kernels
        (W4A16 prefill block sizing, GDN prefill shape-keyed config, unquantized-weight stride
        padding off the gfx11x 4096-byte cliff) and keeps <code>FusedMoE.tp_size</code> so AWQ
        MoE loads cleanly. <strong>The published Strix Halo vLLM numbers are therefore the
        AMD-optimized-kernel numbers, not vanilla upstream vLLM.</strong> DGX Spark vLLM uses
        the CUDA build; llama.cpp uses the HIP / Vulkan / CUDA builds per host.
      </p>

      <h2>Usability tag</h2>
      <p>
        Each row carries a usability hint: <strong>✅ usable</strong>,{" "}
        <strong>⚠️ runs but slow / fragile</strong>, <strong>❌ broken</strong>. This captures
        real-world deployment friction that raw throughput numbers hide.
      </p>
    </article>
  );
}
