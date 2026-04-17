"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useRouter } from "next/navigation"

interface Backend {
  id: number
  name: string
  url: string | null
  mode: string
  models: string[]
  status: string
  input_price: number | null
  output_price: number | null
  is_public: number
  owner_name: string
  updated_at: string
}

export default function ServicesPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [backends, setBackends] = useState<Backend[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: "",
    url: "",
    mode: "direct",
    models: "",
    input_price: "",
    output_price: "",
    is_public: true,
  })

  useEffect(() => {
    if (user && !["provider", "both", "admin"].includes(user.role)) {
      router.push("/dashboard/other")
    }
  }, [user, router])

  useEffect(() => {
    if (user) loadBackends()
  }, [user])

  const loadBackends = () => apiFetch("/api/backends").then(setBackends).catch(() => {})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await apiFetch("/api/backends", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          url: form.mode === "direct" ? form.url : null,
          mode: form.mode,
          models: form.models.split(",").map((s) => s.trim()).filter(Boolean),
          input_price: form.input_price ? parseFloat(form.input_price) : null,
          output_price: form.output_price ? parseFloat(form.output_price) : null,
          is_public: form.is_public,
        }),
      })
      setShowForm(false)
      setForm({ name: "", url: "", mode: "direct", models: "", input_price: "", output_price: "", is_public: true })
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    }
  }

  const deleteBackend = async (name: string) => {
    if (!confirm(`确定要删除后端 "${name}" 吗？`)) return
    await apiFetch(`/api/backends/${name}`, { method: "DELETE" })
    loadBackends()
  }

  if (!user) return null

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">我的服务</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
        >
          {showForm ? "取消" : "注册后端"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">后端名称</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">接入模式</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                  <option value="direct">直连（公网可达）</option>
                  <option value="tunnel">隧道（NAT 内网）</option>
                </select>
              </div>
            </div>
            {form.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">后端 URL</label>
                <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://IP:PORT" required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型列表（逗号分隔）</label>
              <input type="text" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} placeholder="Qwen3-8B, Llama-3-70B" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输入定价（元/百万token）</label>
                <input type="number" step="0.01" value={form.input_price} onChange={(e) => setForm({ ...form, input_price: e.target.value })} placeholder="默认" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输出定价（元/百万token）</label>
                <input type="number" step="0.01" value={form.output_price} onChange={(e) => setForm({ ...form, output_price: e.target.value })} placeholder="默认" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center">
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} className="mr-2" />
              <span className="text-sm text-gray-600">公开可见（所有用户可调用）</span>
            </div>
            <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700">提交</button>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {backends.map((b) => (
          <div key={b.id} className="bg-white rounded-lg border p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-lg">{b.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs ${b.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{b.status}</span>
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{b.mode === "tunnel" ? "隧道" : "直连"}</span>
                  {!b.is_public && <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">私有</span>}
                </div>
                {b.url && <p className="text-sm text-gray-500">URL: {b.url}</p>}
                <p className="text-sm text-gray-500">模型: {b.models.length > 0 ? b.models.join(", ") : "未设置"}</p>
                {(b.input_price != null || b.output_price != null) && (
                  <p className="text-sm text-gray-500">定价: ¥{b.input_price}/M 输入 / ¥{b.output_price}/M 输出</p>
                )}
              </div>
              <button onClick={() => deleteBackend(b.name)} className="text-red-500 hover:text-red-700 text-sm">删除</button>
            </div>
          </div>
        ))}
        {backends.length === 0 && <div className="text-center py-12 text-gray-500">暂无注册的后端服务</div>}
      </div>

      <div className="mt-8 bg-gray-50 rounded-lg border p-6">
        <h2 className="font-semibold mb-3">隧道模式使用说明</h2>
        <p className="text-sm text-gray-600 mb-3">如果你的机器在 NAT/内网后面，选择「隧道」模式注册后端，然后在机器上运行 client.py：</p>
        <pre className="text-sm bg-white p-4 rounded border overflow-x-auto">{`python client.py \\
  --gateway ws://GATEWAY_HOST:8080/ws/tunnel \\
  --token sk-你的API-Key \\
  --backend-name 你的后端名称 \\
  --local-url http://localhost:8000`}</pre>
      </div>
    </div>
  )
}
