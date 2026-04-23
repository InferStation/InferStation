"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useRouter } from "next/navigation"
import { formatByCurrency, symbolOf } from "@/lib/currency"

interface UserInfo {
  id: number
  username: string
  email: string
  role: string
  is_active: number
  verified: number
  created_at: string
  unpaid_total: number
  unpaid_by_currency?: Record<string, number>
  overdue_total: number
  overdue_by_currency?: Record<string, number>
}

interface UsageStat {
  username: string
  model: string
  currency?: string
  total_input: number
  total_output: number
  total_cost: number
  requests: number
}

interface Invoice {
  id: number
  user_id: number
  username: string
  period_start: string
  period_end: string
  total_cost: number
  currency: string
  status: "unpaid" | "paid" | "void"
  due_date: string
  created_at: string
  paid_at: string | null
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [tab, setTab] = useState<"users" | "usage" | "invoices">("users")

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) router.push("/dashboard")
  }, [loading, user, router])

  const reloadAll = () => {
    apiFetch("/api/admin/users").then(setUsers).catch(() => {})
    apiFetch("/api/admin/usage?days=30").then(setUsage).catch(() => {})
    apiFetch("/api/admin/invoices").then(setInvoices).catch(() => {})
  }

  useEffect(() => {
    if (user?.role === "admin") reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const toggleUser = async (id: number) => {
    await apiFetch(`/api/admin/users/${id}/toggle`, { method: "POST" })
    reloadAll()
  }

  const markPaid = async (invoiceId: number) => {
    if (!confirm("确认将该账单标记为已付？")) return
    await apiFetch(`/api/admin/invoices/${invoiceId}/pay`, { method: "POST" })
    reloadAll()
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
        <button
          onClick={() => setTab("invoices")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "invoices" ? "bg-indigo-600 text-white" : "bg-white border text-gray-600"}`}
        >
          账单 ({invoices.length})
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
                <th className="text-right px-4 py-3 font-medium">未付 / 逾期</th>
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
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    <span className={u.unpaid_total > 0 ? "text-amber-600" : "text-gray-400"}>
                      {formatByCurrency(u.unpaid_by_currency ?? { CNY: u.unpaid_total ?? 0 })}
                    </span>
                    <span className="mx-1 text-gray-300">/</span>
                    <span className={u.overdue_total > 0 ? "text-red-600 font-semibold" : "text-gray-400"}>
                      {formatByCurrency(u.overdue_by_currency ?? { CNY: u.overdue_total ?? 0 })}
                    </span>
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
                  <td className="px-4 py-3 text-right text-green-600">{symbolOf(u.currency)}{u.total_cost.toFixed(4)} <span className="text-xs text-gray-400">{u.currency || "CNY"}</span></td>
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

      {tab === "invoices" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">用户</th>
                <th className="text-left px-4 py-3 font-medium">账期</th>
                <th className="text-right px-4 py-3 font-medium">金额</th>
                <th className="text-left px-4 py-3 font-medium">到期日</th>
                <th className="text-left px-4 py-3 font-medium">状态</th>
                <th className="text-left px-4 py-3 font-medium">付款时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((inv) => {
                const today = new Date().toISOString().slice(0, 10)
                const overdue = inv.status === "unpaid" && inv.due_date < today
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 font-medium">{inv.username}</td>
                    <td className="px-4 py-3">{inv.period_start.slice(0, 7)}</td>
                    <td className="px-4 py-3 text-right font-mono">{symbolOf(inv.currency)}{inv.total_cost.toFixed(6)} <span className="text-xs text-gray-400">{inv.currency || "CNY"}</span></td>
                    <td className="px-4 py-3">{inv.due_date}</td>
                    <td className="px-4 py-3">
                      {inv.status === "paid" ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">已付</span>
                      ) : overdue ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-red-50 text-red-700 border border-red-200">逾期</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">待支付</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.paid_at || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {inv.status === "unpaid" && (
                        <button
                          onClick={() => markPaid(inv.id)}
                          className="text-sm text-green-600 hover:text-green-800"
                        >
                          标记已付
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无账单</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
