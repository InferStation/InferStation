"use client"

import { useEffect, useState } from "react"
import { formatTokens } from "@/lib/format"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface Backend {
  id: number
  name: string
  url: string | null
  mode: string
  models: string[]
  tags: Record<string, string>
  status: string
  enabled: number
  listing_status?: string | null
  review_note?: string | null
  input_price: number | null
  output_price: number | null
  cache_price: number | null
  currency: string
  pending_input_price: number | null
  pending_output_price: number | null
  pending_cache_price: number | null
  pending_currency: string | null
  pending_effective_at: string | null
  is_public: number
  owner_name: string
  updated_at: string
  // Soft-delete state. NULL/undefined = active. "deleted" = pending archive
  // (still visible to owner in My Services). The terminal "archived" state
  // is intentionally not surfaced to non-admin clients.
  deletion_status?: string | null
  deleted_at?: string | null
}

interface ModelStat {
  model: string
  subscribers: number
  requests: number
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  cost: number
}

interface BackendStats {
  id: number
  name: string
  models: ModelStat[]
}

export default function ServicesPage() {
  const t = useT()
  const { user, refreshUser } = useAuth()
  const [backends, setBackends] = useState<Backend[]>([])
  const [statsMap, setStatsMap] = useState<Record<number, ModelStat[]>>({})
  const [showForm, setShowForm] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    url: "",
    api_key: "",
    mode: "direct",
    family: "",
    model: "",
    served_as: "",
    tag_hardware: "",
    tag_framework: "",
    tag_quantization: "",
    input_price: "",
    output_price: "",
    cache_price: "",
    currency: "CNY",
  })
  const [families, setFamilies] = useState<string[]>([])
  const [catalog, setCatalog] = useState<Record<string, string[]>>({})
  const [tunnelNoticeOpen, setTunnelNoticeOpen] = useState(false)

  const isProvider = user && ["provider", "both", "admin"].includes(user.role)

  useEffect(() => {
    if (isProvider) loadBackends()
    apiFetch("/api/model-families").then((data: string[] | { families: string[] }) => {
      setFamilies(Array.isArray(data) ? data : data.families)
    }).catch(() => {})
    apiFetch("/api/model-catalog").then((data: Record<string, string[]>) => {
      setCatalog(data || {})
    }).catch(() => {})
  }, [user])

  const loadBackends = () => apiFetch("/api/backends?mine=true").then(setBackends).catch(() => {})

  const loadStats = () =>
    apiFetch("/api/backends/stats")
      .then((rows: BackendStats[]) => {
        const m: Record<number, ModelStat[]> = {}
        for (const r of rows) m[r.id] = r.models
        setStatsMap(m)
      })
      .catch(() => {})

  useEffect(() => {
    if (isProvider) loadStats()
  }, [isProvider, backends])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.mode !== "direct") {
      alert(t({ en: "Tunnel mode requires the client tool; the web form only supports direct mode.", zh: "隧道模式请使用客户端注册，网页仅支持直连模式。" }))
      return
    }
    if (!form.family) {
      alert(t({ en: "Please select a model family", zh: "请选择模型系列" }))
      return
    }
    if (!form.model) {
      alert(t({ en: "Please select a model", zh: "请选择一个模型" }))
      return
    }
    try {
      const tags: Record<string, string> = {}
      if (form.tag_hardware.trim()) tags.hardware = form.tag_hardware.trim()
      if (form.tag_framework.trim()) tags.framework = form.tag_framework.trim()
      if (form.tag_quantization.trim()) tags.quantization = form.tag_quantization.trim()

      const models = [`${form.family}/${form.model}`]
      const client_info: Record<string, unknown> = {}
      if (form.served_as.trim()) {
        client_info.model_map = { [models[0]]: form.served_as.trim() }
      }
      if (form.api_key.trim()) {
        client_info.api_key = form.api_key.trim()
      }

      await apiFetch("/api/backends", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          url: form.mode === "direct" ? form.url : null,
          mode: form.mode,
          models,
          tags,
          input_price: form.input_price ? parseFloat(form.input_price) : null,
          output_price: form.output_price ? parseFloat(form.output_price) : null,
          cache_price: form.cache_price ? parseFloat(form.cache_price) : null,
          currency: form.currency,
          client_info,
        }),
      })
      setShowForm(false)
      setForm({ name: "", url: "", api_key: "", mode: "direct", family: "", model: "", served_as: "", tag_hardware: "", tag_framework: "", tag_quantization: "", input_price: "", output_price: "", cache_price: "", currency: "CNY" })
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t({ en: "Operation failed", zh: "操作失败" }))
    }
  }

  const deleteBackend = async (name: string) => {
    if (!confirm(t({ en: `Delete backend "${name}"?`, zh: `确定要删除后端 "${name}" 吗？` }))) return
    await apiFetch(`/api/backends/${name}`, { method: "DELETE" })
    loadBackends()
  }

  const toggleBackend = async (name: string) => {
    try {
      await apiFetch(`/api/backends/${name}/toggle`, { method: "PUT" })
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t({ en: "Operation failed", zh: "操作失败" }))
    }
  }

  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const checkBackend = async (name: string) => {
    setChecking((m) => ({ ...m, [name]: true }))
    try {
      const r = await apiFetch(`/api/backends/${name}/check`, { method: "POST" })
      if (r?.status === "online") {
        alert(t({ en: `Health check passed: ${name} is online`, zh: `检查通过：${name} 当前在线` }))
      } else {
        alert(t({ en: `Health check failed: ${name} offline\n${r?.error ?? ""}`, zh: `检查未通过：${name} 离线\n${r?.error ?? ""}` }))
      }
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t({ en: "Operation failed", zh: "操作失败" }))
    } finally {
      setChecking((m) => ({ ...m, [name]: false }))
    }
  }

  if (!user) return null

  const handleUpgrade = async () => {
    setUpgrading(true)
    try {
      await apiFetch("/api/user/upgrade-role", {
        method: "POST",
        body: JSON.stringify({ target_role: "both" }),
      })
      await refreshUser()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t({ en: "Operation failed", zh: "操作失败" }))
    } finally {
      setUpgrading(false)
    }
  }

  if (!isProvider) {
    return (
      <div>
        <div className="bg-white rounded-lg border p-6">
          <h2 className="font-semibold mb-2">{t({ en: "Become a model service provider", zh: "成为模型服务提供者" })}</h2>
          <p className="text-sm text-gray-600 mb-4">{t({ en: "Once you activate the provider role you can register your own model backends and share them with other users.", zh: "激活提供者身份后，你可以注册自己的模型后端，将模型服务分享给其他用户。" })}</p>
          <button
            onClick={handleUpgrade}
            disabled={upgrading}
            className="bg-fg text-white px-6 py-2 rounded-lg hover:bg-fg/90 disabled:opacity-50"
          >
            {upgrading ? t({ en: "Activating...", zh: "激活中..." }) : t({ en: "Activate", zh: "激活" })}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-start items-center mb-6">
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-fg text-white px-4 py-2 rounded-lg hover:bg-fg/90"
        >
          {showForm ? t({ en: "Cancel", zh: "取消" }) : t({ en: "Register new backend", zh: "注册新后端" })}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Backend name", zh: "后端名称" })}</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Connection mode", zh: "接入模式" })}</label>
                <select
                  value={form.mode}
                  onChange={(e) => {
                    const v = e.target.value
                    setForm({ ...form, mode: v })
                    if (v === "tunnel") setTunnelNoticeOpen(true)
                  }}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none"
                >
                  <option value="direct">{t({ en: "Direct (publicly reachable)", zh: "直连（公网可达）" })}</option>
                  <option value="tunnel">{t({ en: "Tunnel (NAT, requires client registration)", zh: "隧道（NAT 内网，需客户端注册）" })}</option>
                </select>
                {form.mode === "tunnel" && (
                  <p className="mt-1 text-xs text-red-600">
                    {t({ en: "Tunnel mode is not yet supported in the web form, ", zh: "隧道模式暂不支持网页注册，" })}
                    <button type="button" onClick={() => setTunnelNoticeOpen(true)} className="underline hover:text-red-700">{t({ en: "see onboarding instructions", zh: "查看接入说明" })}</button>
                  </p>
                )}
              </div>
            </div>
            {form.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Backend URL", zh: "后端 URL" })}</label>
                <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://IP:PORT" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
            )}
            {form.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Upstream API key (optional)", zh: "上游 API Key（可选）" })}</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={t({ en: "Fill in if upstream requires auth; leave blank for none", zh: "如上游需要认证则填入，留空表示上游无认证" })}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none font-mono"
                />
                <p className="mt-1 text-xs text-gray-500">{t({ en: "The gateway forwards using ", zh: "网关转发时会以 " })}<code>Authorization: Bearer &lt;key&gt;</code>{t({ en: ". Visible only to you; never exposed to subscribers.", zh: " 带上。仅你本人可见，不会泄露给订阅者。" })}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Model family", zh: "模型系列" })}</label>
              <select value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value, model: "" })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none">
                <option value="">{t({ en: "Please select a model family", zh: "请选择模型系列" })}</option>
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Model", zh: "模型" })}</label>
              <select
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                required
                disabled={!form.family}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{form.family ? t({ en: "Please select a model", zh: "请选择模型" }) : t({ en: "Please select a family first", zh: "请先选择模型系列" })}</option>
                {(catalog[form.family] || []).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {form.family && form.model && (
                <p className="mt-1 text-xs text-gray-500">{t({ en: `Will be saved as: ${form.family}/${form.model}`, zh: `将保存为：${form.family}/${form.model}` })}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t({ en: "Model name on your URL (optional)", zh: "你的 URL 上的模型名（可选）" })}
              </label>
              <input
                type="text"
                value={form.served_as}
                onChange={(e) => setForm({ ...form, served_as: e.target.value })}
                placeholder={form.model ? t({ en: `Defaults to ${form.model}`, zh: `默认用 ${form.model}` }) : t({ en: "e.g. qwen3-8b-awq", zh: "例如 qwen3-8b-awq" })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t({ en: "Direct mode only. The gateway rewrites the OpenAI request's model field to this value before forwarding. You can register the same URL with multiple backend names (each using a different served name).", zh: "仅直连模式需要。网关转发请求时，会把 OpenAI 请求的 model 字段改为此值后再传给你的服务。同一个 URL 可以用不同后端名注册多个模型（每个走不同的 served 名）。" })}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Tags (all optional)", zh: "标签（均为可选）" })}</label>
              <div className="grid gap-3 md:grid-cols-3">
                <input type="text" value={form.tag_hardware} onChange={(e) => setForm({ ...form, tag_hardware: e.target.value })} placeholder={t({ en: "Hardware, e.g. MI300X", zh: "硬件，如 MI300X" })} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none text-sm" />
                <input type="text" value={form.tag_framework} onChange={(e) => setForm({ ...form, tag_framework: e.target.value })} placeholder={t({ en: "Framework, e.g. vLLM", zh: "框架，如 vLLM" })} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none text-sm" />
                <input type="text" value={form.tag_quantization} onChange={(e) => setForm({ ...form, tag_quantization: e.target.value })} placeholder={t({ en: "Quantization, e.g. AWQ / FP16", zh: "量化，如 AWQ / FP16" })} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none text-sm" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Currency", zh: "货币" })}</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none">
                  <option value="CNY">CNY (¥)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: `Input price (${form.currency === "USD" ? "$" : "¥"}/M tokens)`, zh: `输入定价（${form.currency === "USD" ? "$" : "¥"}/百万token）` })}</label>
                <input type="number" step="0.01" value={form.input_price} onChange={(e) => setForm({ ...form, input_price: e.target.value })} placeholder={t({ en: "default", zh: "默认" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: `Output price (${form.currency === "USD" ? "$" : "¥"}/M tokens)`, zh: `输出定价（${form.currency === "USD" ? "$" : "¥"}/百万token）` })}</label>
                <input type="number" step="0.01" value={form.output_price} onChange={(e) => setForm({ ...form, output_price: e.target.value })} placeholder={t({ en: "default", zh: "默认" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: `Cache-hit price (${form.currency === "USD" ? "$" : "¥"}/M tokens)`, zh: `缓存命中定价（${form.currency === "USD" ? "$" : "¥"}/百万token）` })}</label>
                <input type="number" step="0.01" value={form.cache_price} onChange={(e) => setForm({ ...form, cache_price: e.target.value })} placeholder={t({ en: "defaults to input × 0.1", zh: "默认为输入×0.1" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {t({ en: "After registration the service is ", zh: "注册后服务默认为 " })}<b>{t({ en: "offline · private", zh: "未上架 · 私有" })}</b>{t({ en: " by default. Confirm the configuration on the detail page and click “Request listing” — once an admin approves it can go live; you may make it “public” before listing.", zh: "。请在详情页确认配置后点击「申请上架」，提交管理员审核通过后才能正式上架；上架前可选择「公开可见」。" })}
            </div>
            <button type="submit" className="bg-fg text-white px-6 py-2 rounded-lg hover:bg-fg/90">{t({ en: "Submit", zh: "提交" })}</button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {(() => {
          const renderRowsForBackend = (b: Backend) => {
          const rows = b.models.length > 0 ? b.models : [null]
          return rows.map((m, idx) => {
            const s = m ? (statsMap[b.id] || []).find((x) => x.model === m) : undefined
            const sym = b.currency === "USD" ? "$" : "¥"
            const psym = (b.pending_currency ?? b.currency) === "USD" ? "$" : "¥"
            return (
              <Link
                key={`${b.id}-${m ?? "_"}`}
                href={`/my-services/${encodeURIComponent(b.name)}`}
                className={`block bg-white rounded-lg border border-line hover:border-line-strong transition-colors ${!b.enabled || b.deletion_status ? "opacity-60" : ""}`}
              >
                {/* Header */}
                <div className="flex justify-between items-start gap-3 px-5 py-3 border-b border-line flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-base text-gray-900 break-all">{m ?? t({ en: "No model set", zh: "未设置模型" })}</h3>
                      {(() => {
                        const st = b.listing_status || (b.enabled ? "listed" : "offline")
                        const cls =
                          st === "listed" ? "bg-green-50 text-green-700"
                          : st === "pending" ? "bg-amber-50 text-amber-700"
                          : "bg-gray-100 text-gray-600"
                        const label = st === "listed" ? t({ en: "Listed", zh: "已上架" }) : st === "pending" ? t({ en: "Under review", zh: "审核中" }) : t({ en: "Offline", zh: "未上架" })
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                            {label}
                          </span>
                        )
                      })()}
                      {b.deletion_status === "deleted" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                          {t({ en: "Deleted (pending settlement)", zh: "已删除（待结账）" })}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          b.status === "online" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${b.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
                        {b.status === "online" ? t({ en: "Online", zh: "在线" }) : t({ en: "Offline", zh: "离线" })}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                      <span className="text-gray-400">{t({ en: "Backend", zh: "后端" })}</span>
                      <span className="text-gray-700 font-mono">{b.name}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">{b.mode === "tunnel" ? t({ en: "Tunnel", zh: "隧道" }) : t({ en: "Direct", zh: "直连" })}</span>
                      {Object.entries(b.tags || {}).map(([k, v]) => (
                        <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-accent-soft text-fg border border-line">
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                  {idx === 0 && !b.deletion_status && (() => {
                    const st = b.listing_status || (b.enabled ? "listed" : "offline")
                    const canApply = st === "offline"
                    const canTakedown = st === "listed" || st === "pending"
                    const canDelete = st === "offline"
                    const btn = "px-2 h-7 flex items-center text-xs rounded border transition-colors"
                    const ghost = "border-line text-gray-600 bg-white hover:bg-accent-soft hover:text-fg hover:border-line-strong"
                    const danger = "border-red-300 text-red-600 bg-white hover:bg-red-50 hover:border-red-400"
                    const primary = "border-fg bg-fg text-white hover:bg-fg/90"
                    const dis = "border-line text-gray-300 bg-gray-50 cursor-not-allowed hover:bg-gray-50"
                    return (
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.preventDefault()}>
                        <button
                          disabled={!!checking[b.name]}
                          onClick={(e) => { e.preventDefault(); checkBackend(b.name) }}
                          className={`${btn} ${checking[b.name] ? "border-line text-gray-400 bg-gray-50 cursor-wait" : ghost}`}
                          title={t({ en: "Run a health check against this backend now", zh: "立即向后端发起一次健康检查" })}
                        >
                          {checking[b.name] ? t({ en: "Checking...", zh: "检查中…" }) : t({ en: "Health check", zh: "在线检查" })}
                        </button>
                        <button
                          disabled={!canApply}
                          onClick={(e) => { e.preventDefault(); if (canApply) toggleBackend(b.name) }}
                          className={`${btn} ${canApply ? primary : dis}`}
                        >
                          {t({ en: "Request listing", zh: "申请上架" })}
                        </button>
                        <button
                          disabled={!canTakedown}
                          onClick={(e) => { e.preventDefault(); if (canTakedown) toggleBackend(b.name) }}
                          className={`${btn} ${canTakedown ? ghost : dis}`}
                          title={st === "pending" ? t({ en: "Taking down withdraws this listing request", zh: "下架将撤回本次上架申请" }) : undefined}
                        >
                          {t({ en: "Take down", zh: "下架" })}
                        </button>
                        <button
                          disabled={!canDelete}
                          onClick={(e) => { e.preventDefault(); if (canDelete) deleteBackend(b.name) }}
                          className={`${btn} ${canDelete ? danger : dis}`}
                          title={!canDelete ? t({ en: "Take down before deleting", zh: "请先下架后再删除" }) : undefined}
                        >
                          {t({ en: "Delete", zh: "删除" })}
                        </button>
                      </div>
                    )
                  })()}
                </div>

                {b.listing_status === "offline" && b.review_note && idx === 0 && (
                  <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-line">
                    {t({ en: `Rejection reason: ${b.review_note}`, zh: `驳回原因：${b.review_note}` })}
                  </div>
                )}

                {/* Stats */}
                {m ? (
                  <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2 text-sm">
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Input price", zh: "输入价" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{sym}{b.input_price ?? "-"}<span className="text-[11px] font-normal text-gray-500">/M</span></div>
                      {b.pending_input_price != null && (
                        <div className="text-[10px] text-amber-600 mt-0.5">{t({ en: `Tomorrow ${psym}${b.pending_input_price}`, zh: `次日 ${psym}${b.pending_input_price}` })}</div>
                      )}
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Output price", zh: "输出价" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{sym}{b.output_price ?? "-"}<span className="text-[11px] font-normal text-gray-500">/M</span></div>
                      {b.pending_output_price != null && (
                        <div className="text-[10px] text-amber-600 mt-0.5">{t({ en: `Tomorrow ${psym}${b.pending_output_price}`, zh: `次日 ${psym}${b.pending_output_price}` })}</div>
                      )}
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Cache price", zh: "缓存价" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{b.cache_price != null ? `${sym}${b.cache_price}` : "—"}<span className="text-[11px] font-normal text-gray-500">/M</span></div>
                      {b.pending_cache_price != null && (
                        <div className="text-[10px] text-amber-600 mt-0.5">{t({ en: `Tomorrow ${psym}${b.pending_cache_price}`, zh: `次日 ${psym}${b.pending_cache_price}` })}</div>
                      )}
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Subscribers", zh: "订阅数" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{s?.subscribers ?? 0}</div>
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Requests this month", zh: "本月请求" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{(s?.requests ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Input this month", zh: "本月输入" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{formatTokens(s?.input_tokens ?? 0)}</div>
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Output this month", zh: "本月输出" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{formatTokens(s?.output_tokens ?? 0)}</div>
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">
                        {t({ en: "Cached this month", zh: "本月缓存" })}
                        {(s?.input_tokens ?? 0) > 0 && (
                          <span className="ml-1 text-gray-400">{(((s?.cached_tokens ?? 0) / (s?.input_tokens ?? 1)) * 100).toFixed(0)}%</span>
                        )}
                      </div>
                      <div className="font-semibold text-gray-900 mt-0.5">{formatTokens(s?.cached_tokens ?? 0)}</div>
                    </div>
                    <div className="rounded bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{t({ en: "Expected revenue this month", zh: "本月预期收入" })}</div>
                      <div className="font-semibold text-gray-900 mt-0.5">{sym}{(s?.cost ?? 0).toFixed(6)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-6 text-center text-sm text-gray-400">{t({ en: "No model set", zh: "未设置模型" })}</div>
                )}
              </Link>
            )
          })
          }
          const activeBackends = backends.filter((b) => !b.deletion_status)
          const deletedBackends = backends.filter((b) => b.deletion_status === "deleted")
          return (
            <>
              {activeBackends.flatMap(renderRowsForBackend)}
              {deletedBackends.length > 0 && (
                <details className="mt-2 group">
                  <summary className="cursor-pointer select-none text-sm text-gray-600 hover:text-gray-900 py-2 px-1 flex items-center gap-2">
                    <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                    <span>{t({ en: `Deleted services (${deletedBackends.length}, archived after next settlement)`, zh: `已删除服务（${deletedBackends.length}，下次结账后归档）` })}</span>
                  </summary>
                  <div className="space-y-3 mt-2">
                    {deletedBackends.flatMap(renderRowsForBackend)}
                  </div>
                </details>
              )}
            </>
          )
        })()}
        {backends.length === 0 && <div className="text-center py-12 text-gray-500">{t({ en: "No registered backends yet", zh: "暂无注册的后端服务" })}</div>}
      </div>

      {tunnelNoticeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setTunnelNoticeOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{t({ en: "Tunnel mode is not supported in the web form", zh: "隧道模式暂不支持网页注册" })}</h3>
                <p className="text-sm text-gray-500 mt-1">{t({ en: "Please register from the provider machine using the client CLI.", zh: "请在提供方机器上通过客户端命令行注册。" })}</p>
              </div>
              <button onClick={() => setTunnelNoticeOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="rounded-lg bg-gray-900 text-gray-100 text-xs font-mono p-4 overflow-x-auto mb-3">
              <pre className="whitespace-pre">{`python tunnel_client.py \\
  --gateway wss://llm.jours.art/ws/tunnel \\
  --token sk-${t({ en: "YOUR-API-KEY", zh: "你的API-Key" })} \\
  --backend-name ${t({ en: "backend-name", zh: "后端名称" })} \\
  --local-url http://localhost:8000`}</pre>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Link href="/docs#tunnel" target="_blank" className="text-sm text-fg hover:text-fg font-medium">
                {t({ en: "View full onboarding docs →", zh: "查看完整接入文档 →" })}
              </Link>
              <button
                onClick={() => { setTunnelNoticeOpen(false); setForm((f) => ({ ...f, mode: "direct" })) }}
                className="px-4 py-1.5 rounded-md bg-fg text-white text-sm hover:bg-fg/90"
              >
                {t({ en: "Switch back to Direct", zh: "切回直连" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
