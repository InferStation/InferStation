"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import Link from "next/link"

interface Model {
  id: string
  backend: string
  provider: string
  input_price: number | null
  output_price: number | null
}

export default function Home() {
  const [models, setModels] = useState<Model[]>([])
  const [search, setSearch] = useState("")

  useEffect(() => {
    apiFetch("/api/models").then(setModels).catch(() => {})
  }, [])

  const filtered = models.filter(
    (m) => m.id.toLowerCase().includes(search.toLowerCase()) || m.provider?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">LLM Gateway</h1>
        <p className="text-lg text-gray-600">模型服务聚合平台 — 连接 AI 消费者与模型提供者</p>
      </div>

      <div className="mb-6">
        <input
          type="text"
          placeholder="搜索模型名称或提供者..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          {models.length === 0 ? "暂无在线模型" : "未找到匹配的模型"}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-lg text-gray-900 mb-2">{m.id}</h3>
              <div className="text-sm text-gray-500 space-y-1">
                <p>提供者: <span className="text-gray-700">{m.provider || "共享"}</span></p>
                <p>后端: <span className="text-gray-700">{m.backend}</span></p>
                {m.input_price != null && (
                  <p>
                    定价: <span className="text-green-600">¥{m.input_price}/M 输入</span>
                    {" / "}
                    <span className="text-green-600">¥{m.output_price}/M 输出</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-16 grid gap-6 md:grid-cols-3 text-center">
        <div className="bg-white rounded-lg p-6 border">
          <h3 className="font-semibold text-lg mb-2">🔌 OpenAI 兼容</h3>
          <p className="text-sm text-gray-600">直接使用 OpenAI SDK 调用，无缝切换</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <h3 className="font-semibold text-lg mb-2">🌐 NAT 穿透</h3>
          <p className="text-sm text-gray-600">内网机器也能提供服务，WebSocket 隧道自动连接</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <h3 className="font-semibold text-lg mb-2">💰 按量计费</h3>
          <p className="text-sm text-gray-600">按 token 用量计费，灵活定价</p>
        </div>
      </div>
    </div>
  )
}
