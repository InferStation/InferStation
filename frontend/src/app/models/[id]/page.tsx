"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api"

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

export default function ModelDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [model, setModel] = useState<ModelDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const modelId = Array.isArray(params.id) ? params.id.join("/") : params.id

  useEffect(() => {
    if (!modelId) return
    apiFetch(`/api/models/${modelId}`)
      .then(setModel)
      .catch(() => setError("模型不存在"))
      .finally(() => setLoading(false))
  }, [modelId])

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
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">后端</p>
            <p className="font-medium text-gray-900">{model.backend}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">注册时间</p>
            <p className="font-medium text-gray-900">{model.created_at?.replace("T", " ") || "-"}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">最近更新</p>
            <p className="font-medium text-gray-900">{model.updated_at?.replace("T", " ") || "-"}</p>
          </div>
        </div>

        {/* API Usage */}
        {model.status === "online" && (
          <div className="mt-6 border-t pt-6">
            <h2 className="text-lg font-semibold mb-3">API 调用示例</h2>
            <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
{`curl ${typeof window !== "undefined" ? window.location.origin : ""}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
