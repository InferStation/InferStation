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

interface AdminWithdrawal {
  id: number
  user_id: number
  username: string
  email: string
  amount_usd_cents: number
  payout_method: string
  payout_address: string
  status: "pending" | "approved" | "paid" | "rejected"
  channel_ref: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
  paid_at: string | null
}

interface RefundRequest {
  id: number
  user_id: number
  topup_id: number
  username: string
  email: string
  reason: string
  requested_cents: number
  fee_cents: number
  status: "pending" | "approved" | "rejected" | "failed"
  review_note: string | null
  channel_refund_ref: string | null
  gross_usd_cents: number
  refunded_cents: number
  payment_id: string | null
  topup_created_at: string
  topup_status: string
  created_at: string
  reviewed_at: string | null
}

interface WebhookFailure {
  id: number
  channel: string
  kind: string
  event_type: string | null
  http_status: number | null
  detail: string | null
  body_preview: string | null
  created_at: string
}

export default function AdminPage() {
  const t = useT()
  const { user, loading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [pending, setPending] = useState<PendingBackend[]>([])
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([])
  const [refunds, setRefunds] = useState<RefundRequest[]>([])
  const [webhookFailures, setWebhookFailures] = useState<WebhookFailure[]>([])
  const [webhookRecent24h, setWebhookRecent24h] = useState(0)
  const [tab, setTab] = useState<"users" | "usage" | "invoices" | "review" | "withdrawals" | "refunds" | "webhooks">("users")

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) router.push("/dashboard")
  }, [loading, user, router])

  const reloadAll = () => {
    apiFetch("/api/admin/users").then(setUsers).catch(() => {})
    apiFetch("/api/admin/usage").then(setUsage).catch(() => {})
    apiFetch("/api/admin/invoices").then(setInvoices).catch(() => {})
    apiFetch("/api/admin/backends/pending").then(setPending).catch(() => {})
    apiFetch("/api/admin/withdrawals").then((r) => setWithdrawals(r.withdrawals || [])).catch(() => {})
    apiFetch("/api/admin/refund-requests").then((r) => setRefunds(r.requests || [])).catch(() => {})
    apiFetch("/api/admin/webhook-failures").then((r) => {
      setWebhookFailures(r.failures || [])
      setWebhookRecent24h(r.recent_24h || 0)
    }).catch(() => {})
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

  const approveWithdrawal = async (id: number) => {
    if (!confirm(t({ en: `Approve withdrawal #${id}? Funds are not transferred yet.`, zh: `通过提现 #${id}？此步骤不实际打款。` }))) return
    await apiFetch(`/api/admin/withdrawals/${id}/approve`, { method: "POST", body: JSON.stringify({}) })
    reloadAll()
  }

  const rejectWithdrawal = async (id: number) => {
    const note = prompt(t({ en: `Reject withdrawal #${id} — enter a reason:`, zh: `驳回提现 #${id}，请填写原因：` }))
    if (!note) return
    await apiFetch(`/api/admin/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) })
    reloadAll()
  }

  const markWithdrawalPaid = async (id: number) => {
    const ref = prompt(t({ en: `Mark withdrawal #${id} as paid — enter the transaction id / tx hash:`, zh: `标记提现 #${id} 已打款，请填写交易号 / 交易哈希：` }))
    if (!ref) return
    await apiFetch(`/api/admin/withdrawals/${id}/paid`, {
      method: "POST",
      body: JSON.stringify({ channel_ref: ref }),
    })
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

  const approveRefund = async (req: RefundRequest) => {
    const refundUsd = (req.requested_cents / 100).toFixed(2)
    const msg = t({
      en: `Issue Freemius partial refund of $${refundUsd} to user ${req.username} for payment ${req.payment_id}?\n\nThis calls the Freemius REST API immediately. The webhook will then auto-deduct user balance.`,
      zh: `通过 Freemius 给用户 ${req.username} 退款 $${refundUsd}（支付号 ${req.payment_id}）？\n\n此操作将立即调用 Freemius 接口，余额扣减由 webhook 自动完成。`,
    })
    if (!confirm(msg)) return
    const note = prompt(t({ en: "Internal note (optional):", zh: "管理员备注（可选）：" })) || ""
    try {
      const r = await apiFetch(`/api/admin/refund-requests/${req.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ note }),
      })
      alert(t({
        en: `Refund issued. Freemius refund id: ${r.channel_refund_ref || "(pending)"}.`,
        zh: `退款已发起。Freemius 退款编号：${r.channel_refund_ref || "（待回填）"}。`,
      }))
    } catch (e: unknown) {
      alert(t({ en: `Refund failed: ${e instanceof Error ? e.message : e}`, zh: `退款失败：${e instanceof Error ? e.message : e}` }))
    }
    reloadAll()
  }

  const rejectRefund = async (id: number) => {
    const note = prompt(t({ en: "Reject refund — enter a reason (shown to user):", zh: "驳回退款，请填写原因（将展示给用户）：" }))
    if (!note) return
    try {
      await apiFetch(`/api/admin/refund-requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ note }),
      })
    } catch (e: unknown) {
      alert(t({ en: `Reject failed: ${e instanceof Error ? e.message : e}`, zh: `驳回失败：${e instanceof Error ? e.message : e}` }))
    }
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
        <button
          onClick={() => setTab("withdrawals")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "withdrawals" ? "bg-fg text-white" : "bg-white border text-gray-600"} ${withdrawals.filter(w => w.status === "pending").length > 0 ? "ring-2 ring-amber-400" : ""}`}
        >
          {t({ en: "Withdrawals", zh: "提现审核" })} ({withdrawals.filter(w => w.status === "pending").length})
        </button>
        <button
          onClick={() => setTab("refunds")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "refunds" ? "bg-fg text-white" : "bg-white border text-gray-600"} ${refunds.filter(r => r.status === "pending").length > 0 ? "ring-2 ring-amber-400" : ""}`}
        >
          {t({ en: "Refunds", zh: "退款审核" })} ({refunds.filter(r => r.status === "pending").length})
        </button>
        <button
          onClick={() => setTab("webhooks")}
          className={`px-4 py-2 rounded-lg text-sm ${tab === "webhooks" ? "bg-fg text-white" : "bg-white border text-gray-600"} ${webhookRecent24h > 0 ? "ring-2 ring-red-400 text-red-600" : ""}`}
        >
          {t({ en: "Webhook failures", zh: "Webhook 失败" })} {webhookRecent24h > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 text-xs">{webhookRecent24h}</span>}
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

      {tab === "withdrawals" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Filed", zh: "申请时间" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Provider", zh: "提供者" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Amount", zh: "金额" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Method", zh: "方式" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Payout address", zh: "收款地址" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Ref / note", zh: "交易号 / 备注" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Actions", zh: "操作" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {withdrawals.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-3 text-xs text-gray-500">{w.created_at}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{w.username}</div>
                    <div className="text-xs text-gray-500">{w.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">${(w.amount_usd_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">{w.payout_method}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-mono max-w-[280px] truncate" title={w.payout_address}>{w.payout_address}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      w.status === "paid" ? "bg-green-100 text-green-700" :
                      w.status === "approved" ? "bg-blue-100 text-blue-700" :
                      w.status === "rejected" ? "bg-gray-100 text-gray-600" :
                      "bg-amber-100 text-amber-700"
                    }`}>{w.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {w.channel_ref ? <span className="font-mono">{w.channel_ref}</span> : "—"}
                    {w.review_note && <div className="mt-0.5">{w.review_note}</div>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                    {w.status === "pending" && (
                      <>
                        <button onClick={() => approveWithdrawal(w.id)} className="text-sm text-blue-600 hover:text-blue-800">{t({ en: "Approve", zh: "通过" })}</button>
                        <button onClick={() => rejectWithdrawal(w.id)} className="text-sm text-red-600 hover:text-red-800">{t({ en: "Reject", zh: "驳回" })}</button>
                      </>
                    )}
                    {(w.status === "pending" || w.status === "approved") && (
                      <button onClick={() => markWithdrawalPaid(w.id)} className="text-sm text-green-600 hover:text-green-800">{t({ en: "Mark paid", zh: "标记已打款" })}</button>
                    )}
                  </td>
                </tr>
              ))}
              {withdrawals.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">{t({ en: "No withdrawal requests", zh: "暂无提现申请" })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "refunds" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Filed", zh: "申请时间" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "User", zh: "用户" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Top up", zh: "充值" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Refund / Fee", zh: "退款 / 手续费" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Reason", zh: "原因" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "Actions", zh: "操作" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {refunds.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 text-xs text-gray-500">{r.created_at}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.username}</div>
                    <div className="text-xs text-gray-500">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold">${(r.gross_usd_cents / 100).toFixed(2)}</div>
                    <div className="text-xs text-gray-500">{r.topup_created_at}</div>
                    <div className="text-xs text-gray-500 font-mono truncate max-w-[160px]" title={r.payment_id || ""}>{r.payment_id || "—"}</div>
                    {r.refunded_cents > 0 && (
                      <div className="text-xs text-amber-700">{t({ en: "already refunded", zh: "已退" })} ${(r.refunded_cents / 100).toFixed(2)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <div className="text-green-700 font-semibold">${(r.requested_cents / 100).toFixed(2)}</div>
                    <div className="text-xs text-gray-500">- ${(r.fee_cents / 100).toFixed(2)} {t({ en: "fee", zh: "手续费" })}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[260px]">
                    <div className="whitespace-pre-wrap">{r.reason || "—"}</div>
                    {r.review_note && (
                      <div className="mt-1 text-amber-700 italic">{t({ en: "note", zh: "备注" })}: {r.review_note}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
                      r.status === "approved" ? "bg-green-100 text-green-700" :
                      r.status === "rejected" ? "bg-gray-100 text-gray-600" :
                      r.status === "failed" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>{r.status}</span>
                    {r.channel_refund_ref && (
                      <div className="text-xs text-gray-500 font-mono mt-1">{r.channel_refund_ref}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                    {r.status === "pending" && (
                      <>
                        <button onClick={() => approveRefund(r)} className="text-sm text-blue-600 hover:text-blue-800">{t({ en: "Approve & refund", zh: "通过并退款" })}</button>
                        <button onClick={() => rejectRefund(r.id)} className="text-sm text-red-600 hover:text-red-800">{t({ en: "Reject", zh: "驳回" })}</button>
                      </>
                    )}
                    {r.status === "failed" && (
                      <button onClick={() => approveRefund(r)} className="text-sm text-blue-600 hover:text-blue-800">{t({ en: "Retry", zh: "重试" })}</button>
                    )}
                  </td>
                </tr>
              ))}
              {refunds.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">{t({ en: "No refund requests", zh: "暂无退款申请" })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "webhooks" && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b text-sm flex justify-between items-center">
            <div>
              {t({ en: "Recent webhook delivery failures.", zh: "最近 webhook 投递失败记录。" })}
              {webhookRecent24h > 0 && (
                <span className="ml-2 text-red-600 font-semibold">
                  {t({ en: `${webhookRecent24h} in the last 24h`, zh: `近 24 小时 ${webhookRecent24h} 条` })}
                </span>
              )}
            </div>
            <button
              onClick={reloadAll}
              className="text-xs px-2 py-1 border rounded hover:bg-white"
            >
              {t({ en: "Refresh", zh: "刷新" })}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Time", zh: "时间" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Channel", zh: "渠道" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Kind", zh: "类型" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Event", zh: "事件" })}</th>
                <th className="text-right px-4 py-3 font-medium">{t({ en: "HTTP", zh: "状态码" })}</th>
                <th className="text-left px-4 py-3 font-medium">{t({ en: "Detail", zh: "详情" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {webhookFailures.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{f.created_at}</td>
                  <td className="px-4 py-3 text-xs">{f.channel}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      f.kind === "signature" ? "bg-red-100 text-red-700" :
                      f.kind === "handler" ? "bg-amber-100 text-amber-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>{f.kind}</span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-600">{f.event_type || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{f.http_status ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[420px]">
                    <div className="whitespace-pre-wrap break-words">{f.detail || "—"}</div>
                    {f.body_preview && (
                      <details className="mt-1">
                        <summary className="text-xs text-gray-400 cursor-pointer">{t({ en: "body preview", zh: "原始 body" })}</summary>
                        <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto">{f.body_preview}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
              {webhookFailures.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">{t({ en: "No webhook failures recorded", zh: "暂无 webhook 失败记录" })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
