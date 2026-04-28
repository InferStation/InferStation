"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { useT } from "@/context/LocaleContext"

// ── Types ─────────────────────────────────────────────────────────────

interface Provider {
  backend_id: number
  backend: string
  provider: string
  status: string
  mode: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  cache_price: number | null
  currency: string
  context_length: number | null
  capabilities: string[]
  description: string | null
  created_at: string
  updated_at: string
}

interface ModelDetail {
  id: string
  // Best-provider flat fields (kept for older callers).
  backend_id: number
  backend: string
  provider: string
  status: string
  mode: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  cache_price: number | null
  currency: string
  // Aggregated model-card metadata.
  context_length: number | null
  capabilities: string[]
  description: string | null
  // Per-provider list.
  providers: Provider[]
  created_at: string
  updated_at: string
}

interface PerformanceRow {
  backend_id: number
  backend: string
  provider: string
  status: string
  ttft_ms: number | null
  uptime_pct: number | null
  errors_pct: number | null
  requests_24h: number | null
  available: boolean
}

interface Subscription {
  id: number
  backend_id: number
  model: string
  is_active: number | boolean
  is_owned?: boolean
}

const CAPABILITY_LABEL: Record<string, { en: string; zh: string }> = {
  streaming: { en: "Streaming", zh: "流式" },
  tools: { en: "Tools", zh: "工具调用" },
  reasoning: { en: "Reasoning", zh: "推理" },
  json_output: { en: "JSON Output", zh: "JSON 输出" },
}

const symbolFor = (currency: string | null | undefined) =>
  currency === "USD" ? "$" : "¥"

const fmtPrice = (v: number | null | undefined) => {
  if (v == null) return "—"
  if (v === 0) return "0"
  return Number(v).toFixed(4).replace(/\.?0+$/, "")
}

const fmtContext = (n: number | null | undefined): string => {
  if (n == null) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ── Page ──────────────────────────────────────────────────────────────

export default function ModelDetailPage() {
  const t = useT()
  const params = useParams()
  const search = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()

  // Path can be either ["<modelId...>"] (catalog view) or
  // ["<backend_id>", "<modelId...>"] (legacy path used by my-services links).
  const allParts = Array.isArray(params.id) ? params.id : [params.id as string]
  const queryBackendId = search.get("backend_id")
  const firstIsNumeric = allParts.length > 1 && /^\d+$/.test(allParts[0] || "")
  const pathBackendId = firstIsNumeric ? allParts[0] : null
  const modelId = decodeURIComponent(
    (firstIsNumeric ? allParts.slice(1) : allParts).join("/"),
  )
  const backendId = queryBackendId || pathBackendId  // may be null (catalog mode)

  const [model, setModel] = useState<ModelDetail | null>(null)
  const [perf, setPerf] = useState<PerformanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Subscriptions keyed by backend_id (one model can be subbed across N
  // providers, each with its own sub_key).
  const [subs, setSubs] = useState<Record<number, Subscription>>({})
  const [subBusy, setSubBusy] = useState<number | null>(null)

  // Active provider tab (defaults to best provider). Stored as backend_id.
  const [selected, setSelected] = useState<number | null>(null)

  const [exampleLang, setExampleLang] = useState<"curl" | "python">("curl")
  const [copiedExample, setCopiedExample] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  // ── data load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!modelId) return
    setLoading(true)
    const url = backendId
      ? `/api/models/${encodeURIComponent(modelId)}?backend_id=${backendId}`
      : `/api/models/${encodeURIComponent(modelId)}`
    Promise.all([
      apiFetch(url) as Promise<ModelDetail>,
      apiFetch(`/api/models/${encodeURIComponent(modelId)}/performance`).catch(() => ({ providers: [] as PerformanceRow[] })),
    ])
      .then(([m, p]) => {
        setModel(m)
        setPerf((p as { providers: PerformanceRow[] }).providers || [])
        if (m.providers && m.providers.length > 0) {
          const initial = backendId
            ? m.providers.find((pr) => String(pr.backend_id) === String(backendId))?.backend_id ?? m.providers[0].backend_id
            : m.providers[0].backend_id
          setSelected(initial)
        }
      })
      .catch(() => setError(t({ en: "Model not found", zh: "模型不存在" })))
      .finally(() => setLoading(false))
  }, [modelId, backendId])

  useEffect(() => {
    if (!user || !modelId) return
    apiFetch("/api/subscriptions")
      .then((rows: Subscription[]) => {
        const m: Record<number, Subscription> = {}
        for (const s of rows) {
          if (s.model === modelId && s.is_active) m[s.backend_id] = s
        }
        setSubs(m)
      })
      .catch(() => {})
  }, [user, modelId])

  // ── subscribe / unsubscribe ─────────────────────────────────────────
  const handleSubscribe = async (bid: number) => {
    if (!user) {
      router.push("/login")
      return
    }
    setSubBusy(bid)
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({ model: modelId, backend_id: bid }),
      })
      // /api/subscriptions returns {sub_key, model}; refetch for full row
      const rows = (await apiFetch("/api/subscriptions")) as Subscription[]
      const m: Record<number, Subscription> = {}
      for (const s of rows) {
        if (s.model === modelId && s.is_active) m[s.backend_id] = s
      }
      setSubs(m)
      void res
    } catch {
      alert(t({ en: "Subscribe failed", zh: "订阅失败" }))
    } finally {
      setSubBusy(null)
    }
  }

  const handleUnsubscribe = async (bid: number) => {
    const s = subs[bid]
    if (!s) return
    setSubBusy(bid)
    try {
      await apiFetch(`/api/subscriptions/${s.id}`, { method: "DELETE" })
      const next = { ...subs }
      delete next[bid]
      setSubs(next)
    } catch {
      alert(t({ en: "Failed to unsubscribe", zh: "取消订阅失败" }))
    } finally {
      setSubBusy(null)
    }
  }

  // ── derived ─────────────────────────────────────────────────────────
  const selectedProvider = useMemo(() => {
    if (!model) return null
    return model.providers.find((p) => p.backend_id === selected) || model.providers[0] || null
  }, [model, selected])

  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

  const exampleCode = useMemo(() => {
    if (!model) return ""
    if (exampleLang === "curl") {
      return `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer $YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "messages": [{"role": "user", "content": "hello"}]
  }'`
    }
    return `from openai import OpenAI

client = OpenAI(
    api_key="$YOUR_API_KEY",
    base_url="${baseUrl}/v1",
)

resp = client.chat.completions.create(
    model="${model.id}",
    messages=[{"role": "user", "content": "hello"}],
)
print(resp.choices[0].message.content)`
  }, [exampleLang, model?.id, baseUrl])

  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(exampleCode)
      setCopiedExample(true)
      setTimeout(() => setCopiedExample(false), 1500)
    } catch {}
  }

  const copyId = async () => {
    if (!model) return
    try {
      await navigator.clipboard.writeText(model.id)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    } catch {}
  }

  // ── render ──────────────────────────────────────────────────────────
  if (loading) {
    return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>
  }

  if (error || !model) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || t({ en: "Model not found", zh: "模型不存在" })}</p>
        <button onClick={() => router.push("/models")} className="text-fg hover:underline">
          {t({ en: "Back to model catalog", zh: "返回模型广场" })}
        </button>
      </div>
    )
  }

  // Display name = bare model name (strip family/ prefix). Family shown as a chip.
  const family = model.id.includes("/") ? model.id.split("/")[0] : ""
  const displayName = model.id.includes("/") ? model.id.split("/").slice(1).join("/") : model.id

  const sortedProviders = [...model.providers].sort((a, b) => {
    const ao = a.status === "online" ? 0 : 1
    const bo = b.status === "online" ? 0 : 1
    if (ao !== bo) return ao - bo
    const ap = a.input_price ?? Infinity
    const bp = b.input_price ?? Infinity
    return ap - bp
  })

  // Performance: pick fastest TTFT among rows that have a value; lower is better.
  const fastestPerf = perf.find((p) => p.ttft_ms != null && p.ttft_ms === Math.min(...perf.filter((x) => x.ttft_ms != null).map((x) => x.ttft_ms as number)))

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* Back */}
      <button
        onClick={() => router.push("/models")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1"
      >
        ← {t({ en: "Back to all models", zh: "返回模型广场" })}
      </button>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-fg mb-2 break-words">
          {displayName}
        </h1>
        {model.description && (
          <p className="text-fg-muted max-w-2xl mb-4 leading-relaxed">{model.description}</p>
        )}

        {/* ID + status + Get Started */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={copyId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface border border-line text-xs font-mono text-fg hover:bg-accent-soft"
            title={t({ en: "Copy model id", zh: "复制模型 ID" })}
          >
            {model.id}
            <span className="text-fg-muted">{copiedId ? "✓" : "⧉"}</span>
          </button>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
              model.status === "online"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${model.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
            {model.status === "online" ? t({ en: "STABLE", zh: "在线" }) : t({ en: "OFFLINE", zh: "离线" })}
          </span>
          {family && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-accent-soft text-fg border border-line">
              {family}
            </span>
          )}
          {selectedProvider && (
            <button
              onClick={() => {
                if (subs[selectedProvider.backend_id]) router.push("/dashboard/keys")
                else handleSubscribe(selectedProvider.backend_id)
              }}
              disabled={subBusy === selectedProvider.backend_id || selectedProvider.status !== "online"}
              className="ml-auto inline-flex items-center gap-1 h-9 px-4 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subs[selectedProvider.backend_id]
                ? t({ en: "Get API key →", zh: "获取 API Key →" })
                : selectedProvider.status !== "online"
                ? t({ en: "Offline", zh: "离线" })
                : t({ en: "Get Started →", zh: "立即接入 →" })}
            </button>
          )}
        </div>

        {/* Stat row: context + cheapest input + cheapest output */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-fg-muted">
          <div>
            <span className="text-fg-subtle mr-1">{t({ en: "Context", zh: "上下文" })}:</span>
            <span className="text-fg font-medium">{fmtContext(model.context_length)} {model.context_length ? "tokens" : ""}</span>
          </div>
          <div>
            <span className="text-fg-subtle mr-1">{t({ en: "Starting at", zh: "起价" })}</span>
            <span className="text-fg font-medium">
              {symbolFor(model.currency)}{fmtPrice(model.input_price)}/M
            </span>
            <span className="text-fg-subtle ml-1">{t({ en: "input tokens", zh: "输入 tokens" })}</span>
          </div>
          <div>
            <span className="text-fg-subtle mr-1">{t({ en: "Starting at", zh: "起价" })}</span>
            <span className="text-fg font-medium">
              {symbolFor(model.currency)}{fmtPrice(model.output_price)}/M
            </span>
            <span className="text-fg-subtle ml-1">{t({ en: "output tokens", zh: "输出 tokens" })}</span>
          </div>
        </div>

        {/* Capability badges */}
        {model.capabilities && model.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {model.capabilities.map((c) => {
              const lab = CAPABILITY_LABEL[c]
              if (!lab) return null
              return (
                <span
                  key={c}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent-soft text-fg border border-line"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-fg/50" />
                  {t(lab)}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Select Provider chips ─────────────────────────────────── */}
      {sortedProviders.length > 1 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-fg mb-2">{t({ en: "Select Provider", zh: "选择服务方" })}</h2>
          <div className="flex flex-wrap gap-2">
            {sortedProviders.map((p) => {
              const active = p.backend_id === selected
              return (
                <button
                  key={p.backend_id}
                  onClick={() => setSelected(p.backend_id)}
                  className={`inline-flex items-center gap-2 px-3 h-9 rounded-full border text-sm transition-colors ${
                    active
                      ? "bg-fg text-accent-fg border-fg"
                      : "bg-surface text-fg border-line hover:bg-accent-soft"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${p.status === "online" ? (active ? "bg-green-300" : "bg-green-500") : "bg-red-400"}`} />
                  {p.provider || p.backend}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── All Providers grid ───────────────────────────────────── */}
      <h2 className="text-base font-semibold text-fg mb-1">
        {t({ en: `All Providers for ${displayName}`, zh: `${displayName} 的所有服务方` })}
      </h2>
      <p className="text-sm text-fg-muted mb-4">
        {t({
          en: "LLM Gateway routes requests to the best provider that can handle your prompt size and parameters.",
          zh: "网关会根据你的提示长度和参数自动路由到合适的服务方。",
        })}
      </p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-10">
        {sortedProviders.map((p) => {
          const isSubbed = !!subs[p.backend_id]
          const isOwned = !!subs[p.backend_id]?.is_owned
          const sym = symbolFor(p.currency)
          const cache = p.cache_price != null ? p.cache_price : (p.input_price != null ? p.input_price * 0.1 : null)
          const cacheImplicit = p.cache_price == null
          return (
            <div
              key={p.backend_id}
              className={`rounded-xl border bg-surface p-4 flex flex-col ${
                p.backend_id === selected ? "border-fg/40 ring-1 ring-fg/20" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg truncate">{p.provider || p.backend}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
                  </div>
                  {p.tags && Object.keys(p.tags).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(p.tags).map(([k, v]) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-fg-muted border border-line">
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-fg-subtle text-right">
                  {p.context_length ? <>Ctx&nbsp;{fmtContext(p.context_length)}</> : ""}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center bg-bg/60 rounded-lg p-2 mb-3">
                <div>
                  <div className="text-[10px] uppercase text-fg-subtle">{t({ en: "Input", zh: "输入" })}</div>
                  <div className="text-sm font-semibold text-fg mt-0.5">{p.input_price == null ? "—" : `${sym}${fmtPrice(p.input_price)}`}</div>
                  <div className="text-[10px] text-fg-subtle">/M tokens</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-fg-subtle">{t({ en: "Cached", zh: "缓存" })}</div>
                  <div className="text-sm font-semibold text-fg mt-0.5">{cache == null ? "—" : `${sym}${fmtPrice(cache)}`}</div>
                  <div className="text-[10px] text-fg-subtle">{cacheImplicit && cache != null ? t({ en: "(input × 0.1)", zh: "(输入×0.1)" }) : "/M tokens"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-fg-subtle">{t({ en: "Output", zh: "输出" })}</div>
                  <div className="text-sm font-semibold text-fg mt-0.5">{p.output_price == null ? "—" : `${sym}${fmtPrice(p.output_price)}`}</div>
                  <div className="text-[10px] text-fg-subtle">/M tokens</div>
                </div>
              </div>

              <div className="flex-1" />

              {isSubbed ? (
                <div className="flex items-center gap-2">
                  <Link
                    href="/dashboard/keys"
                    className="flex-1 text-center h-9 leading-9 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90"
                  >
                    {isOwned ? t({ en: "Your service →", zh: "我的服务 →" }) : t({ en: "Get API key →", zh: "获取 API Key →" })}
                  </Link>
                  {!isOwned && (
                    <button
                      onClick={() => handleUnsubscribe(p.backend_id)}
                      disabled={subBusy === p.backend_id}
                      className="px-3 h-9 rounded-lg border border-line text-fg-muted text-sm hover:text-red-600 hover:border-red-300 disabled:opacity-50"
                      title={t({ en: "Unsubscribe", zh: "取消订阅" })}
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => handleSubscribe(p.backend_id)}
                  disabled={subBusy === p.backend_id || p.status !== "online"}
                  className="h-9 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {subBusy === p.backend_id
                    ? t({ en: "Subscribing...", zh: "订阅中..." })
                    : p.status !== "online"
                    ? t({ en: "Offline", zh: "离线" })
                    : t({ en: "Get Started →", zh: "立即接入 →" })}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Provider Performance ───────────────────────────────────── */}
      <div className="mb-10">
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-base font-semibold text-fg">
            {t({ en: "Provider Performance", zh: "服务方性能" })}
          </h2>
          <span className="text-xs text-fg-subtle">
            {t({ en: "Latency / uptime data over the last 24h. Lower TTFT is better.", zh: "近 24 小时延迟/可用率指标，TTFT 越小越快。" })}
          </span>
        </div>
        <div className="rounded-xl border border-line bg-surface divide-y divide-line">
          {perf.length === 0 && (
            <div className="px-4 py-6 text-sm text-fg-muted text-center">
              {t({ en: "No performance data yet.", zh: "暂无性能数据。" })}
            </div>
          )}
          {perf.map((p) => {
            const isFastest = !!fastestPerf && fastestPerf.backend_id === p.backend_id && (p.ttft_ms ?? 0) > 0
            return (
              <div
                key={p.backend_id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${p.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
                  <span className="font-medium text-fg truncate">{p.provider || p.backend}</span>
                  {isFastest && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                      {t({ en: "Fastest", zh: "最快" })}
                    </span>
                  )}
                  <span className="text-xs text-fg-subtle ml-2">
                    {p.requests_24h != null ? `${p.requests_24h} ${t({ en: "requests", zh: "请求" })}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-6 text-right shrink-0">
                  <div>
                    <div className="text-[10px] uppercase text-fg-subtle">TTFT</div>
                    <div className={`text-sm font-medium ${p.ttft_ms == null ? "text-fg-subtle" : "text-fg"}`}>
                      {p.ttft_ms == null ? "—" : `${p.ttft_ms}ms`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-fg-subtle">Uptime</div>
                    <div className={`text-sm font-medium ${p.uptime_pct == null ? "text-fg-subtle" : "text-fg"}`}>
                      {p.uptime_pct == null ? "—" : `${p.uptime_pct.toFixed(2)}%`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-fg-subtle">Errors</div>
                    <div className={`text-sm font-medium ${p.errors_pct == null ? "text-fg-subtle" : "text-fg"}`}>
                      {p.errors_pct == null ? "—" : `${p.errors_pct.toFixed(1)}%`}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Code example for the selected provider ─────────────────── */}
      {selectedProvider && subs[selectedProvider.backend_id] && (
        <div>
          <h2 className="text-base font-semibold text-fg mb-2">
            {t({ en: "Quick start", zh: "快速接入" })}
          </h2>
          <div className="rounded-xl border border-line bg-gray-900 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
              <div className="flex items-center gap-1">
                {(["curl", "python"] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setExampleLang(lang)}
                    className={`px-2.5 py-1 text-xs rounded ${
                      exampleLang === lang ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {lang === "curl" ? "curl" : "Python"}
                  </button>
                ))}
              </div>
              <button
                onClick={copyExample}
                className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
              >
                {copiedExample ? t({ en: "Copied", zh: "已复制" }) : t({ en: "Copy", zh: "复制" })}
              </button>
            </div>
            <pre className="px-4 py-3 text-xs text-gray-100 overflow-x-auto leading-relaxed">{exampleCode}</pre>
          </div>
          <p className="text-xs text-fg-subtle mt-2">
            {t({ en: "Use your ", zh: "使用你的 " })}
            <Link href="/dashboard/keys" className="underline hover:text-fg">{t({ en: "API key", zh: "API Key" })}</Link>
            {t({
              en: ". For more usage patterns (multi-model fallback, lock to a provider, etc.) see the ",
              zh: "。更多用法（多模型回退、锁定服务方等）见 ",
            })}
            <Link href="/docs" className="underline hover:text-fg">{t({ en: "docs", zh: "使用文档" })}</Link>
            {t({ en: ".", zh: "。" })}
          </p>
        </div>
      )}
    </div>
  )
}
