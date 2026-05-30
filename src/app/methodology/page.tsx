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

      <h2>Metrics</h2>
      <ul>
        <li>
          <strong>pp (prefill throughput)</strong>: tokens/s during the prompt-processing phase
          (single batch, fixed prompt length).
        </li>
        <li>
          <strong>tg (decode throughput)</strong>: tokens/s during generation, averaged over a
          fixed-length output.
        </li>
        <li>
          <strong>ttft</strong>: time from request submit to first generated token (ms).
        </li>
        <li>
          <strong>VRAM peak</strong>: maximum device memory in GB during the run.
        </li>
      </ul>

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

      <h2>Usability tag</h2>
      <p>
        Each row carries a usability hint: <strong>✅ usable</strong>,{" "}
        <strong>⚠️ runs but slow / fragile</strong>, <strong>❌ broken</strong>. This captures
        real-world deployment friction that raw throughput numbers hide.
      </p>
    </article>
  );
}
