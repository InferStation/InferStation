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
  is_owned?: number | boolean
}

export default function MyModelsPage() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)

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

  const handleMove = async (id: number, dir: -1 | 1) => {
    const active = subs.filter((s) => s.is_active)
    const inactive = subs.filter((s) => !s.is_active)
    const idx = active.findIndex((s) => s.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= active.length) return
    const reordered = [...active]
    const [m] = reordered.splice(idx, 1)
    reordered.splice(newIdx, 0, m)
    const newSubs = [...reordered, ...inactive]
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

  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""
  const unifiedUrl = `${baseUrl}/v1/chat/completions`
  const activatedSubs = subs.filter((s) => s.is_active && s.is_activated)

  if (loading) return <div className="text-center py-20 text-gray-500">加载中...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">我的订阅</h1>

      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-5 mb-8">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-indigo-900">我的统一 API 链接</h2>
          {activatedSubs.length > 0 ? (
            <span className="text-xs text-indigo-700">
              已激活 {activatedSubs.length} 个服务，按优先级自动回退
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
        <div className="text-sm text-gray-700 mt-3 space-y-1.5 leading-relaxed">
          <p>
            平台按<span className="font-semibold text-indigo-700">优先级</span>转发到<span className="font-semibold text-indigo-700">「已激活」</span>的模型服务，高优先级服务离线时<span className="font-semibold text-indigo-700">自动回退</span>到下一个。
          </p>
          <p className="bg-amber-100 border border-amber-300 text-amber-900 rounded px-3 py-2 font-medium">
            ⚠ 下方可通过「<span className="font-bold">↑ ↓</span>」按钮调整顺序，<span className="font-bold">顺序即转发优先级</span>（越靠上优先级越高）。
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
          {subs.filter((s) => s.is_active).length > 0 && (
            <div className="space-y-4 mb-8">
              {subs.filter((s) => s.is_active).map((s, idx, arr) => {
                const isActivated = !!s.is_activated
                return (
                  <div
                    key={s.id}
                    className={`bg-white rounded-lg border p-5 ${
                      isActivated ? "border-indigo-400 ring-2 ring-indigo-100" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Link
                          href={`/models/${s.backend_id}/${s.model}`}
                          className="font-semibold text-lg text-gray-900 hover:text-indigo-600"
                        >
                          {s.model}
                        </Link>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            s.backend_status === "online"
                              ? "bg-green-50 text-green-700"
                              : "bg-red-50 text-red-600"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              s.backend_status === "online" ? "bg-green-500" : "bg-red-400"
                            }`}
                          />
                          {s.backend_status === "online" ? "在线" : "离线"}
                        </span>
                        {isActivated && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-600 text-white">
                            优先级 {arr.filter((x, i) => i <= idx && x.is_activated).length}
                          </span>
                        )}
                        {s.is_owned && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200" title="自己注册的模型服务，无法取消订阅">
                            自动订阅
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMove(s.id, -1)}
                            disabled={idx === 0}
                            title="上移（提高优先级）"
                            className="w-8 h-8 flex items-center justify-center text-lg font-bold rounded border border-gray-200 text-gray-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
                          >↑</button>
                          <button
                            onClick={() => handleMove(s.id, 1)}
                            disabled={idx === arr.length - 1}
                            title="下移（降低优先级）"
                            className="w-8 h-8 flex items-center justify-center text-lg font-bold rounded border border-gray-200 text-gray-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 disabled:text-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50"
                          >↓</button>
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

                    <div className="flex gap-4 text-xs text-gray-400 flex-wrap">
                      <span>后端：{s.backend}</span>
                      <span>订阅于 {s.created_at?.replace("T", " ")}</span>
                      {s.input_price != null && (
                        <span>
                          {s.input_price === 0 && s.output_price === 0
                            ? "Free"
                            : `¥${s.input_price}/M 输入 / ¥${s.output_price}/M 输出`}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

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
