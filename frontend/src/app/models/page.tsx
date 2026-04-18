"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api"

interface Model {
  id: string
  backend: string
  provider: string
  status: string
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
}

export default function ModelsPage() {
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">模型广场</h1>
        <input
          type="text"
          placeholder="搜索模型或提供者..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          {models.length === 0 ? "暂无在线模型，等待提供者注册服务" : "未找到匹配的模型"}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m, i) => (
            <Link key={i} href={`/models/${m.id}`} className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer block">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg text-gray-900">{m.id}</h3>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.status === "online" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${m.status === "online" ? "bg-green-500" : "bg-red-400"}`} />
                  {m.status === "online" ? "在线" : "离线"}
                </span>
              </div>
              {Object.keys(m.tags || {}).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Object.entries(m.tags).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {v}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-sm text-gray-500 space-y-1">
                <p>提供者: <span className="text-gray-700">{m.provider || "共享"}</span></p>
                {m.input_price != null && (
                  <p>
                    定价: {m.input_price === 0 && m.output_price === 0 ? (
                      <span className="text-green-600 font-medium">Free</span>
                    ) : (
                      <>
                        <span className="text-green-600">¥{m.input_price}/M 输入</span>
                        {" / "}
                        <span className="text-green-600">¥{m.output_price}/M 输出</span>
                      </>
                    )}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
