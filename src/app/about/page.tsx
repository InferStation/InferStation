export default function About() {
  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-16 prose prose-zinc dark:prose-invert">
      <h1>About InferStation</h1>

      <p>
        InferStation is an independent reference station for LLM inference performance on the
        hardware that actually lives on people&rsquo;s desks: APU mini-PCs, consumer desktops, and
        workstation towers. We publish reproducible, vendor-neutral measurements with the exact
        commands and raw logs needed to verify every data point.
      </p>

      <h2>Why this site exists</h2>
      <p>
        Training has had its decade. The next several years belong to inference — partly in data
        centers, but increasingly on private hardware: a Strix Halo box on a desk, a DGX Spark on a
        workbench, a W7900 in a tower. Buyers, ops engineers, and model developers need honest
        comparative numbers across engines, quantizations, and contexts. Vendor marketing is not
        that. Single-score leaderboards are not that. InferStation aims to be.
      </p>

      <h2>What we measure</h2>
      <ul>
        <li>Prefill throughput (tokens/s)</li>
        <li>Decode throughput (tokens/s)</li>
        <li>Time-to-first-token (ms)</li>
        <li>Peak VRAM (GB)</li>
        <li>Per quantization, per context length, per concurrency</li>
        <li>Across engines: llama.cpp (HIP), llama.cpp (Vulkan), vLLM</li>
      </ul>
      <p>
        Scope v0: Strix Halo and DGX Spark. Tower workstations and additional engines come once
        v0 is stable.
      </p>

      <h2>Independence statement</h2>
      <p>
        InferStation is operated by an individual contributor. The maintainer is employed by AMD;
        the data, methods, and conclusions on this site do not represent AMD&rsquo;s position. Every
        result is published with the exact reproduction command and raw log so anyone can verify it
        on their own hardware. If we ever find ourselves softening a number to please a vendor, the
        site has already failed.
      </p>

      <h2>How to contribute</h2>
      <p>
        Open an issue or PR on{" "}
        <a href="https://github.com/JoursBleu/InferStation" target="_blank" rel="noreferrer">
          GitHub
        </a>
        . New runs are submitted as a single JSON file under{" "}
        <code>data/runs/&lt;date&gt;/&lt;host&gt;-&lt;model&gt;-&lt;engine&gt;.json</code> with a
        link to the raw log.
      </p>
    </article>
  );
}
