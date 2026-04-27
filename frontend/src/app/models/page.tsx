"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"

interface Model {
  id: string
  backend_id: number
  backend: string
  provider: string
  status: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  currency: string
}

interface SubInfo {
  id: number
  model: string
  backend_id: number
  sub_key: string
  is_owned?: boolean
}

const MODEL_FAMILIES = ["Qwen", "THUDM", "deepseek-ai"]

export default function ModelsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [models, setModels] = useState<Model[]>([])
  const [search, setSearch] = useState("")
  const [familyFilter, setFamilyFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("online")
  const [subs, setSubs] = useState<SubInfo[]>([])
  const [subLoading, setSubLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleCard = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  useEffect(() => {
    apiFetch("/api/models")
      .then((data) => {
        if (Array.isArray(data)) setModels(data)
        else console.error("[models] unexpected response", data)
      })
      .catch((e) => console.error("[models] fetch failed", e))
  }, [])

  useEffect(() => {
    if (!user) { setSubs([]); return }
    apiFetch("/api/subscriptions")
      .then((list: any[]) => setSubs(list.filter((s) => s.is_active).map((s) => ({ id: s.id, model: s.model, backend_id: s.backend_id, sub_key: s.sub_key, is_owned: !!s.is_owned }))))
      .catch(() => {})
  }, [user])

  const isSubscribed = (m: Model) => subs.some((s) => s.model === m.id && s.backend_id === m.backend_id)
  const getSubKey = (m: Model) => subs.find((s) => s.model === m.id && s.backend_id === m.backend_id)?.sub_key
  const isOwned = (m: Model) => !!subs.find((s) => s.model === m.id && s.backend_id === m.backend_id)?.is_owned

  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

  const copyApi = (e: React.MouseEvent, m: Model) => {
    e.preventDefault()
    e.stopPropagation()
    const key = getSubKey(m)
    if (!key) return
    const url = `${baseUrl}/s/${key}/v1/chat/completions`
    navigator.clipboard.writeText(url)
    setCopied(`${m.backend_id}-${m.id}`)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSubscribe = async (e: React.MouseEvent, m: Model) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) { router.push("/login"); return }
    const key = `${m.backend_id}-${m.id}`
    setSubLoading(key)
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.id, backend_id: m.backend_id }),
      })
      setSubs((prev) => [...prev, { id: res.id, model: m.id, backend_id: m.backend_id, sub_key: res.sub_key }])
    } catch {}
    setSubLoading(null)
  }

  const handleUnsubscribe = async (e: React.MouseEvent, m: Model) => {
    e.preventDefault()
    e.stopPropagation()
    const sub = subs.find((s) => s.model === m.id && s.backend_id === m.backend_id)
    if (!sub) return
    const key = `${m.backend_id}-${m.id}`
    setSubLoading(key)
    try {
      await apiFetch(`/api/subscriptions/${sub.id}`, { method: "DELETE" })
      setSubs((prev) => prev.filter((s) => s.id !== sub.id))
    } catch {}
    setSubLoading(null)
  }

  const filtered = models.filter((m) => {
    if (familyFilter !== "all") {
      const family = m.id.includes("/") ? m.id.split("/")[0] : ""
      if (family !== familyFilter) return false
    }
    if (statusFilter !== "all" && m.status !== statusFilter) return false
    if (search && !m.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm divide-y divide-gray-100">
        <div className="flex items-center gap-4 px-5 py-3.5">
          <span className="text-sm font-medium text-gray-400 shrink-0 w-16">模型类别</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFamilyFilter("all")}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${familyFilter === "all" ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
            >
              全部
            </button>
            {MODEL_FAMILIES.map((f) => (
              <button
                key={f}
                onClick={() => setFamilyFilter(f)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${familyFilter === f ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 px-5 py-3.5">
          <span className="text-sm font-medium text-gray-400 shrink-0 w-16">在线状态</span>
          <div className="flex items-center gap-2">
            {(["all", "online", "offline"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-all ${
                  statusFilter === s
                    ? s === "online" ? "bg-emerald-600 text-white shadow-sm"
                    : s === "offline" ? "bg-rose-500 text-white shadow-sm"
                    : "bg-indigo-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {s !== "all" && <span className={`w-2 h-2 rounded-full ${statusFilter === s ? "bg-white" : "bg-gray-400"}`} />}
                {s === "all" ? "全部" : s === "online" ? "在线" : "离线"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="输入模型名称搜索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200/80 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 focus:outline-none text-sm transition-shadow"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <svg className="mx-auto w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {models.length === 0 ? "暂无在线模型，等待提供者注册服务" : "未找到匹配的模型"}
        </div>
      ) : (() => {
        // 按 model.id 分组：一张卡 = 一个模型，下面列出多个 backend
        const groupOrder: string[] = []
        const buckets = new Map<string, Model[]>()
        filtered.forEach((m) => {
          if (!buckets.has(m.id)) { groupOrder.push(m.id); buckets.set(m.id, []) }
          buckets.get(m.id)!.push(m)
        })
        return (
          <div className="space-y-4">
            {groupOrder.map((modelId) => {
              const rows = buckets.get(modelId)!
              const isCollapsed = collapsed.has(modelId)
              const anyOnline = rows.some((r) => r.status === "online")
              return (
                <div key={modelId} className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleCard(modelId)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 rounded-xl text-left"
                  >
                    <span className={`shrink-0 inline-block text-gray-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
                    <span className="font-semibold text-lg text-gray-900 break-all flex-1">{modelId}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${anyOnline ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${anyOnline ? "bg-emerald-500" : "bg-red-400"}`} />
                      {anyOnline ? "在线" : "离线"}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                      {rows.length} 个服务
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className={`px-5 pb-4 ${rows.length > 1 ? "" : ""}`}>
                      <div className={rows.length > 1 ? "divide-y divide-gray-100 border border-gray-100 rounded" : ""}>
                        {rows.map((m) => {
                          const rowKey = `${m.backend_id}-${m.id}`
                          const subscribed = isSubscribed(m)
                          const owned = isOwned(m)
                          return (
                            <div key={rowKey} className={`${rows.length > 1 ? "px-3 py-3" : "py-2"} flex items-center justify-between flex-wrap gap-3`}>
                              <div className="flex items-center gap-3 flex-wrap text-sm min-w-0">
                                <Link
                                  href={`/models/${m.backend_id}/${m.id}`}
                                  className="inline-flex items-center gap-1 text-gray-700 hover:text-indigo-600"
                                  title={`后端：${m.backend}（点击查看详情）`}
                                >
                                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
                                  <span className="font-medium">{m.backend}</span>
                                </Link>
                                <span className="inline-flex items-center gap-1 text-gray-600" title={`提供者：${m.provider || "共享"}`}>
                                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                  <span>{m.provider || "共享"}</span>
                                </span>
                                {m.input_price != null && (
                                  <span className="inline-flex items-center gap-1 text-gray-600" title="价格（输入 / 输出，每 1M tokens）">
                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {m.input_price === 0 && m.output_price === 0 ? (
                                      <span className="text-emerald-600 font-semibold">Free</span>
                                    ) : (
                                      <span>{m.currency === "USD" ? "$" : "¥"}{m.input_price}/M · {m.currency === "USD" ? "$" : "¥"}{m.output_price}/M <span className="text-[10px] text-gray-400">{m.currency || "CNY"}</span></span>
                                    )}
                                  </span>
                                )}
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${m.status === "online" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"}`}>
                                  <span className={`w-1 h-1 rounded-full ${m.status === "online" ? "bg-emerald-500" : "bg-red-400"}`} />
                                  {m.status === "online" ? "在线" : "离线"}
                                </span>
                                {Object.entries(m.tags || {}).map(([k, v]) => (
                                  <span key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-600">
                                    {v}
                                  </span>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                {subscribed ? (
                                  owned ? (
                                    <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 bg-gray-100" title="自己注册的模型服务，无法取消订阅">
                                      自动订阅
                                    </span>
                                  ) : (
                                    <button
                                      onClick={(e) => handleUnsubscribe(e, m)}
                                      disabled={subLoading === rowKey}
                                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                                    >
                                      {subLoading === rowKey ? "..." : "取消订阅"}
                                    </button>
                                  )
                                ) : (
                                  <button
                                    onClick={(e) => handleSubscribe(e, m)}
                                    disabled={subLoading === rowKey || m.status !== "online"}
                                    className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                  >
                                    {subLoading === rowKey ? "处理中..." : "订阅"}
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}
