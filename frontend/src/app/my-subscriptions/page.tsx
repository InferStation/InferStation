"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

interface Sub {
  id: number
  backend_id: number
  model: string
  sub_key: string
  is_active: number
  is_activated?: number | boolean
  created_at: string
  backend: string
  backend_status: string
  input_price: number | null
  output_price: number | null
  currency: string
  provider?: string | null
  is_owned?: number | boolean
}

export default function MyModelsPage() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [showActivated, setShowActivated] = useState(true)
  const [showInactive, setShowInactive] = useState(true)
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<number | null>(null)
  const [autoFallback, setAutoFallback] = useState(true)
  const [savingAuto, setSavingAuto] = useState(false)

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
      try {
        const me = await apiFetch("/api/auth/me")
        if (typeof me.auto_fallback === "boolean") setAutoFallback(me.auto_fallback)
      } catch { /* ignore */ }
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  const toggleAutoFallback = async () => {
    const next = !autoFallback
    setSavingAuto(true)
    try {
      await apiFetch("/api/user/auto-fallback", {
        method: "POST",
        body: JSON.stringify({ enabled: next }),
      })
      setAutoFallback(next)
    } finally {
      setSavingAuto(false)
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

  if (loading) return <div className="text-center py-20 text-gray-500">加载中...</div>

  return (
    <div>
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-5 mb-8">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-indigo-900">API 链接</h2>
          {activatedSubs.length > 0 ? (
            <span className="text-xs text-indigo-700">
              已激活 {activatedSubs.length} 个服务，{autoFallback ? "按优先级自动回退" : "需在请求中指定 model"}
            </span>
          ) : (
            <span className="text-xs text-amber-600">尚未激活任何订阅，请在下方点击「激活」</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-white px-3 py-2 rounded text-xs font-mono text-gray-800 break-all border border-indigo-200">
            {unifiedUrl}
          </code>
          <button
            onClick={() => copyToClipboard(unifiedUrl, "unified")}
            className="shrink-0 px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded"
          >
            {copied === "unified" ? "已复制" : "复制"}
          </button>
        </div>
        <div className="text-sm text-gray-700 mt-3 space-y-2 leading-relaxed">
          <div className="flex items-center justify-between bg-white border border-indigo-200 rounded px-3 py-2">
            <div className="text-xs text-gray-700">
              <span className="font-semibold text-gray-900">自动回退 (auto fallback)</span>
              <span className="ml-2 text-gray-500">
                {autoFallback
                  ? "按优先级自动挑选已激活的在线模型；高优先级离线时自动切换到下一个。请求里的 model 字段会被忽略。"
                  : "必须在请求中显式指定 model；只走该模型对应的订阅，不会自动切换到其它订阅。"}
              </span>
            </div>
            <button
              onClick={toggleAutoFallback}
              disabled={savingAuto}
              className={`shrink-0 ml-3 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoFallback ? "bg-indigo-600" : "bg-gray-300"} ${savingAuto ? "opacity-50 cursor-not-allowed" : ""}`}
              aria-label="toggle auto fallback"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoFallback ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <p className="bg-amber-100 border border-amber-300 text-amber-900 rounded px-3 py-2 font-medium">
            {autoFallback ? (
              <>⚠ 使用你<span className="font-bold">自己的 API Key</span>调用上方 API 链接，即可访问你<span className="font-bold">已激活的订阅模型服务</span>；平台按<span className="font-bold">优先级</span>转发并在高优先级离线时<span className="font-bold">自动回退</span>，可通过「<span className="font-bold">上移 / 下移</span>」调整顺序（<span className="font-bold">越靠上优先级越高</span>）。</>
            ) : (
              <>⚠ 自动回退已关闭：使用你<span className="font-bold">自己的 API Key</span>调用上方 API 链接时，<span className="font-bold">必须在请求体中指定 model</span>，且只能是你<span className="font-bold">已激活订阅</span>里的模型名；匹配后仅使用对应那一个订阅，不会自动切换到其它订阅。</>
            )}
          </p>
        </div>
      </div>

      {subs.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-4">暂无订阅模型</p>
          <Link href="/models" className="text-indigo-600 hover:underline">去模型广场看看 →</Link>
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
              const anyOnline = g.rows.some((r) => r.backend_status === "online")
              const groupActivatedRanks = g.rows
                .map((r) => activatedRank.get(r.id))
                .filter((x): x is number => typeof x === "number")
              const minActivatedRank = groupActivatedRanks.length ? Math.min(...groupActivatedRanks) : null
              const groupActivated = groupActivatedRanks.length > 0
              return (
                <div
                  key={cardKey}
                  className={`bg-white rounded-lg border ${
                    groupActivated ? "border-indigo-400 ring-2 ring-indigo-100" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg">
                    <button
                      type="button"
                      onClick={() => toggleCard(cardKey)}
                      className="flex-1 flex items-center gap-3 flex-wrap text-left"
                    >
                      <span
                        className={`shrink-0 inline-block text-gray-400 transition-transform ${collapsed ? "" : "rotate-90"}`}
                      >
                        ▶
                      </span>
                      <span className="font-semibold text-lg text-gray-900 break-all">
                        {g.model}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          anyOnline ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${anyOnline ? "bg-green-500" : "bg-red-400"}`} />
                        {anyOnline ? "在线" : "离线"}
                      </span>
                      {g.rows.length > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                          {g.rows.length} 个服务
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-1 shrink-0" title={disabled ? "未激活模型不可调整顺序" : "在所有模型间调整该模型的优先级"}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleMoveGroup(g.model, -1) }}
                        disabled={disabled || globalGroupIdx <= 0}
                        title="在所有模型间提高该模型的优先级"
                        className="px-2 h-7 flex items-center text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
                      >上移模型</button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleMoveGroup(g.model, 1) }}
                        disabled={disabled || globalGroupIdx === allOrder.length - 1}
                        title="在所有模型间降低该模型的优先级"
                        className="px-2 h-7 flex items-center text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
                      >下移模型</button>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="px-5 pb-5">
                      <div className={g.rows.length > 1 ? "divide-y divide-gray-100 border border-gray-100 rounded" : ""}>
                        {g.rows.map((s, rowIdx) => {
                          const isActivated = !!s.is_activated
                          const myRank = activatedRank.get(s.id) ?? null
                          return (
                            <div
                              key={s.id}
                              className={`${g.rows.length > 1 ? "px-3 py-3" : ""} flex items-center justify-between flex-wrap gap-2`}
                            >
                              <div className="flex items-center gap-3 flex-wrap text-sm">
                                <span className="inline-flex items-center gap-1 text-gray-700" title={`后端：${s.backend}`}>
                                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg>
                                  <span className="font-medium text-gray-900">{s.backend}</span>
                                </span>
                                <span className="inline-flex items-center gap-1 text-gray-600" title={`提供者：${s.provider || "共享"}`}>
                                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                  <span>{s.provider || "共享"}</span>
                                </span>
                                {s.input_price != null && (
                                  <span className="inline-flex items-center gap-1 text-gray-600" title="价格（输入 / 输出，每 1M tokens）">
                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {s.input_price === 0 && s.output_price === 0 ? (
                                      <span className="text-emerald-600 font-semibold">Free</span>
                                    ) : (
                                      <span>{s.currency === "USD" ? "$" : "¥"}{s.input_price}/M · {s.currency === "USD" ? "$" : "¥"}{s.output_price}/M <span className="text-[10px] text-gray-400">{s.currency || "CNY"}</span></span>
                                    )}
                                  </span>
                                )}
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium ${
                                    s.backend_status === "online"
                                      ? "bg-green-50 text-green-700"
                                      : "bg-red-50 text-red-600"
                                  }`}
                                  title={s.backend_status === "online" ? "在线" : "离线"}
                                >
                                  <span
                                    className={`w-1 h-1 rounded-full ${
                                      s.backend_status === "online" ? "bg-green-500" : "bg-red-400"
                                    }`}
                                  />
                                  {s.backend_status === "online" ? "在线" : "离线"}
                                </span>
                                {s.is_owned && (
                                  <span
                                    className="inline-flex items-center gap-1 text-amber-600"
                                    title="自己注册的模型服务（自动订阅，无法取消订阅）"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1" title={disabled ? "未激活模型不可调整顺序" : g.rows.length <= 1 ? "该模型只有一个后端，无需排序" : "在该模型的多个后端之间调整顺序"}>
                                  <button
                                    onClick={() => handleMoveInCard(s.id, -1)}
                                    disabled={disabled || g.rows.length <= 1 || rowIdx === 0}
                                    title="同模型内提高该服务的优先级"
                                    className="px-2 h-7 flex items-center text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
                                  >
                                    上移服务
                                  </button>
                                  <button
                                    onClick={() => handleMoveInCard(s.id, 1)}
                                    disabled={disabled || g.rows.length <= 1 || rowIdx === g.rows.length - 1}
                                    title="同模型内降低该服务的优先级"
                                    className="px-2 h-7 flex items-center text-xs rounded border border-gray-200 text-gray-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
                                  >
                                    下移服务
                                  </button>
                                </div>
                                {isActivated ? (
                                  <button
                                    onClick={() => handleToggleActivate(s.id, false)}
                                    disabled={saving === s.id}
                                    className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                                  >
                                    取消激活
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleToggleActivate(s.id, true)}
                                    disabled={saving === s.id}
                                    className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
                                  >
                                    激活
                                  </button>
                                )}
                                <button
                                  onClick={() => handleUnsubscribe(s.id)}
                                  disabled={!!s.is_owned}
                                  title={s.is_owned ? "自己注册的模型服务，无法取消订阅" : undefined}
                                  className="text-xs text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:text-gray-300"
                                >
                                  取消订阅
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
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
                      已激活模型服务 ({activatedGroups.length})
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
                      未激活模型服务 ({inactiveGroups.length})
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
                历史订阅 ({subs.filter((s) => !s.is_active).length})
              </button>
              {showHistory && (
                <div className="space-y-3">
                  {subs
                    .filter((s) => !s.is_active)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="bg-gray-50 rounded-lg border border-gray-200 p-4 opacity-60"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/models/${s.backend_id}/${s.model}`}
                              className="font-medium text-gray-700 hover:text-indigo-600"
                            >
                              {s.model}
                            </Link>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-500">
                              已取消
                            </span>
                          </div>
                          <span className="text-xs text-gray-400">
                            订阅于 {s.created_at?.replace("T", " ")}
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
