"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

interface Backend {
  id: number
  name: string
  url: string | null
  mode: string
  models: string[]
  tags: Record<string, string>
  status: string
  enabled: number
  input_price: number | null
  output_price: number | null
  is_public: number
  owner_name: string
  updated_at: string
}

interface ModelStat {
  model: string
  subscribers: number
  requests: number
  input_tokens: number
  output_tokens: number
  cost: number
}

interface BackendStats {
  id: number
  name: string
  models: ModelStat[]
}

export default function ServicesPage() {
  const { user, refreshUser } = useAuth()
  const [backends, setBackends] = useState<Backend[]>([])
  const [statsMap, setStatsMap] = useState<Record<number, ModelStat[]>>({})
  const [showForm, setShowForm] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    url: "",
    mode: "direct",
    family: "",
    model: "",
    served_as: "",
    tag_hardware: "",
    tag_framework: "",
    tag_quantization: "",
    input_price: "",
    output_price: "",
  })
  const [families, setFamilies] = useState<string[]>([])
  const [catalog, setCatalog] = useState<Record<string, string[]>>({})

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
      alert("隧道模式请使用客户端注册，网页仅支持直连模式。")
      return
    }
    if (!form.family) {
      alert("请选择模型系列")
      return
    }
    if (!form.model) {
      alert("请选择一个模型")
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
          client_info,
        }),
      })
      setShowForm(false)
      setForm({ name: "", url: "", mode: "direct", family: "", model: "", served_as: "", tag_hardware: "", tag_framework: "", tag_quantization: "", input_price: "", output_price: "" })
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    }
  }

  const deleteBackend = async (name: string) => {
    if (!confirm(`确定要删除后端 "${name}" 吗？`)) return
    await apiFetch(`/api/backends/${name}`, { method: "DELETE" })
    loadBackends()
  }

  const toggleBackend = async (name: string) => {
    try {
      await apiFetch(`/api/backends/${name}/toggle`, { method: "PUT" })
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
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
      alert(err instanceof Error ? err.message : "操作失败")
    } finally {
      setUpgrading(false)
    }
  }

  if (!isProvider) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">我的服务</h1>
        <div className="bg-white rounded-lg border p-6">
          <h2 className="font-semibold mb-2">成为模型服务提供者</h2>
          <p className="text-sm text-gray-600 mb-4">激活提供者身份后，你可以注册自己的模型后端，将模型服务分享给其他用户。</p>
          <button
            onClick={handleUpgrade}
            disabled={upgrading}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {upgrading ? "激活中..." : "激活"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">我的服务</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
        >
          {showForm ? "取消" : "注册后端"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">后端名称</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">接入模式</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                  <option value="direct">直连（公网可达）</option>
                  <option value="tunnel">隧道（NAT 内网，需客户端注册）</option>
                </select>
                {form.mode === "tunnel" && (
                  <p className="mt-1 text-xs text-red-600">隧道模式不能在网页注册，请使用提供方客户端。</p>
                )}
              </div>
            </div>
            {form.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">后端 URL</label>
                <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://IP:PORT" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型系列</label>
              <select value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value, model: "" })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                <option value="">请选择模型系列</option>
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型</label>
              <select
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                required
                disabled={!form.family}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{form.family ? "请选择模型" : "请先选择模型系列"}</option>
                {(catalog[form.family] || []).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {form.family && form.model && (
                <p className="mt-1 text-xs text-gray-500">将保存为：{form.family}/{form.model}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                你的 URL 上的模型名（可选）
              </label>
              <input
                type="text"
                value={form.served_as}
                onChange={(e) => setForm({ ...form, served_as: e.target.value })}
                placeholder={form.model ? `默认用 ${form.model}` : "例如 qwen3-8b-awq"}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                仅直连模式需要。网关转发请求时，会把 OpenAI 请求的 model 字段改为此值后再传给你的服务。同一个 URL 可以用不同后端名注册多个模型（每个走不同的 served 名）。
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签（均为可选）</label>
              <div className="grid gap-3 md:grid-cols-3">
                <input type="text" value={form.tag_hardware} onChange={(e) => setForm({ ...form, tag_hardware: e.target.value })} placeholder="硬件，如 MI300X" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={form.tag_framework} onChange={(e) => setForm({ ...form, tag_framework: e.target.value })} placeholder="框架，如 vLLM" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={form.tag_quantization} onChange={(e) => setForm({ ...form, tag_quantization: e.target.value })} placeholder="量化，如 AWQ / FP16" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输入定价（元/百万token）</label>
                <input type="number" step="0.01" value={form.input_price} onChange={(e) => setForm({ ...form, input_price: e.target.value })} placeholder="默认" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输出定价（元/百万token）</label>
                <input type="number" step="0.01" value={form.output_price} onChange={(e) => setForm({ ...form, output_price: e.target.value })} placeholder="默认" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              注册后服务默认为 <b>未上架 · 私有</b>。请在详情页确认配置后点击「上架」，及选择是否「公开可见」。
            </div>
            <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700">提交</button>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {backends.map((b) => (
          <Link
            key={b.id}
            href={`/dashboard/services/${encodeURIComponent(b.name)}`}
            className={`block bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all overflow-hidden ${!b.enabled ? "opacity-60" : ""}`}
          >
            {/* Header */}
            <div className="flex justify-between items-start gap-4 px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50/50 to-transparent">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg text-gray-900 truncate">{b.name}</h3>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${b.enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-gray-100 text-gray-500 ring-1 ring-gray-200"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${b.enabled ? "bg-emerald-500" : "bg-gray-400"}`}></span>
                    {b.enabled ? "已上架" : "已下架"}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${b.status === "online" ? "bg-green-50 text-green-700 ring-1 ring-green-200" : "bg-red-50 text-red-700 ring-1 ring-red-200"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${b.status === "online" ? "bg-green-500 animate-pulse" : "bg-red-500"}`}></span>
                    {b.status}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-600 ring-1 ring-slate-200">
                    {b.mode === "tunnel" ? "隧道" : "直连"}
                  </span>
                  {!b.is_public && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">私有</span>
                  )}
                </div>
                {Object.keys(b.tags || {}).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {Object.entries(b.tags).map(([k, v]) => (
                      <span key={k} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
                <button
                  onClick={(e) => { e.preventDefault(); toggleBackend(b.name) }}
                  className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors ${b.enabled ? "bg-gray-100 text-gray-700 hover:bg-gray-200" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                >
                  {b.enabled ? "下架" : "上架"}
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); deleteBackend(b.name) }}
                  className="text-sm px-3 py-1.5 rounded-md font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>

            {/* Models */}
            {b.models.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {b.models.map((m) => {
                  const s = (statsMap[b.id] || []).find((x) => x.model === m)
                  return (
                    <div key={m} className="px-5 py-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">模型</span>
                          <code className="text-sm font-mono text-gray-800 truncate">{m}</code>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
                          <span>输入 <span className="font-semibold text-gray-900">¥{b.input_price ?? "-"}</span>/M</span>
                          <span className="text-gray-300">·</span>
                          <span>输出 <span className="font-semibold text-gray-900">¥{b.output_price ?? "-"}</span>/M</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <div className="text-[11px] text-gray-500">订阅数</div>
                          <div className="text-base font-semibold text-gray-900 mt-0.5">{s?.subscribers ?? 0}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <div className="text-[11px] text-gray-500">请求数</div>
                          <div className="text-base font-semibold text-gray-900 mt-0.5">{(s?.requests ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <div className="text-[11px] text-gray-500">输入 tokens</div>
                          <div className="text-base font-semibold text-gray-900 mt-0.5">{(s?.input_tokens ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <div className="text-[11px] text-gray-500">输出 tokens</div>
                          <div className="text-base font-semibold text-gray-900 mt-0.5">{(s?.output_tokens ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-100 col-span-2 sm:col-span-1">
                          <div className="text-[11px] text-emerald-700">预期收入</div>
                          <div className="text-base font-semibold text-emerald-900 mt-0.5">¥{(s?.cost ?? 0).toFixed(6)}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="px-5 py-6 text-center text-sm text-gray-400">未设置模型</div>
            )}
          </Link>
        ))}
        {backends.length === 0 && <div className="text-center py-12 text-gray-500">暂无注册的后端服务</div>}
      </div>
    </div>
  )
}
