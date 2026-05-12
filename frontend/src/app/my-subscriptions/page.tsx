"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface Sub {
  id: number
  backend_id: number
  model: string
  is_active: number
  is_activated?: number | boolean
  created_at: string
  backend: string
  backend_status: string
  input_price: number | null
  output_price: number | null
  cache_price?: number | null
  currency: string
  provider?: string | null
  is_owned?: number | boolean
}

export default function MyModelsPage() {
  const t = useT()
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [showActivated, setShowActivated] = useState(true)
  const [showInactive, setShowInactive] = useState(true)
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<number | null>(null)

  const toggleCard = (key: string) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const fetchAll = async () => {
    try {
      const subsRes = await apiFetch("/api/subscriptions")
      setSubs(subsRes)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const handleUnsubscribe = async (id: number) => {
    await apiFetch(`/api/subscriptions/${id}`, { method: "DELETE" })
    fetchAll()
  }

  const persistOrder = async (newActive: Sub[]) => {
    const inactive = subs.filter((s) => !s.is_active)
    const newSubs = [...newActive, ...inactive]
    setSubs(newSubs)
    try {
      await apiFetch("/api/subscriptions/reorder", {
        method: "PUT",
        body: JSON.stringify({ ids: newSubs.map((s) => s.id) }),
      })
    } catch {
      fetchAll()
    }
  }

  // 在同一个 model 卡片内、相邻的同 model 订阅之间换位
  const handleMoveInCard = (id: number, dir: -1 | 1) => {
    const active = subs.filter((s) => s.is_active)
    const idx = active.findIndex((s) => s.id === id)
    if (idx < 0) return
    const me = active[idx]
    // 找同 model 的前一个/后一个
    let neighborIdx = -1
    if (dir === -1) {
      for (let i = idx - 1; i >= 0; i--) if (active[i].model === me.model) { neighborIdx = i; break }
    } else {
      for (let i = idx + 1; i < active.length; i++) if (active[i].model === me.model) { neighborIdx = i; break }
    }
    if (neighborIdx < 0) return
    const reordered = [...active]
    ;[reordered[idx], reordered[neighborIdx]] = [reordered[neighborIdx], reordered[idx]]
    persistOrder(reordered)
  }

  // 整组（同 model）跟相邻组互换：把整组行从原位置抽出，插到目标组的位置
  const handleMoveGroup = (model: string, dir: -1 | 1) => {
    const active = subs.filter((s) => s.is_active)
    // 按出现顺序聚合 model -> 行
    const order: string[] = []
    const buckets = new Map<string, Sub[]>()
    active.forEach((s) => {
      if (!buckets.has(s.model)) { order.push(s.model); buckets.set(s.model, []) }
      buckets.get(s.model)!.push(s)
    })
    const gi = order.indexOf(model)
    if (gi < 0) return
    const newGi = gi + dir
    if (newGi < 0 || newGi >= order.length) return
    ;[order[gi], order[newGi]] = [order[newGi], order[gi]]
    const reordered: Sub[] = []
    order.forEach((m) => reordered.push(...buckets.get(m)!))
    persistOrder(reordered)
  }

  const handleToggleActivate = async (id: number, activated: boolean) => {
    setSaving(id)
    try {
      await apiFetch(`/api/subscriptions/${id}/activate`, {
        method: "PUT",
        body: JSON.stringify({ activated }),
      })
      setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, is_activated: activated ? 1 : 0 } : s)))
    } finally {
      setSaving(null)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(""), 2000)
  }

  const [baseUrl, setBaseUrl] = useState("")
  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])
  const unifiedUrl = `${baseUrl}/v1/chat/completions`
  const activatedSubs = subs.filter((s) => s.is_active && s.is_activated)

  if (loading) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>

  return (
    <div>
      <div className="bg-accent-soft border border-line rounded-lg p-5 mb-8">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-fg">{t({ en: "API endpoint", zh: "API 链接" })}</h2>
          {activatedSubs.length > 0 ? (
            <span className="text-xs text-fg">
              {t({ en: `${activatedSubs.length} activated service(s)`, zh: `已激活 ${activatedSubs.length} 个服务` })}
            </span>
          ) : (
            <span className="text-xs text-amber-600">{t({ en: "No subscriptions activated yet — click Activate below", zh: "尚未激活任何订阅，请在下方点击「激活」" })}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-white px-3 py-2 rounded text-xs font-mono text-gray-800 break-all border border-line">
            {unifiedUrl}
          </code>
          <button
            onClick={() => copyToClipboard(unifiedUrl, "unified")}
            className="shrink-0 px-3 py-2 text-xs bg-fg hover:bg-fg/90 text-white rounded"
          >
            {copied === "unified" ? t({ en: "Copied", zh: "已复制" }) : t({ en: "Copy", zh: "复制" })}
          </button>
        </div>
        <div className="text-sm text-gray-700 mt-3 space-y-2 leading-relaxed">
          <p className="text-xs text-gray-700">
            {t({ en: "Call the URL above with ", zh: "用你" })}<span className="font-semibold">{t({ en: "your own API key", zh: "自己的 API Key" })}</span>{t({ en: "; routing is decided by the ", zh: "请求上方 URL，按请求体里 " })}<code className="font-mono bg-white px-1 rounded">model</code>{t({ en: " field in the request body:", zh: " 字段决定路由：" })}
          </p>
          <ul className="text-xs space-y-1.5">
            <li className="bg-white border border-line rounded px-3 py-2">
              <code className="font-mono font-semibold text-fg">"model": "Auto"</code>
              <span className="ml-2 text-gray-600">
                {t({ en: "Failover across ", zh: "在" })}<strong>{t({ en: "all activated subscriptions", zh: "所有已激活订阅" })}</strong>{t({ en: " by priority (top = highest; use Move up / Move down to reorder).", zh: "之间按优先级自动回退（越靠上优先级越高，可用「上移/下移」调整）" })}
              </span>
            </li>
            <li className="bg-white border border-line rounded px-3 py-2">
              <code className="font-mono font-semibold text-fg">"model": "&lt;model&gt;"</code>
              <span className="ml-2 text-gray-600">
                {t({ en: "e.g. ", zh: "例如 " })}<code className="font-mono">"Qwen/Qwen3-32B-AWQ"</code>{t({ en: " — failover only across backends of that model, ", zh: "，仅在该模型对应的多个后端之间回退，" })}<strong>{t({ en: "never", zh: "不" })}</strong>{t({ en: " across models.", zh: "跨模型" })}
              </span>
            </li>
            <li className="bg-white border border-line rounded px-3 py-2">
              <code className="font-mono font-semibold text-fg">"model": "&lt;model&gt;/&lt;backend_name&gt;"</code>
              <span className="ml-2 text-gray-600">
                {t({ en: "e.g. ", zh: "例如 " })}<code className="font-mono">"Qwen/Qwen3-32B-AWQ/vllm-qwen36-awq-45"</code>{t({ en: " — ", zh: "，" })}<strong>{t({ en: "locked", zh: "锁定" })}</strong>{t({ en: " to a single backend; no failover.", zh: "到这一个后端，不回退" })}
              </span>
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            {t({ en: "Pull the available model list via ", zh: "可用 model 列表也能通过 " })}<code className="font-mono">GET /v1/models</code>{t({ en: " (returns the three forms: Auto / model / model/backend).", zh: " 拉取（含 Auto / 模型名 / 模型名/后端名 三种形态）。" })}
          </p>
        </div>
      </div>

      {subs.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-4">{t({ en: "No subscriptions yet", zh: "暂无订阅模型" })}</p>
          <Link href="/models" className="text-fg hover:underline">{t({ en: "Browse the model catalog →", zh: "去模型广场看看 →" })}</Link>
        </div>
      ) : (
        <>
          {subs.filter((s) => s.is_active).length > 0 && (() => {
            const activeSubs = subs.filter((s) => s.is_active)
            // 计算每条订阅在"已激活订阅"里的全局优先级（用于徽章显示）
            const activatedRank = new Map<number, number>()
            let rank = 0
            activeSubs.forEach((s) => {
              if (s.is_activated) {
                rank += 1
                activatedRank.set(s.id, rank)
              }
            })
            // 按 model 分组，组的展示顺序 = 组内首条 sub 在 activeSubs 里的下标
            const groups: { model: string; rows: Sub[]; firstIdx: number }[] = []
            const groupIdx = new Map<string, number>()
            activeSubs.forEach((s, i) => {
              let g = groupIdx.get(s.model)
              if (g === undefined) {
                g = groups.length
                groupIdx.set(s.model, g)
                groups.push({ model: s.model, rows: [], firstIdx: i })
              }
              groups[g].rows.push(s)
            })
            groups.sort((a, b) => a.firstIdx - b.firstIdx)
            // 按行（每个 backend）分别归入"已激活"/"未激活"。同一个 model 若同时有激活和未激活的 backend，
            // 会在两个区各出现一张卡，分别只列对应的 backend。
            const activatedGroups = groups
              .map((g) => ({ ...g, rows: g.rows.filter((r) => !!r.is_activated) }))
              .filter((g) => g.rows.length > 0)
            const inactiveGroups = groups
              .map((g) => ({ ...g, rows: g.rows.filter((r) => !r.is_activated) }))
              .filter((g) => g.rows.length > 0)

            const renderGroup = (g: { model: string; rows: Sub[] }, sectionKey: "act" | "inact") => {
              const cardKey = `${sectionKey}:${g.model}`
              const collapsed = collapsedCards.has(cardKey)
              const disabled = sectionKey === "inact"
              // 卡间排序的依据：所有已激活订阅中按出现顺序聚合的 model 列表
              const allOrder: string[] = []
              activeSubs.forEach((s) => { if (!allOrder.includes(s.model)) allOrder.push(s.model) })
              const globalGroupIdx = allOrder.indexOf(g.model)
              const groupActivatedRanks = g.rows
                .map((r) => activatedRank.get(r.id))
                .filter((x): x is number => typeof x === "number")
              const minActivatedRank = groupActivatedRanks.length ? Math.min(...groupActivatedRanks) : null
              const groupActivated = groupActivatedRanks.length > 0
              return (
                <div
                  key={cardKey}
                  className={`bg-white rounded-lg border ${
                    groupActivated ? "border-fg/40 ring-2 ring-fg/10" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-bg/40 rounded-t-lg">
                    <button
                      type="button"
                      onClick={() => toggleCard(cardKey)}
                      className="shrink-0 inline-flex items-center text-fg-subtle hover:text-fg"
                      aria-label="toggle"
                    >
                      <span className={`inline-block transition-transform ${collapsed ? "" : "rotate-90"}`}>▶</span>
                    </button>
                    <Link
                      href={`/models/${g.model}?from=subscriptions`}
                      className="font-semibold text-base text-fg break-all hover:underline"
                    >{g.model}</Link>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 border border-line">
                      {g.rows.length} {t({ en: "backend(s)", zh: "个服务" })}
                    </span>
                    {groupActivated && minActivatedRank != null && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-fg text-accent-fg" title={t({ en: "Auto-failover priority", zh: "Auto 路由优先级" })}>
                        #{minActivatedRank}
                      </span>
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center" title={disabled ? t({ en: "Inactive models cannot be reordered", zh: "未激活模型不可调整顺序" }) : t({ en: "Adjust this model's priority among all models", zh: "在所有模型间调整该模型优先级" })}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleMoveGroup(g.model, -1) }}
                        disabled={disabled || globalGroupIdx <= 0}
                        title={t({ en: "Move model up", zh: "上移模型" })}
                        className="w-7 h-7 flex items-center justify-center text-xs rounded-l border border-line text-gray-600 bg-white hover:bg-accent-soft hover:text-fg disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                      >↑</button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleMoveGroup(g.model, 1) }}
                        disabled={disabled || globalGroupIdx === allOrder.length - 1}
                        title={t({ en: "Move model down", zh: "下移模型" })}
                        className="w-7 h-7 flex items-center justify-center text-xs rounded-r border-y border-r border-line text-gray-600 bg-white hover:bg-accent-soft hover:text-fg disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                      >↓</button>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="border-t border-line">
                      <table className="w-full text-sm table-fixed">
                        <colgroup>
                          <col style={{ width: "26%" }} />
                          <col style={{ width: "12%" }} />
                          <col style={{ width: "9%" }} />
                          <col style={{ width: "9%" }} />
                          <col style={{ width: "9%" }} />
                          <col style={{ width: "11%" }} />
                          <col style={{ width: "24%" }} />
                        </colgroup>
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-fg-subtle bg-bg/40">
                            <th className="px-4 py-2 font-medium">{t({ en: "Backend", zh: "后端" })}</th>
                            <th className="px-3 py-2 font-medium">{t({ en: "Provider", zh: "提供者" })}</th>
                            <th className="px-3 py-2 font-medium text-right">{t({ en: "Input /M", zh: "输入 /M" })}</th>
                            <th className="px-3 py-2 font-medium text-right">{t({ en: "Output /M", zh: "输出 /M" })}</th>
                            <th className="px-3 py-2 font-medium text-right">{t({ en: "Cache /M", zh: "缓存 /M" })}</th>
                            <th className="px-3 py-2 font-medium text-center">{t({ en: "Status", zh: "状态" })}</th>
                            <th className="px-3 py-2 font-medium text-right">{t({ en: "Action", zh: "操作" })}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                        {g.rows.map((s, rowIdx) => {
                          const isActivated = !!s.is_activated
                          const sym = "$"
                          const isFree = s.input_price === 0 && s.output_price === 0
                          return (
                            <tr key={s.id} className="hover:bg-bg/30">
                              {/* Backend */}
                              <td className="px-4 py-2.5 align-middle">
                                <div className="inline-flex items-center gap-1.5">
                                  <svg className="w-3.5 h-3.5 text-fg-subtle shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
                                  <Link
                                    href={`/models/${s.model}?backend_id=${s.backend_id}&from=subscriptions`}
                                    className="font-mono text-[12.5px] font-medium text-fg break-all hover:underline"
                                  >{s.backend}</Link>
                                  {!!s.is_owned && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200" title={t({ en: "Your own backend (auto-subscribed)", zh: "自有服务（自动订阅）" })}>
                                      {t({ en: "Owned", zh: "自有" })}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {/* Provider */}
                              <td className="px-3 py-2.5 align-middle text-fg-muted">
                                {s.provider || t({ en: "shared", zh: "共享" })}
                              </td>
                              {/* Input price */}
                              <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                                {s.input_price == null ? <span className="text-fg-subtle">—</span>
                                  : isFree ? <span className="text-emerald-600 font-medium">Free</span>
                                  : <span className="text-fg">{sym}{s.input_price}</span>}
                              </td>
                              {/* Output price */}
                              <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                                {s.output_price == null ? <span className="text-fg-subtle">—</span>
                                  : isFree ? <span className="text-emerald-600 font-medium">Free</span>
                                  : <span className="text-fg">{sym}{s.output_price}</span>}
                              </td>
                              {/* Cache price */}
                              <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                                {(() => {
                                  const cache = s.cache_price != null ? s.cache_price : (s.input_price != null ? s.input_price * 0.1 : null)
                                  if (cache == null) return <span className="text-fg-subtle">—</span>
                                  if (cache === 0) return <span className="text-emerald-600 font-medium">Free</span>
                                  return <span className="text-fg-muted">{sym}{cache.toFixed(cache < 1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "")}</span>
                                })()}
                              </td>
                              {/* Status */}
                              <td className="px-3 py-2.5 align-middle text-center">
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${s.backend_status === "online" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                                  <span className={`w-1 h-1 rounded-full ${s.backend_status === "online" ? "bg-emerald-500" : "bg-red-400"}`} />
                                  {s.backend_status === "online" ? t({ en: "Online", zh: "在线" }) : t({ en: "Offline", zh: "离线" })}
                                </span>
                              </td>
                              {/* Action */}
                              <td className="px-3 py-2.5 align-middle">
                                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                  {isActivated ? (
                                    <button
                                      onClick={() => handleToggleActivate(s.id, false)}
                                      disabled={saving === s.id}
                                      className="px-2 h-7 flex items-center text-xs rounded border border-line text-gray-600 bg-white hover:bg-accent-soft hover:text-fg hover:border-line-strong disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                    >{t({ en: "Deactivate", zh: "取消激活" })}</button>
                                  ) : (
                                    <button
                                      onClick={() => handleToggleActivate(s.id, true)}
                                      disabled={saving === s.id}
                                      className="px-2 h-7 flex items-center text-xs rounded border border-fg bg-fg text-white hover:bg-fg/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >{t({ en: "Activate", zh: "激活" })}</button>
                                  )}
                                  <button
                                    onClick={() => handleUnsubscribe(s.id)}
                                    disabled={!!s.is_owned}
                                    title={s.is_owned ? t({ en: "Your own backend — cannot unsubscribe", zh: "自有服务，无法取消订阅" }) : undefined}
                                    className="px-2 h-7 flex items-center text-xs rounded border border-red-300 text-red-600 bg-white hover:bg-red-50 hover:border-red-400 disabled:text-gray-300 disabled:border-line disabled:bg-gray-50 disabled:cursor-not-allowed"
                                  >{t({ en: "Unsubscribe", zh: "取消订阅" })}</button>
                                  <div className="flex items-center" title={disabled ? t({ en: "Inactive models cannot be reordered", zh: "未激活模型不可调整顺序" }) : g.rows.length <= 1 ? t({ en: "Only one backend", zh: "仅一个后端" }) : t({ en: "Reorder within model", zh: "在该模型内调整顺序" })}>
                                    <button
                                      onClick={() => handleMoveInCard(s.id, -1)}
                                      disabled={disabled || g.rows.length <= 1 || rowIdx === 0}
                                      title={t({ en: "Move up within model", zh: "同模型内上移" })}
                                      className="w-7 h-7 flex items-center justify-center text-xs rounded-l border border-line text-gray-600 bg-white hover:bg-accent-soft hover:text-fg disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                    >↑</button>
                                    <button
                                      onClick={() => handleMoveInCard(s.id, 1)}
                                      disabled={disabled || g.rows.length <= 1 || rowIdx === g.rows.length - 1}
                                      title={t({ en: "Move down within model", zh: "同模型内下移" })}
                                      className="w-7 h-7 flex items-center justify-center text-xs rounded-r border-y border-r border-line text-gray-600 bg-white hover:bg-accent-soft hover:text-fg disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
                                    >↓</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div className="space-y-6 mb-8">
                {activatedGroups.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowActivated(!showActivated)}
                      className="flex items-center gap-2 text-lg font-semibold text-gray-700 mb-3 hover:text-gray-900"
                    >
                      <span className={`transition-transform ${showActivated ? "rotate-90" : ""}`}>▶</span>
                      {t({ en: "Activated services", zh: "已激活模型服务" })} ({activatedGroups.length})
                    </button>
                    {showActivated && (
                      <div className="space-y-4">
                        {activatedGroups.map((g) => renderGroup(g, "act"))}
                      </div>
                    )}
                  </div>
                )}

                {inactiveGroups.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowInactive(!showInactive)}
                      className="flex items-center gap-2 text-lg font-semibold text-gray-500 mb-3 hover:text-gray-700"
                    >
                      <span className={`transition-transform ${showInactive ? "rotate-90" : ""}`}>▶</span>
                      {t({ en: "Inactive services", zh: "未激活模型服务" })} ({inactiveGroups.length})
                    </button>
                    {showInactive && (
                      <div className="space-y-4">
                        {inactiveGroups.map((g) => renderGroup(g, "inact"))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {subs.filter((s) => !s.is_active).length > 0 && (
            <>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-lg font-semibold text-gray-500 mb-3 hover:text-gray-700"
              >
                <span className={`transition-transform ${showHistory ? "rotate-90" : ""}`}>▶</span>
                {t({ en: "Subscription history", zh: "历史订阅" })} ({subs.filter((s) => !s.is_active).length})
              </button>
              {showHistory && (
                <div className="space-y-3">
                  {subs
                    .filter((s) => !s.is_active)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="bg-gray-50 rounded-lg border border-line p-4 opacity-60"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/models/${s.model}?backend_id=${s.backend_id}&from=subscriptions`}
                              className="font-medium text-gray-700 hover:text-fg"
                            >
                              {s.model}
                            </Link>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-500">
                              {t({ en: "Cancelled", zh: "已取消" })}
                            </span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {t({ en: `Subscribed ${s.created_at?.replace("T", " ")}`, zh: `订阅于 ${s.created_at?.replace("T", " ")}` })}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
