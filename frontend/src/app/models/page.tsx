"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { useT } from "@/context/LocaleContext"
import { tagLabel, capabilityLabel } from "@/lib/labels"

interface Model {
  id: string
  backend_id: number
  backend: string
  provider: string
  status: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  cache_price?: number | null
  currency: string
  capabilities?: string[]
  context_length?: number | null
}

interface SubInfo {
  id: number
  model: string
  backend_id: number
  is_owned?: boolean
}

const MODEL_FAMILIES = ["Qwen", "THUDM", "deepseek-ai"]

function fmtPrice(n: number) {
  if (n === 0) return "0.00"
  if (n < 0.01) return n.toFixed(4)
  if (n < 1) return n.toFixed(3)
  return n.toFixed(2)
}

function symbolFor(currency: string) {
  return "$"
}

function copy(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

export default function ModelsPage() {
  const t = useT()
  const { user } = useAuth()
  const router = useRouter()

  const [models, setModels] = useState<Model[]>([])
  const [search, setSearch] = useState("")
  const [familyFilter, setFamilyFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("online")
  const [subs, setSubs] = useState<SubInfo[]>([])
  const [subLoading, setSubLoading] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(true)
  const [view, setView] = useState<"table" | "grid">("table")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<"provider" | "id" | "input" | "output" | "cache">("id")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    apiFetch("/api/models")
      .then((data) => {
        if (Array.isArray(data)) setModels(data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) { setSubs([]); return }
    apiFetch("/api/subscriptions")
      .then((list: SubInfo[]) =>
        setSubs(
          (list || []).filter((s: SubInfo & { is_active?: boolean }) => (s as { is_active?: boolean }).is_active)
            .map((s) => ({ id: s.id, model: s.model, backend_id: s.backend_id, is_owned: !!s.is_owned })),
        ),
      )
      .catch(() => {})
  }, [user])

  const isSubscribed = (m: Model) => subs.some((s) => s.model === m.id && s.backend_id === m.backend_id)
  const isOwned = (m: Model) => !!subs.find((s) => s.model === m.id && s.backend_id === m.backend_id)?.is_owned

  const handleSubscribe = async (e: React.MouseEvent, m: Model) => {
    e.preventDefault(); e.stopPropagation()
    if (!user) { router.push("/login"); return }
    const key = `${m.backend_id}-${m.id}`
    setSubLoading(key)
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.id, backend_id: m.backend_id }),
      })
      setSubs((prev) => [...prev, { id: res.id, model: m.id, backend_id: m.backend_id }])
    } catch {}
    setSubLoading(null)
  }

  const handleUnsubscribe = async (e: React.MouseEvent, m: Model) => {
    e.preventDefault(); e.stopPropagation()
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

  const filtered = useMemo(() => {
    return models.filter((m) => {
      if (familyFilter !== "all") {
        const family = m.id.includes("/") ? m.id.split("/")[0] : ""
        if (family !== familyFilter) return false
      }
      if (statusFilter !== "all" && m.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!m.id.toLowerCase().includes(q) && !(m.provider || "").toLowerCase().includes(q) && !(m.backend || "").toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [models, familyFilter, statusFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === "asc" ? 1 : -1
    arr.sort((a, b) => {
      let av: string | number = ""
      let bv: string | number = ""
      switch (sortKey) {
        case "provider": av = (a.provider || "").toLowerCase(); bv = (b.provider || "").toLowerCase(); break
        case "id": av = a.id.toLowerCase(); bv = b.id.toLowerCase(); break
        case "input": av = a.input_price ?? Number.POSITIVE_INFINITY; bv = b.input_price ?? Number.POSITIVE_INFINITY; break
        case "output": av = a.output_price ?? Number.POSITIVE_INFINITY; bv = b.output_price ?? Number.POSITIVE_INFINITY; break
        case "cache": av = a.cache_price ?? Number.POSITIVE_INFINITY; bv = b.cache_price ?? Number.POSITIVE_INFINITY; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const stats = useMemo(() => {
    const uniqueModels = new Set(models.map((m) => m.id))
    const uniqueProviders = new Set(models.map((m) => m.provider).filter(Boolean))
    const onlineBackends = models.filter((m) => m.status === "online").length
    const freeModels = new Set(
      models.filter((m) => (m.input_price ?? -1) === 0 && (m.output_price ?? -1) === 0).map((m) => m.id),
    )
    return {
      models: uniqueModels.size,
      providers: uniqueProviders.size,
      online: onlineBackends,
      free: freeModels.size,
      backends: models.length,
    }
  }, [models])

  const toggleSort = (key: typeof sortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  const SortIcon = ({ active }: { active: boolean }) => (
    <span className={`ml-1 text-[10px] ${active ? "text-fg" : "text-fg-subtle"}`}>
      {active ? (sortDir === "asc" ? "↑" : "↓") : "↑↓"}
    </span>
  )

  const handleCopy = (id: string) => {
    copy(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
  }

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">{t({ en: "Models", zh: "模型广场" })}</h1>
          <p className="text-sm text-fg-muted mt-1">
            {t({ en: "Comprehensive list of all supported models and their providers", zh: "所有受支持模型与提供者的总览" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-line bg-surface text-sm font-medium text-fg hover:bg-bg/60"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7v7m0-7L10 14M5 5h6m-6 4h6m-6 4h6m-6 4h6" /></svg>
            {t({ en: "API Docs", zh: "API 文档" })}
          </Link>
        </div>
      </div>

      {/* ── Search + Filter toggle ──────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder={t({ en: "Search models...", zh: "搜索模型..." })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 h-9 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40 text-sm placeholder:text-fg-subtle"
          />
        </div>
        <button
          onClick={() => setShowFilters((s) => !s)}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium ${showFilters ? "border-fg bg-fg text-accent-fg" : "border-line bg-surface text-fg hover:bg-bg/60"}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
          {t({ en: "Filters", zh: "筛选" })}
        </button>
      </div>

      {showFilters && (
        <div className="bg-surface rounded-xl border border-line">
          <div className="flex items-center gap-4 px-5 py-3">
            <span className="text-xs font-medium text-fg-subtle shrink-0 w-16 uppercase tracking-wider">{t({ en: "Family", zh: "类别" })}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFamilyFilter("all")}
                className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${familyFilter === "all" ? "bg-fg text-accent-fg" : "bg-accent-soft text-fg-muted hover:text-fg"}`}
              >{t({ en: "All", zh: "全部" })}</button>
              {MODEL_FAMILIES.map((f) => (
                <button
                  key={f}
                  onClick={() => setFamilyFilter(f)}
                  className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${familyFilter === f ? "bg-fg text-accent-fg" : "bg-accent-soft text-fg-muted hover:text-fg"}`}
                >{f}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4 px-5 py-3 border-t border-line">
            <span className="text-xs font-medium text-fg-subtle shrink-0 w-16 uppercase tracking-wider">{t({ en: "Status", zh: "状态" })}</span>
            <div className="flex items-center gap-1.5">
              {(["all", "online", "offline"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium transition-colors ${statusFilter === s ? "bg-fg text-accent-fg" : "bg-accent-soft text-fg-muted hover:text-fg"}`}
                >
                  {s !== "all" && <span className={`w-1.5 h-1.5 rounded-full ${s === "online" ? "bg-success" : "bg-danger"}`} />}
                  {s === "all" ? t({ en: "All", zh: "全部" }) : s === "online" ? t({ en: "Online", zh: "在线" }) : t({ en: "Offline", zh: "离线" })}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Stats cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { v: stats.models, l: t({ en: "Models", zh: "模型数" }) },
          { v: stats.providers, l: t({ en: "Providers", zh: "提供者数" }) },
          { v: stats.online, l: t({ en: "Online services", zh: "在线服务" }) },
          { v: stats.free, l: t({ en: "Free Models", zh: "免费模型" }) },
          { v: stats.backends, l: t({ en: "Total backends", zh: "服务总数" }) },
        ].map((c) => (
          <div key={c.l} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-xl font-bold text-fg">{c.v}</div>
            <div className="text-xs text-fg-muted mt-0.5">{c.l}</div>
          </div>
        ))}
      </div>

      {/* ── View toggle ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5 w-fit">
        {(["table", "grid"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium ${view === v ? "bg-fg text-accent-fg" : "text-fg-muted hover:text-fg"}`}
          >
            {v === "table" ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M3 12h18M3 18h18" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            )}
            {v === "table" ? t({ en: "Table", zh: "表格" }) : t({ en: "Grid", zh: "网格" })}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-20 text-fg-muted">
          {models.length === 0
            ? t({ en: "No online models yet — waiting for providers to register services.", zh: "暂无在线模型，等待提供者注册服务" })
            : t({ en: "No matching models", zh: "未找到匹配的模型" })}
        </div>
      ) : view === "table" ? (
        <TableView
          rows={sorted}
          isSubscribed={isSubscribed}
          isOwned={isOwned}
          subLoading={subLoading}
          onSubscribe={handleSubscribe}
          onUnsubscribe={handleUnsubscribe}
          copiedId={copiedId}
          onCopy={handleCopy}
          sortKey={sortKey}
          sortDir={sortDir}
          toggleSort={toggleSort}
          SortIcon={SortIcon}
          t={t}
        />
      ) : (
        <GridView
          rows={sorted}
          isSubscribed={isSubscribed}
          isOwned={isOwned}
          subLoading={subLoading}
          onSubscribe={handleSubscribe}
          onUnsubscribe={handleUnsubscribe}
          t={t}
        />
      )}
    </div>
  )
}

// ── Table view ──────────────────────────────────────────────────────────
type TFn = ReturnType<typeof useT>
interface ViewProps {
  rows: Model[]
  isSubscribed: (m: Model) => boolean
  isOwned: (m: Model) => boolean
  subLoading: string | null
  onSubscribe: (e: React.MouseEvent, m: Model) => void
  onUnsubscribe: (e: React.MouseEvent, m: Model) => void
  t: TFn
}
interface TableViewProps extends ViewProps {
  copiedId: string | null
  onCopy: (id: string) => void
  sortKey: "provider" | "id" | "input" | "output" | "cache"
  sortDir: "asc" | "desc"
  toggleSort: (k: "provider" | "id" | "input" | "output" | "cache") => void
  SortIcon: (props: { active: boolean }) => React.ReactNode
}

function TableView({ rows, isSubscribed, isOwned, subLoading, onSubscribe, onUnsubscribe, copiedId, onCopy, sortKey, toggleSort, SortIcon, t }: TableViewProps) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-fg-subtle border-b border-line bg-bg/40">
              <th className="px-4 py-2.5 font-medium">
                <button onClick={() => toggleSort("provider")} className="inline-flex items-center hover:text-fg">
                  {t({ en: "Provider", zh: "提供者" })}<SortIcon active={sortKey === "provider"} />
                </button>
              </th>
              <th className="px-4 py-2.5 font-medium">
                <button onClick={() => toggleSort("id")} className="inline-flex items-center hover:text-fg">
                  {t({ en: "Model ID", zh: "模型 ID" })}<SortIcon active={sortKey === "id"} />
                </button>
              </th>
              <th className="px-4 py-2.5 font-medium text-right">
                <button onClick={() => toggleSort("input")} className="inline-flex items-center hover:text-fg">
                  {t({ en: "Input /M", zh: "输入 /M" })}<SortIcon active={sortKey === "input"} />
                </button>
              </th>
              <th className="px-4 py-2.5 font-medium text-right">
                <button onClick={() => toggleSort("output")} className="inline-flex items-center hover:text-fg">
                  {t({ en: "Output /M", zh: "输出 /M" })}<SortIcon active={sortKey === "output"} />
                </button>
              </th>
              <th className="px-4 py-2.5 font-medium text-right">
                <button onClick={() => toggleSort("cache")} className="inline-flex items-center hover:text-fg">
                  {t({ en: "Cache /M", zh: "缓存 /M" })}<SortIcon active={sortKey === "cache"} />
                </button>
              </th>
              <th className="px-4 py-2.5 font-medium">{t({ en: "Features", zh: "特性" })}</th>
              <th className="px-4 py-2.5 font-medium text-right">{t({ en: "Action", zh: "操作" })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => {
              const sym = symbolFor(m.currency)
              const rowKey = `${m.backend_id}-${m.id}`
              const subscribed = isSubscribed(m)
              const owned = isOwned(m)
              const isFree = (m.input_price ?? -1) === 0 && (m.output_price ?? -1) === 0
              const cache = m.cache_price ?? (m.input_price != null ? m.input_price * 0.1 : null)
              return (
                <tr key={rowKey} className="hover:bg-bg/40">
                  {/* Provider */}
                  <td className="px-4 py-3 align-middle">
                    <Link
                      href={`/models/${m.id}?backend_id=${m.backend_id}`}
                      className="inline-flex items-center gap-2 text-fg hover:underline"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.status === "online" ? "bg-emerald-500" : "bg-red-400"}`} />
                      <span className="font-medium">{m.provider || t({ en: "shared", zh: "共享" })}</span>
                      <svg className="w-3 h-3 text-fg-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7v7m0-7L10 14M5 5h6m-6 4h6m-6 4h6m-6 4h6" /></svg>
                    </Link>
                  </td>
                  {/* Model ID */}
                  <td className="px-4 py-3 align-middle">
                    <div className="inline-flex items-center gap-1.5">
                      <Link href={`/models/${m.id}`} className="font-mono text-[13px] text-fg hover:underline break-all">
                        {m.id}
                      </Link>
                      <button
                        onClick={() => onCopy(m.id)}
                        title={t({ en: "Copy model ID", zh: "复制模型 ID" })}
                        className="text-fg-subtle hover:text-fg"
                      >
                        {copiedId === m.id ? (
                          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" /></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        )}
                      </button>
                    </div>
                  </td>
                  {/* Input */}
                  <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                    {m.input_price == null ? <span className="text-fg-subtle">—</span>
                      : isFree ? <span className="text-emerald-600 font-medium">Free</span>
                      : <span className="text-fg">{sym}{fmtPrice(m.input_price)}</span>}
                  </td>
                  {/* Output */}
                  <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                    {m.output_price == null ? <span className="text-fg-subtle">—</span>
                      : isFree ? <span className="text-emerald-600 font-medium">Free</span>
                      : <span className="text-fg">{sym}{fmtPrice(m.output_price)}</span>}
                  </td>
                  {/* Cache */}
                  <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                    {cache == null ? <span className="text-fg-subtle">—</span>
                      : <span className="text-fg-muted">{sym}{fmtPrice(cache)}</span>}
                  </td>
                  {/* Features */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-1 flex-wrap">
                      {Object.values(m.tags || {}).map((v) => (
                        <span key={v} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-soft text-fg-muted">{t(tagLabel(v))}</span>
                      ))}
                      {(m.capabilities || []).slice(0, 3).map((c) => (
                        <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">{t(capabilityLabel(c))}</span>
                      ))}
                    </div>
                  </td>
                  {/* Action */}
                  <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                    {subscribed ? (
                      owned ? (
                        <span className="text-xs text-fg-subtle" title={t({ en: "Auto-subscribed", zh: "自动订阅" })}>
                          {t({ en: "Owned", zh: "自有" })}
                        </span>
                      ) : (
                        <button
                          onClick={(e) => onUnsubscribe(e, m)}
                          disabled={subLoading === rowKey}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                        >
                          {subLoading === rowKey ? "..." : t({ en: "Unsubscribe", zh: "取消订阅" })}
                        </button>
                      )
                    ) : (
                      <button
                        onClick={(e) => onSubscribe(e, m)}
                        disabled={subLoading === rowKey || m.status !== "online"}
                        className="px-3 py-1 rounded-md text-xs font-medium text-accent-fg bg-fg hover:bg-fg/90 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {subLoading === rowKey ? "..." : t({ en: "Subscribe", zh: "订阅" })}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Grid view ───────────────────────────────────────────────────────────
function GridView({ rows, isSubscribed, isOwned, subLoading, onSubscribe, onUnsubscribe, t }: ViewProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((m) => {
        const sym = symbolFor(m.currency)
        const rowKey = `${m.backend_id}-${m.id}`
        const subscribed = isSubscribed(m)
        const owned = isOwned(m)
        const isFree = (m.input_price ?? -1) === 0 && (m.output_price ?? -1) === 0
        return (
          <Link
            key={rowKey}
            href={`/models/${m.id}?backend_id=${m.backend_id}`}
            className="rounded-xl border border-line bg-surface p-4 hover:border-fg/40 transition-colors flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${m.status === "online" ? "bg-emerald-500" : "bg-red-400"}`} />
              <span className="font-medium text-fg">{m.provider || t({ en: "shared", zh: "共享" })}</span>
              {isFree && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">FREE</span>}
            </div>
            <div className="font-mono text-[12px] text-fg-muted break-all">{m.id}</div>
            <div className="grid grid-cols-3 gap-2 text-center bg-bg/60 rounded-lg p-2 mt-1">
              <div>
                <div className="text-[10px] uppercase text-fg-subtle">In</div>
                <div className="text-sm font-semibold text-fg">{m.input_price == null ? "—" : `${sym}${fmtPrice(m.input_price)}`}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-fg-subtle">Out</div>
                <div className="text-sm font-semibold text-fg">{m.output_price == null ? "—" : `${sym}${fmtPrice(m.output_price)}`}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-fg-subtle">Cache</div>
                <div className="text-sm font-semibold text-fg-muted">
                  {m.cache_price != null ? `${sym}${fmtPrice(m.cache_price)}` : (m.input_price != null ? `${sym}${fmtPrice(m.input_price * 0.1)}` : "—")}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-1 flex-wrap">
                {Object.values(m.tags || {}).map((v) => (
                  <span key={v} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-soft text-fg-muted">{t(tagLabel(v))}</span>
                ))}
              </div>
              {subscribed ? (
                owned ? (
                  <span className="text-xs text-fg-subtle">{t({ en: "Owned", zh: "自有" })}</span>
                ) : (
                  <button
                    onClick={(e) => onUnsubscribe(e, m)}
                    disabled={subLoading === rowKey}
                    className="px-2.5 py-1 rounded-md text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                  >
                    {subLoading === rowKey ? "..." : t({ en: "Unsubscribe", zh: "取消订阅" })}
                  </button>
                )
              ) : (
                <button
                  onClick={(e) => onSubscribe(e, m)}
                  disabled={subLoading === rowKey || m.status !== "online"}
                  className="px-3 py-1 rounded-md text-xs font-medium text-accent-fg bg-fg hover:bg-fg/90 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {subLoading === rowKey ? "..." : t({ en: "Subscribe", zh: "订阅" })}
                </button>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
