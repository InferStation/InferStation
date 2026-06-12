// Bilingual labels for model tags (free-text grey badges) and capabilities
// (enum blue badges). Tags are stored in the DB as semantic keys (e.g. "chat",
// "vision") and rendered per the active locale here. Unknown keys fall back to
// the raw value so older free-text tags still display.

export type Bilingual = { en: string; zh: string }

// Free-text tag keys (DB backends.tags values use these keys).
export const TAG_LABEL: Record<string, Bilingual> = {
  chat: { en: "Chat", zh: "对话" },
  vision: { en: "Vision", zh: "视觉" },
  audio: { en: "Audio", zh: "音频" },
  video: { en: "Video", zh: "视频" },
  reasoning: { en: "Reasoning", zh: "推理模型" },
  code: { en: "Code", zh: "代码" },
  embedding: { en: "Embedding", zh: "向量" },
  rerank: { en: "Rerank", zh: "重排序" },
  image_gen: { en: "Image Gen", zh: "生图" },
  tts: { en: "TTS", zh: "语音合成" },
  moe: { en: "MoE", zh: "MoE" },
  ocr: { en: "OCR", zh: "OCR" },
  pdf: { en: "PDF", zh: "PDF" },
}

// Capability enum keys (DB backends.capabilities values).
export const CAPABILITY_LABEL: Record<string, Bilingual> = {
  streaming: { en: "Streaming", zh: "流式" },
  tools: { en: "Tools", zh: "工具调用" },
  reasoning: { en: "Reasoning", zh: "推理" },
  json_output: { en: "JSON Output", zh: "JSON 输出" },
  vision: { en: "Vision", zh: "视觉" },
}

// Resolve a tag value to a bilingual label; unknown keys/free text echo as-is.
export function tagLabel(v: string): Bilingual {
  return TAG_LABEL[v] ?? { en: v, zh: v }
}

export function capabilityLabel(c: string): Bilingual {
  return CAPABILITY_LABEL[c] ?? { en: c, zh: c }
}
