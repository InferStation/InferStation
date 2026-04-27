"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface ApiKey {
  id: number
  key_prefix: string
  name: string
  is_active: number
  created_at: string
}

export default function KeysPage() {
  const t = useT()
  const { user } = useAuth()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState("")
  const [newKey, setNewKey] = useState("")

  useEffect(() => {
    if (user) loadKeys()
  }, [user])

  const loadKeys = () => apiFetch("/api/keys").then(setKeys).catch(() => {})

  const createKey = async () => {
    try {
      const data = await apiFetch("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName }),
      })
      setNewKey(data.key)
      setNewKeyName("")
      loadKeys()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t({ en: "Create failed", zh: "创建失败" }))
    }
  }

  const toggleKey = async (id: number) => {
    await apiFetch(`/api/keys/${id}/toggle`, { method: "PUT" })
    loadKeys()
  }

  const deleteKey = async (id: number) => {
    if (!confirm(t({ en: "Delete this key?", zh: "确定要删除这个 Key 吗？" }))) return
    await apiFetch(`/api/keys/${id}`, { method: "DELETE" })
    loadKeys()
  }

  if (!user) return null

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">API Key</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-4">{t({ en: "Create new key", zh: "创建新 Key" })}</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder={t({ en: "Key name (optional)", zh: "Key 名称（可选）" })}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none"
          />
          <button onClick={createKey} className="bg-fg text-white px-6 py-2 rounded-lg hover:bg-fg/90">{t({ en: "Create", zh: "创建" })}</button>
        </div>
        {newKey && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 mb-1">{t({ en: "Key created! Copy it now — it will not be shown again:", zh: "Key 创建成功！请立即复制，此后不再显示：" })}</p>
            <code className="text-sm font-mono bg-white px-2 py-1 rounded border break-all">{newKey}</code>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Prefix", zh: "前缀" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Name", zh: "名称" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Created at", zh: "创建时间" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Actions", zh: "操作" })}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="px-4 py-3 font-mono">{k.key_prefix}...</td>
                <td className="px-4 py-3">{k.name || "-"}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${k.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {k.is_active ? t({ en: "Active", zh: "有效" }) : t({ en: "Disabled", zh: "已停用" })}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{k.created_at}</td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button onClick={() => toggleKey(k.id)} className={`text-sm ${k.is_active ? "text-yellow-600 hover:text-yellow-800" : "text-green-600 hover:text-green-800"}`}>{k.is_active ? t({ en: "Disable", zh: "停用" }) : t({ en: "Activate", zh: "激活" })}</button>
                  <button onClick={() => deleteKey(k.id)} className="text-red-500 hover:text-red-700 text-sm">{t({ en: "Delete", zh: "删除" })}</button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">{t({ en: "No API keys yet", zh: "暂无 API Key" })}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
