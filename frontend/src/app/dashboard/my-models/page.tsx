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
  created_at: string
  backend: string
  backend_status: string
  input_price: number | null
  output_price: number | null
}

export default function MyModelsPage() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState("")

  const fetchSubs = () => {
    apiFetch("/api/subscriptions")
      .then(setSubs)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(fetchSubs, [])

  const handleUnsubscribe = async (id: number) => {
    await apiFetch(`/api/subscriptions/${id}`, { method: "DELETE" })
    fetchSubs()
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(""), 2000)
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

  if (loading) return <div className="text-center py-20 text-gray-500">加载中...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">我的订阅</h1>

      {subs.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="mb-4">暂无订阅模型</p>
          <Link href="/models" className="text-indigo-600 hover:underline">去模型广场看看 →</Link>
        </div>
      ) : (
        <>
          {subs.filter((s) => s.is_active).length > 0 && (
            <div className="space-y-4 mb-8">
              {subs.filter((s) => s.is_active).map((s) => (
                <div key={s.id} className="bg-white rounded-lg border p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/models/${s.backend_id}/${s.model}`} className="font-semibold text-lg text-gray-900 hover:text-indigo-600">
                        {s.model}
                      </Link>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.backend_status === "online" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          s.backend_status === "online" ? "bg-green-500" : "bg-red-400"
                        }`} />
                        {s.backend_status === "online" ? "在线" : "离线"}
                      </span>
                    </div>
                    <button
                      onClick={() => handleUnsubscribe(s.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      取消订阅
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">API:</span>
                    <code className="flex-1 bg-gray-50 px-2 py-1 rounded text-xs font-mono text-gray-700 break-all">
                      {baseUrl}/s/{s.sub_key}/v1/chat/completions
                    </code>
                    <button
                      onClick={() => copyToClipboard(`${baseUrl}/s/${s.sub_key}/v1/chat/completions`, `api-${s.id}`)}
                      className="shrink-0 px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                    >
                      {copied === `api-${s.id}` ? "已复制" : "复制"}
                    </button>
                  </div>

                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    <span>订阅于 {s.created_at?.replace("T", " ")}</span>
                    {s.input_price != null && (
                      <span>
                        {s.input_price === 0 && s.output_price === 0 ? "Free" : `¥${s.input_price}/M 输入 / ¥${s.output_price}/M 输出`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {subs.filter((s) => !s.is_active).length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-gray-500 mb-3">历史订阅</h2>
              <div className="space-y-3">
                {subs.filter((s) => !s.is_active).map((s) => (
                  <div key={s.id} className="bg-gray-50 rounded-lg border border-gray-200 p-4 opacity-60">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Link href={`/models/${s.backend_id}/${s.model}`} className="font-medium text-gray-700 hover:text-indigo-600">
                          {s.model}
                        </Link>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-500">
                          已取消
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">订阅于 {s.created_at?.replace("T", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
