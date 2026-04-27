"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"

interface ModelDetail {
  id: string
  backend_id: number
  backend: string
  provider: string
  status: string
  mode: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  cache_price: number | null
  currency: string
  created_at: string
  updated_at: string
}

interface Subscription {
  id: number
  model: string
  is_owned?: boolean
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
  const [exampleLang, setExampleLang] = useState<"curl" | "python">("curl")
  const [copied, setCopied] = useState(false)

  const modelId = Array.isArray(params.id) ? params.id.slice(1).join("/") : params.id
  const backendId = Array.isArray(params.id) ? params.id[0] : ""

  useEffect(() => {
    if (!modelId || !backendId) return
    apiFetch(`/api/models/${modelId}?backend_id=${backendId}`)
      .then(setModel)
      .catch(() => setError("模型不存在"))
      .finally(() => setLoading(false))
  }, [modelId, backendId])

  // Check existing subscription
  useEffect(() => {
    if (!user || !modelId || !backendId) return
    apiFetch("/api/subscriptions")
      .then((subs: any[]) => {
        const found = subs.find((s) => s.model === modelId && String(s.backend_id) === backendId && s.is_active)
        if (found) setSub({ id: found.id, model: found.model, is_owned: !!found.is_owned })
      })
      .catch(() => {})
  }, [user, modelId, backendId])

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
        body: JSON.stringify({ model: modelId, backend_id: model?.backend_id }),
      })
      setSub(res)
    } catch {
      alert("订阅失败")
    } finally {
      setSubLoading(false)
    }
  }

  const handleUnsubscribe = async () => {
    if (!sub) return
    try {
      await apiFetch(`/api/subscriptions/${sub.id}`, { method: "DELETE" })
      setSub(null)
    } catch {
      alert("取消订阅失败")
    }
  }


  if (loading) {
    return <div className="text-center py-20 text-gray-500">加载中...</div>
  }

  if (error || !model) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || "模型不存在"}</p>
        <button onClick={() => router.push("/models")} className="text-fg hover:underline">
          返回模型广场
        </button>
      </div>
    )
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer $YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "messages": [{"role": "user", "content": "你好"}]
  }'`

  const pythonExample = `from openai import OpenAI

client = OpenAI(
    api_key="$YOUR_API_KEY",
    base_url="${baseUrl}/v1",
)

resp = client.chat.completions.create(
    model="${model.id}",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)`

  const exampleCode = exampleLang === "curl" ? curlExample : pythonExample
  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(exampleCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => router.push("/models")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1"
      >
        ← 返回模型广场
      </button>

      <div className="bg-white rounded-lg border border-line p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 break-all">{model.id}</h1>
          <div className="flex items-center gap-2 shrink-0">
            {sub && (
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700"
                title={sub.is_owned ? "自己注册的模型服务（自动订阅）" : "已订阅"}
              >
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {sub.is_owned ? "自动订阅" : "已订阅"}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                model.status === "online" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${model.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
              {model.status === "online" ? "在线" : "离线"}
            </span>
          </div>
        </div>

        {/* Tags */}
        {Object.keys(model.tags || {}).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {Object.entries(model.tags).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-accent-soft text-fg border border-line"
              >
                {v}
              </span>
            ))}
          </div>
        )}

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">服务后端</p>
            <p className="font-medium text-gray-900">{model.backend}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-500 mb-1">提供者</p>
            <p className="font-medium text-gray-900">{model.provider || "共享"}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 col-span-2">
            <p className="text-gray-500 mb-2">定价（每 1M tokens，{model.currency || "CNY"}）</p>
            {model.input_price == null ? (
              <p className="font-medium text-gray-900">未设置</p>
            ) : model.input_price === 0 && model.output_price === 0 ? (
              <p className="font-semibold text-green-600">Free</p>
            ) : (() => {
              const sym = model.currency === "USD" ? "$" : "¥"
              const cache = model.cache_price != null ? model.cache_price : (model.input_price ?? 0) * 0.1
              const cacheImplicit = model.cache_price == null
              return (
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">输入</p>
                    <p className="font-semibold text-green-600">{sym}{model.input_price}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">输出</p>
                    <p className="font-semibold text-green-600">{sym}{model.output_price}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">
                      缓存命中{cacheImplicit && <span className="ml-1 text-gray-400">(=输入×0.1)</span>}
                    </p>
                    <p className="font-semibold text-green-600">{sym}{Number(cache).toFixed(4).replace(/\.?0+$/, "")}</p>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Subscribe / API Section */}
        <div className="mt-6 border-t pt-6">
          {!sub ? (
            <button
              onClick={handleSubscribe}
              disabled={subLoading || model.status !== "online"}
              className="w-full py-3 rounded-lg font-medium text-white bg-fg hover:bg-fg/90 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {subLoading ? "订阅中..." : model.status !== "online" ? "模型离线，暂不可订阅" : "订阅此模型"}
            </button>
          ) : (
            <div className="space-y-4">
              {sub.is_owned ? (
                <div className="w-full py-3 rounded-lg font-medium text-center bg-gray-100 text-gray-500 cursor-not-allowed" title="自己注册的模型服务，无法取消订阅">
                  自己的服务（已自动订阅）
                </div>
              ) : (
                <button
                  onClick={handleUnsubscribe}
                  className="w-full py-3 rounded-lg font-medium text-red-600 bg-white border border-red-300 hover:bg-red-50 hover:border-red-400 transition-colors"
                >
                  取消订阅
                </button>
              )}
              <p className="text-sm text-fg-muted">
                用你的 <Link href="/dashboard/keys" className="underline hover:text-fg">API Key</Link> 直接请求即可，下面是调用本模型的最小示例：
              </p>
              <div className="rounded-lg border border-line bg-gray-900 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                  <div className="flex items-center gap-1">
                    {(["curl", "python"] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setExampleLang(lang)}
                        className={`px-2.5 py-1 text-xs rounded ${
                          exampleLang === lang
                            ? "bg-gray-700 text-white"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {lang === "curl" ? "curl" : "Python"}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={copyExample}
                    className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <pre className="px-4 py-3 text-xs text-gray-100 overflow-x-auto leading-relaxed">
{exampleCode}
                </pre>
              </div>
              <p className="text-xs text-gray-500">
                更多调用方式（多模型回退、指定后端等）见 <Link href="/docs" className="underline hover:text-fg">使用文档</Link>。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
