import { MODEL_RELEASE_ORDER } from "./modelOrder";

export function canonicalModelSlug(slug: string): string {
  let out = (slug || "").toLowerCase();

  // Remove benchmark/task suffixes that should not define a new model page.
  out = out.replace(/-mmstar$/i, "");
  out = out.replace(/-xlam$/i, "");
  out = out.replace(/(?:-|_)specdec-eagle3$/i, "");

  // Remove quantization suffixes that were accidentally baked into model slugs.
  out = out.replace(/-awq-4bit$/i, "");
  out = out.replace(/-awq-int4$/i, "");
  out = out.replace(/-awq$/i, "");
  out = out.replace(/-ct\.w4a16$/i, "");
  out = out.replace(/-quantized\.w4a16$/i, "");
  out = out.replace(/\.w4a16$/i, "");

  // Some experiment slugs append task suffixes with an underscore after a
  // quantized model name, e.g. qwen3-...-awq-4bit_specdec-eagle3. The task
  // suffix is stripped above; this second pass removes the now-terminal quant
  // suffix.
  out = out.replace(/-awq-4bit$/i, "");
  out = out.replace(/-awq-int4$/i, "");
  out = out.replace(/-awq$/i, "");
  out = out.replace(/-ct\.w4a16$/i, "");
  out = out.replace(/-quantized\.w4a16$/i, "");
  out = out.replace(/\.w4a16$/i, "");

  return out;
}

export function canonicalModelName(name: string, slug: string): string {
  const canonical = canonicalModelSlug(slug);
  const known = MODEL_RELEASE_ORDER.find((s) => s === canonical);
  if (known) {
    // Keep display names stable for the common benchmark families.
    const words = known
      .replace(/-/g, " ")
      .replace(/\bqwen\b/i, "Qwen")
      .replace(/\bdeepseek\b/i, "DeepSeek")
      .replace(/\bgemma\b/i, "Gemma")
      .replace(/\bllama\b/i, "Llama")
      .replace(/\bmimo\b/i, "MiMo")
      .replace(/\ba3b\b/i, "A3B")
      .replace(/\ba4b\b/i, "A4B")
      .replace(/\bit\b/i, "IT");
    return words.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/Qwen3\.6/i, "Qwen3.6");
  }
  return name
    .replace(/-AWQ-4bit$/i, "")
    .replace(/-AWQ-INT4$/i, "")
    .replace(/-AWQ$/i, "")
    .replace(/-CT\.w4a16$/i, "")
    .replace(/-quantized\.w4a16$/i, "")
    .replace(/\.w4a16$/i, "")
    .replace(/-mmstar$/i, "")
    .replace(/-xlam$/i, "")
    .replace(/(?:-|_)specdec-eagle3$/i, "");
}

export function canonicalModelSlugForRun(model: { slug: string }): string {
  return canonicalModelSlug(model.slug);
}
