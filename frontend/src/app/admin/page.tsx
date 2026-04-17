"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useRouter } from "next/navigation"

interface UserInfo {
  id: number
  username: string
  email: string
  role: string
  balance: number
  is_active: number
  verified: number
  created_at: string
}

interface UsageStat {
  username: string
  model: string
  total_input: number
  total_output: number
  total_cost: number
  requests: number
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [tab, setTab] = useState<"users" | "usage">("users")
  const [adjustId, setAdjustId] = useState<number | null>(null)
  const [adjustAmount, setAdjustAmount] = useState("")

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) router.push("/dashboard")
  }, [loading, user, router])

  useEffect(() => {
    if (user?.role === "admin") {
      apiFetch("/api/admin/users").then(setUsers).catch(() => {})
      apiFetch("/api/admin/usage?days=30").then(setUsage).catch(() => {})
    }
  }, [user])

  const toggleUser = async (id: number) => {
    await apiFetch(`/api/admin/users/${id}/toggle`, { method: "POST" })
    const updated = await apiFetch("/api/admin/users")
    setUsers(updated)
  }

  const adjustBalance = async (id: number) => {
    const amount = parseFloat(adjustAmount)
    if (isNaN(amount)) return
    await apiFetch(`/api/admin/users/${id}/balance`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    })
    setAdjustId(null)
    setAdjustAmount("")
    const updated = await apiFetch("/api/admin/users")
    setUsers(updated)
  }

  if (loading || !user) return <div className="text-center py-20 text-gray-500">加载中...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理面板</h1>

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setTab("users")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "users" ? "bg-indigo-600 text-white" : "bg-white border text-gray-600"}`}
        >
          用户管理 ({users.length})
        </button>
        <button
          onClick={() => setTab("usage")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "usage" ? "bg-indigo-600 text-white" : "bg-white border text-gray-600"}`}
        >
          用量统计
        </button>
      </div>

      {tab === "users" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">用户名</th>
                <th className="text-left px-4 py-3 font-medium">邮箱</th>
                <th className="text-left px-4 py-3 font-medium">角色</th>
                <th className="text-right px-4 py-3 font-medium">余额</th>
                <th className="text-left px-4 py-3 font-medium">状态</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">{u.id}</td>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100">{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {adjustId === u.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                          step="0.01"
                          value={adjustAmount}
                          onChange={(e) => setAdjustAmount(e.target.value)}
                          className="w-24 px-2 py-1 border rounded text-sm"
                          placeholder="金额"
                        />
                        <button onClick={() => adjustBalance(u.id)} className="text-green-600 text-xs">确认</button>
                        <button onClick={() => setAdjustId(null)} className="text-gray-400 text-xs">取消</button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer text-green-600 hover:underline"
                        onClick={() => { setAdjustId(u.id); setAdjustAmount("") }}
                      >
                        ¥{u.balance.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {u.is_active ? "正常" : "禁用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.role !== "admin" && (
                      <button
                        onClick={() => toggleUser(u.id)}
                        className="text-sm text-orange-500 hover:text-orange-700"
                      >
                        {u.is_active ? "禁用" : "启用"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "usage" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">用户</th>
                <th className="text-left px-4 py-3 font-medium">模型</th>
                <th className="text-right px-4 py-3 font-medium">请求数</th>
                <th className="text-right px-4 py-3 font-medium">输入 tokens</th>
                <th className="text-right px-4 py-3 font-medium">输出 tokens</th>
                <th className="text-right px-4 py-3 font-medium">花费</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {usage.map((u, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 font-mono">{u.model}</td>
                  <td className="px-4 py-3 text-right">{u.requests}</td>
                  <td className="px-4 py-3 text-right">{u.total_input.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{u.total_output.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-green-600">¥{u.total_cost.toFixed(4)}</td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">暂无用量数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
