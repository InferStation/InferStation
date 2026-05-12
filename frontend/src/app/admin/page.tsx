"use client"

import { useEffect, useState } from "react"
import { formatTokens } from "@/lib/format"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useRouter } from "next/navigation"
import { formatByCurrency, symbolOf } from "@/lib/currency"
import { useT } from "@/context/LocaleContext"

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

interface PendingBackend {
  id: number
  name: string
  owner_name: string
  mode: string
  url?: string | null
  models: string[]
  tags: Record<string, string>
  input_price: number | null
  output_price: number | null
  cache_price: number | null
  currency: string
  review_requested_at: string | null
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
  const t = useT()
  const { user, loading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [pending, setPending] = useState<PendingBackend[]>([])
  const [tab, setTab] = useState<"users" | "usage" | "invoices" | "review">("users")

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) router.push("/dashboard")
  }, [loading, user, router])

  const reloadAll = () => {
    apiFetch("/api/admin/users").then(setUsers).catch(() => {})
    apiFetch("/api/admin/usage").then(setUsage).catch(() => {})
    apiFetch("/api/admin/invoices").then(setInvoices).catch(() => {})
    apiFetch("/api/admin/backends/pending").then(setPending).catch(() => {})
  }

  const approveBackend = async (name: string) => {
    if (!confirm(t({ en: `Approve listing of "${name}"?`, zh: `通过「${name}」的上架申请？` }))) return
    await apiFetch(`/api/admin/backends/${encodeURIComponent(name)}/approve`, { method: "POST", body: JSON.stringify({}) })
    reloadAll()
  }

  const rejectBackend = async (name: string) => {
    const note = prompt(t({ en: `Reject listing of "${name}" — enter a reason:`, zh: `驳回「${name}」的上架申请，请填写原因：` }))
    if (!note) return
    await apiFetch(`/api/admin/backends/${encodeURIComponent(name)}/reject`, { method: "POST", body: JSON.stringify({ note }) })
    reloadAll()
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
    if (!confirm(t({ en: "Mark this invoice as paid?", zh: "确认将该账单标记为已付？" }))) return
    await apiFetch(`/api/admin/invoices/${invoiceId}/pay`, { method: "POST" })
    reloadAll()
  }

  if (loading || !user) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t({ en: "Admin", zh: "管理面板" })}</h1>

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setTab("users")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "users" ? "bg-fg text-white" : "bg-white border text-gray-600"}`}
        >
          {t({ en: "Users", zh: "用户管理" })} ({users.length})
        </button>
        <button
          onClick={() => setTab("usage")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "usage" ? "bg-fg text-white" : "bg-white border text-gray-600"}`}
        >
          {t({ en: "Usage", zh: "用量统计" })}
        </button>
        <button
          onClick={() => setTab("invoices")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "invoices" ? "bg-fg text-white" : "bg-white border text-gray-600"}`}
        >
          {t({ en: "Invoices", zh: "账单" })} ({invoices.length})
        </button>
        <button
          onClick={() => setTab("review")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "review" ? "bg-fg text-white" : "bg-white border text-gray-600"} ${pending.length > 0 ? "ring-2 ring-amber-400" : ""}`}
        >
          {t({ en: "Service review", zh: "服务审核" })} ({pending.length})
        </button>
      </div>

      {tab === "users" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Username", zh: "用户名" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Email", zh: "邮箱" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Role", zh: "角色" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Unpaid / Overdue", zh: "未付 / 逾期" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Actions", zh: "操作" })}</th>
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
                      {formatByCurrency(u.unpaid_by_currency ?? { USD: u.unpaid_total ?? 0 })}
                    </span>
                    <span className="mx-1 text-gray-300">/</span>
                    <span className={u.overdue_total > 0 ? "text-red-600 font-semibold" : "text-gray-400"}>
                      {formatByCurrency(u.overdue_by_currency ?? { USD: u.overdue_total ?? 0 })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {u.is_active ? t({ en: "Active", zh: "正常" }) : t({ en: "Disabled", zh: "禁用" })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.role !== "admin" && (
                      <button
                        onClick={() => toggleUser(u.id)}
                        className="text-sm text-orange-500 hover:text-orange-700"
                      >
                        {u.is_active ? t({ en: "Disable", zh: "禁用" }) : t({ en: "Enable", zh: "启用" })}
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
          <div className="px-4 py-2 text-xs text-gray-500 bg-amber-50 border-b border-amber-100">{t({ en: "This-month usage summary (CST; archived and reset at 00:00 on the 1st of each month)", zh: "本月用量汇总（CST，每月 1 日 00:00 归档结算后归零）" })}</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "User", zh: "用户" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Model", zh: "模型" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Requests this month", zh: "本月请求数" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Input tokens this month", zh: "本月输入 tokens" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Output tokens this month", zh: "本月输出 tokens" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Spend this month", zh: "本月花费" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {usage.map((u, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3 font-mono">{u.model}</td>
                  <td className="px-4 py-3 text-right">{u.requests}</td>
                  <td className="px-4 py-3 text-right">{formatTokens(u.total_input)}</td>
                  <td className="px-4 py-3 text-right">{formatTokens(u.total_output)}</td>
                  <td className="px-4 py-3 text-right text-green-600">{symbolOf(u.currency)}{u.total_cost.toFixed(4)} <span className="text-xs text-gray-400">{u.currency || "USD"}</span></td>
                </tr>
              ))}
              {usage.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{t({ en: "No usage data", zh: "暂无用量数据" })}</td>
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
                <th className="text-left px-4 py-3 font-medium">{t({ en: "User", zh: "用户" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Period", zh: "账期" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Amount", zh: "金额" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Due date", zh: "到期日" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Paid at", zh: "付款时间" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Actions", zh: "操作" })}</th>
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
                    <td className="px-4 py-3 text-right font-mono">{symbolOf(inv.currency)}{inv.total_cost.toFixed(6)} <span className="text-xs text-gray-400">{inv.currency || "USD"}</span></td>
                    <td className="px-4 py-3">{inv.due_date}</td>
                    <td className="px-4 py-3">
                      {inv.status === "paid" ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">{t({ en: "Paid", zh: "已付" })}</span>
                      ) : overdue ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-red-50 text-red-700 border border-red-200">{t({ en: "Overdue", zh: "逾期" })}</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">{t({ en: "Unpaid", zh: "待支付" })}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.paid_at || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {inv.status === "unpaid" && (
                        <button
                          onClick={() => markPaid(inv.id)}
                          className="text-sm text-green-600 hover:text-green-800"
                        >
                          {t({ en: "Mark as paid", zh: "标记已付" })}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">{t({ en: "No invoices", zh: "暂无账单" })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "review" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Service", zh: "服务" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Provider", zh: "提供者" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Mode", zh: "模式" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Models", zh: "模型" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Pricing (input/output/cache)", zh: "定价（输入/输出/缓存）" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Submitted at", zh: "申请时间" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Actions", zh: "操作" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pending.map((b) => {
                const sym = "$"
                return (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3">{b.owner_name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100">{b.mode === "tunnel" ? t({ en: "Tunnel", zh: "隧道" }) : t({ en: "Direct", zh: "直连" })}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{(b.models || []).join(", ") || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {sym}{b.input_price ?? "-"} / {sym}{b.output_price ?? "-"} / {b.cache_price != null ? `${sym}${b.cache_price}` : t({ en: "10% default", zh: "默认10%" })}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{b.review_requested_at || "—"}</td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button onClick={() => approveBackend(b.name)} className="text-sm text-green-600 hover:text-green-800">{t({ en: "Approve", zh: "通过" })}</button>
                      <button onClick={() => rejectBackend(b.name)} className="text-sm text-red-600 hover:text-red-800">{t({ en: "Reject", zh: "驳回" })}</button>
                    </td>
                  </tr>
                )
              })}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">{t({ en: "No pending listing requests", zh: "暂无待审核的上架申请" })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
