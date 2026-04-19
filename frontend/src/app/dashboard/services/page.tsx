"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

interface Backend {
  id: number
  name: string
  url: string | null
  mode: string
  models: string[]
  tags: Record<string, string>
  status: string
  enabled: number
  input_price: number | null
  output_price: number | null
  is_public: number
  owner_name: string
  updated_at: string
}

export default function ServicesPage() {
  const { user, refreshUser } = useAuth()
  const [backends, setBackends] = useState<Backend[]>([])
  const [showForm, setShowForm] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    url: "",
    mode: "direct",
    family: "",
    models: "",
    tag_hardware: "",
    tag_framework: "",
    tag_quantization: "",
    input_price: "",
    output_price: "",
    is_public: true,
  })
  const [families, setFamilies] = useState<string[]>([])

  const isProvider = user && ["provider", "both", "admin"].includes(user.role)

  useEffect(() => {
    if (isProvider) loadBackends()
    apiFetch("/api/model-families").then((data: { families: string[] }) => setFamilies(data.families)).catch(() => {})
  }, [user])

  const loadBackends = () => apiFetch("/api/backends?mine=true").then(setBackends).catch(() => {})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.family) {
      alert("请选择模型类别")
      return
    }
    try {
      const tags: Record<string, string> = {}
      if (form.tag_hardware.trim()) tags.hardware = form.tag_hardware.trim()
      if (form.tag_framework.trim()) tags.framework = form.tag_framework.trim()
      if (form.tag_quantization.trim()) tags.quantization = form.tag_quantization.trim()

      const rawModels = form.models.split(",").map((s) => s.trim()).filter(Boolean)
      const models = rawModels.map((m) => m.includes("/") ? m : `${form.family}/${m}`)

      await apiFetch("/api/backends", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          url: form.mode === "direct" ? form.url : null,
          mode: form.mode,
          models,
          tags,
          input_price: form.input_price ? parseFloat(form.input_price) : null,
          output_price: form.output_price ? parseFloat(form.output_price) : null,
          is_public: form.is_public,
        }),
      })
      setShowForm(false)
      setForm({ name: "", url: "", mode: "direct", family: "", models: "", tag_hardware: "", tag_framework: "", tag_quantization: "", input_price: "", output_price: "", is_public: true })
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

  const toggleBackend = async (name: string) => {
    try {
      await apiFetch(`/api/backends/${name}/toggle`, { method: "PUT" })
      loadBackends()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    }
  }

  if (!user) return null

  const handleUpgrade = async () => {
    setUpgrading(true)
    try {
      await apiFetch("/api/user/upgrade-role", {
        method: "POST",
        body: JSON.stringify({ target_role: "both" }),
      })
      await refreshUser()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    } finally {
      setUpgrading(false)
    }
  }

  if (!isProvider) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">我的服务</h1>
        <div className="bg-white rounded-lg border p-6">
          <h2 className="font-semibold mb-2">成为模型服务提供者</h2>
          <p className="text-sm text-gray-600 mb-4">激活提供者身份后，你可以注册自己的模型后端，将模型服务分享给其他用户。</p>
          <button
            onClick={handleUpgrade}
            disabled={upgrading}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {upgrading ? "激活中..." : "激活"}
          </button>
        </div>
      </div>
    )
  }

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
              <label className="block text-sm font-medium text-gray-700 mb-1">模型类别</label>
              <select value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                <option value="">请选择模型类别</option>
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型列表（逗号分隔，无需填类别前缀）</label>
              <input type="text" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} placeholder={form.family ? `如 ${form.family === "Qwen" ? "Qwen3-8B, Qwen3.5-4B" : form.family === "THUDM" ? "glm-4-9b-chat" : "DeepSeek-R1-Distill-Qwen-7B"}` : "先选择模型类别"} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签（均为可选）</label>
              <div className="grid gap-3 md:grid-cols-3">
                <input type="text" value={form.tag_hardware} onChange={(e) => setForm({ ...form, tag_hardware: e.target.value })} placeholder="硬件，如 MI300X" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={form.tag_framework} onChange={(e) => setForm({ ...form, tag_framework: e.target.value })} placeholder="框架，如 vLLM" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={form.tag_quantization} onChange={(e) => setForm({ ...form, tag_quantization: e.target.value })} placeholder="量化，如 AWQ / FP16" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
              </div>
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
          <div key={b.id} className={`bg-white rounded-lg border p-4 ${!b.enabled ? "opacity-60" : ""}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-lg">{b.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs ${b.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{b.enabled ? "已上架" : "已下架"}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${b.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{b.status}</span>
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{b.mode === "tunnel" ? "隧道" : "直连"}</span>
                  {!b.is_public && <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">私有</span>}
                </div>
                {b.url && <p className="text-sm text-gray-500">URL: {b.url}</p>}
                <div className="text-sm text-gray-500">
                  模型:{" "}
                  {b.models.length > 0
                    ? b.models.map((m, i) => (
                        <span key={m}>
                          {i > 0 && ", "}
                          <Link href={`/models/${encodeURIComponent(m)}?backend_id=${b.id}`} className="text-indigo-600 hover:text-indigo-800 hover:underline">
                            {m}
                          </Link>
                        </span>
                      ))
                    : "未设置"}
                </div>
                {Object.keys(b.tags || {}).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Object.entries(b.tags).map(([k, v]) => (
                      <span key={k} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {v}
                      </span>
                    ))}
                  </div>
                )}
                {(b.input_price != null || b.output_price != null) && (
                  <p className="text-sm text-gray-500">定价: ¥{b.input_price}/M 输入 / ¥{b.output_price}/M 输出</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleBackend(b.name)}
                  className={`text-sm px-3 py-1 rounded ${b.enabled ? "bg-gray-100 text-gray-600 hover:bg-gray-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`}
                >
                  {b.enabled ? "下架" : "上架"}
                </button>
                <button onClick={() => deleteBackend(b.name)} className="text-red-500 hover:text-red-700 text-sm">删除</button>
              </div>
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
