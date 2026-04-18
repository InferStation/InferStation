"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"

interface ModelDetail {
  id: string
  backend: string
  provider: string
  status: string
  mode: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  created_at: string
  updated_at: string
}

interface Subscription {
  sub_key: string
  model: string
}

export default function ModelDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const [model, setModel] = useState<ModelDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sub, setSub] = useState<Subscription | null>(null)
  const [subLoading, setSubLoading] = useState(false)
  const [copied, setCopied] = useState("")

  const modelId = Array.isArray(params.id) ? params.id.join("/") : params.id

  useEffect(() => {
    if (!modelId) return
    apiFetch(`/api/models/${modelId}`)
      .then(setModel)
      .catch(() => setError("模型不存在"))
      .finally(() => setLoading(false))
  }, [modelId])

  // Check existing subscription
  useEffect(() => {
    if (!user || !modelId) return
    apiFetch("/api/subscriptions")
      .then((subs: any[]) => {
        const found = subs.find((s) => s.model === modelId && s.is_active)
        if (found) setSub({ sub_key: found.sub_key, model: found.model })
      })
      .catch(() => {})
  }, [user, modelId])

  const handleSubscribe = async () => {
    if (!user) {
      router.push("/login")
      return
    }
    setSubLoading(true)
    try {
      const res = await apiFetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      })
      setSub(res)
    } catch {
      alert("订阅失败")
    } finally {
      setSubLoading(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(""), 2000)
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-500">加载中...</div>
  }

  if (error || !model) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || "模型不存在"}</p>
        <button onClick={() => router.push("/models")} className="text-indigo-600 hover:underline">
          返回模型广场
        </button>
      </div>
    )
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => router.push("/models")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1"
      >
        ← 返回模型广场
      </button>

      <div className="bg-white rounded-lg border border-gray-200 p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{model.id}</h1>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
              model.status === "online" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${model.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
            {model.status === "online" ? "在线" : "离线"}
          </span>
        </div>

        {/* Tags */}
        {Object.keys(model.tags || {}).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {Object.entries(model.tags).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
              >
                {v}
              </span>
            ))}
          </div>
        )}

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">提供者</p>
            <p className="font-medium text-gray-900">{model.provider || "共享"}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">接入方式</p>
            <p className="font-medium text-gray-900">{model.mode === "tunnel" ? "隧道" : "直连"}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">定价</p>
            <p className="font-medium text-gray-900">
              {model.input_price == null ? (
                "未设置"
              ) : model.input_price === 0 && model.output_price === 0 ? (
                <span className="text-green-600">Free</span>
              ) : (
                <>
                  <span className="text-green-600">¥{model.input_price}/M 输入</span>
                  {" / "}
                  <span className="text-green-600">¥{model.output_price}/M 输出</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Subscribe / API Section */}
        <div className="mt-6 border-t pt-6">
          {!sub ? (
            <button
              onClick={handleSubscribe}
              disabled={subLoading || model.status !== "online"}
              className="w-full py-3 rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {subLoading ? "订阅中..." : model.status !== "online" ? "模型离线，暂不可订阅" : "订阅此模型"}
            </button>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  已订阅
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500 mb-1">你的专属 API 地址</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">
                      {baseUrl}/s/{sub.sub_key}/v1/chat/completions
                    </code>
                    <button
                      onClick={() => copyToClipboard(`${baseUrl}/s/${sub.sub_key}/v1/chat/completions`, "url")}
                      className="shrink-0 px-3 py-2 text-xs bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                    >
                      {copied === "url" ? "已复制" : "复制"}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-500 mb-1">调用示例</p>
                  <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
{`curl ${baseUrl}/s/${sub.sub_key}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
