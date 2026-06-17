// Build-time helper: read which frameworks each model actually has data for,
// from the generated manifest (public/data/runs.json). Used by
// generateStaticParams so we only emit framework pages that have data.
import fs from "node:fs";
import path from "node:path";

export interface ModelFrameworkParam {
  model: string;
  framework: string;
}

function frameworkOf(engineName: string): string | null {
  const n = (engineName || "").toLowerCase();
  if (n.includes("vllm")) return "vllm";
  if (n.includes("llama")) return "llama.cpp";
  return null;
}

export function modelFrameworkParams(): ModelFrameworkParam[] {
  const manifest = path.join(process.cwd(), "public", "data", "runs.json");
  const pairs = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const runs: Array<{ model?: { slug?: string }; engine?: { name?: string } }> =
      Array.isArray(raw) ? raw : raw.runs || [];
    for (const r of runs) {
      const slug = r.model?.slug;
      const fw = frameworkOf(r.engine?.name || "");
      if (slug && fw) pairs.add(`${slug}@@${fw}`);
    }
  } catch {
    // manifest missing at build time — emit nothing rather than crash.
  }
  return [...pairs].map((p) => {
    const [model, framework] = p.split("@@");
    return { model, framework };
  });
}

/** First framework that a model has data for (llama.cpp preferred), or null. */
export function defaultFrameworkFor(slug: string): string | null {
  const fws = modelFrameworkParams()
    .filter((p) => p.model === slug)
    .map((p) => p.framework);
  if (fws.includes("llama.cpp")) return "llama.cpp";
  return fws[0] ?? null;
}
