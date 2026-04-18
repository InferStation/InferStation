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

const MODEL_FAMILIES = ["Qwen", "THUDM", "deepseek-ai"]

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [search, setSearch] = useState("")
  const [familyFilter, setFamilyFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all")

  useEffect(() => {
    apiFetch("/api/models").then(setModels).catch(() => {})
  }, [])

  const filtered = models.filter((m) => {
    if (familyFilter !== "all") {
      const family = m.id.includes("/") ? m.id.split("/")[0] : ""
      if (family !== familyFilter) return false
    }
    if (statusFilter !== "all" && m.status !== statusFilter) return false
    if (search && !m.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">模型广场</h1>
        <span className="text-sm text-gray-400">{filtered.length} / {models.length} 个模型</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm divide-y divide-gray-100">
        <div className="flex items-center gap-4 px-5 py-3.5">
          <span className="text-sm font-medium text-gray-400 shrink-0 w-16">模型类别</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFamilyFilter("all")}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${familyFilter === "all" ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
            >
              全部
            </button>
            {MODEL_FAMILIES.map((f) => (
              <button
                key={f}
                onClick={() => setFamilyFilter(f)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${familyFilter === f ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 px-5 py-3.5">
          <span className="text-sm font-medium text-gray-400 shrink-0 w-16">在线状态</span>
          <div className="flex items-center gap-2">
            {(["all", "online", "offline"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                  statusFilter === s
                    ? s === "online" ? "bg-emerald-600 text-white shadow-sm"
                    : s === "offline" ? "bg-rose-500 text-white shadow-sm"
                    : "bg-indigo-600 text-white shadow-sm"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {s === "all" ? "全部" : s === "online" ? "🟢 在线" : "🔴 离线"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="输入模型名称搜索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200/80 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 focus:outline-none text-sm transition-shadow"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <svg className="mx-auto w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {models.length === 0 ? "暂无在线模型，等待提供者注册服务" : "未找到匹配的模型"}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m, i) => (
            <Link key={i} href={`/models/${m.id}`} className="group bg-white rounded-xl border border-gray-200/80 p-5 hover:shadow-lg hover:border-indigo-200 transition-all duration-200 cursor-pointer block">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors leading-tight break-all">{m.id}</h3>
                <span className={`shrink-0 ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.status === "online" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-500"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${m.status === "online" ? "bg-emerald-500 animate-pulse" : "bg-red-400"}`} />
                  {m.status === "online" ? "在线" : "离线"}
                </span>
              </div>
              {Object.keys(m.tags || {}).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Object.entries(m.tags).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-600">
                      {v}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-sm text-gray-500 space-y-1 pt-2 border-t border-gray-100">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  <span>{m.provider || "共享"}</span>
                </div>
                {m.input_price != null && (
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {m.input_price === 0 && m.output_price === 0 ? (
                      <span className="text-emerald-600 font-semibold">Free</span>
                    ) : (
                      <span className="text-gray-600">¥{m.input_price}/M · ¥{m.output_price}/M</span>
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
