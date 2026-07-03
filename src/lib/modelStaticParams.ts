import fs from "node:fs";
import path from "node:path";

import { canonicalModelSlug } from "./modelCanonical";
import { MODEL_RELEASE_ORDER } from "./modelOrder";

interface RunsManifest {
  runs?: Array<{ model?: { slug?: string }; engine?: { name?: string; slug?: string } }>;
}

export function staticChartParams(): { model: string; framework: string }[] {
  const file = path.join(process.cwd(), "public", "data", "runs.json");
  const raw = fs.readFileSync(file, "utf8");
  const manifest = JSON.parse(raw) as RunsManifest;
  const rows = Array.isArray(manifest.runs) ? manifest.runs : [];
  const keys = new Set<string>();
  for (const run of rows) {
    const model = run.model?.slug;
    const engine = (run.engine?.name || run.engine?.slug || "").toLowerCase();
    if (!model || !engine) continue;
    // Emit both canonical pages (used by navigation) and raw alias pages (so
    // older/deep-linked quant/task slugs don't fall through to the homepage).
    keys.add(`${model}\u0000${engine}`);
    keys.add(`${canonicalModelSlug(model)}\u0000${engine}`);
  }
  return [...keys]
    .map((key) => {
      const [model, framework] = key.split("\u0000");
      return { model, framework };
    })
    .sort((a, b) => {
      const ai = MODEL_RELEASE_ORDER.indexOf(a.model);
      const bi = MODEL_RELEASE_ORDER.indexOf(b.model);
      const ar = ai < 0 ? MODEL_RELEASE_ORDER.length : ai;
      const br = bi < 0 ? MODEL_RELEASE_ORDER.length : bi;
      if (ar !== br) return ar - br;
      if (a.model !== b.model) return a.model.localeCompare(b.model);
      return a.framework.localeCompare(b.framework);
    });
}

export function staticModelParams(): { model: string }[] {
  const seen = new Set(staticChartParams().map((p) => p.model));
  return [...seen].map((model) => ({ model }));
}
