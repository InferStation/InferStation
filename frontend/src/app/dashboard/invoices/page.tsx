"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"
import { formatByCurrency, symbolOf } from "@/lib/currency"

interface Invoice {
  id: number
  period_start: string
  period_end: string
  total_cost: number
  currency: string
  status: "unpaid" | "paid" | "void"
  due_date: string
  created_at: string
  paid_at: string | null
}

interface BillingStatus {
  current_month_cost: number
  current_month_by_currency?: Record<string, number>
  current_month_period: { start: string; end: string }
  invoices: Invoice[]
  unpaid_total: number
  unpaid_by_currency?: Record<string, number>
  overdue_total: number
  overdue_by_currency?: Record<string, number>
  is_suspended: boolean
  grace_days: number
}

interface SettleEligibility {
  eligible: boolean
  active_subscriptions: number
  listed_backends: number
  idle_minutes_required: number
  last_activity: string | null
  reasons: string[]
}

export default function InvoicesPage() {
  const t = useT()
  const [data, setData] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [settle, setSettle] = useState<SettleEligibility | null>(null)
  const [settling, setSettling] = useState(false)
  const [settleMsg, setSettleMsg] = useState("")
  const [settleErr, setSettleErr] = useState("")

  const reload = async () => {
    setLoading(true)
    try {
      const [s, e] = await Promise.all([
        apiFetch("/api/billing/status"),
        apiFetch("/api/billing/settle-now/eligibility").catch(() => null),
      ])
      setData(s)
      setSettle(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleSettleNow = async () => {
    setSettleErr(""); setSettleMsg("")
    if (!confirm(t({ en: "This will issue an invoice for the current month early. Once issued you can ask the admin to mark it paid; any further usage this month will start a new invoice. Continue?", zh: "将当前月份用量提前出账。出账后即可联系管理员结清；本月若再有用量需另起一张账单。继续？" }))) return
    setSettling(true)
    try {
      const r = await apiFetch("/api/billing/settle-now", { method: "POST" })
      setSettleMsg(t({ en: `Issued ${r.created?.length ?? 0} invoice(s)`, zh: `已出账 ${r.created?.length ?? 0} 张账单` }))
      await reload()
    } catch (err: unknown) {
      setSettleErr(err instanceof Error ? err.message : t({ en: "Failed to issue invoice", zh: "出账失败" }))
    } finally { setSettling(false) }
  }

  if (loading) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>
  if (!data) return <div className="text-center py-20 text-gray-500">{t({ en: "No data", zh: "无数据" })}</div>

  const today = new Date().toISOString().slice(0, 10)
  const fmtMonth = (s: string) => s.slice(0, 7)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t({ en: "Invoices", zh: "账单" })}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">{t({ en: "Usage this month", zh: "本月累计用量" })}</div>
          <div className="text-2xl font-semibold">{formatByCurrency(data.current_month_by_currency ?? { CNY: data.current_month_cost })}</div>
          <div className="text-xs text-gray-400 mt-1">{fmtMonth(data.current_month_period.start)} {t({ en: "· invoiced on the 1st", zh: "· 每月 1 日出账" })}</div>
        </div>
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">{t({ en: "Unpaid", zh: "未付账单" })}</div>
          <div className={`text-2xl font-semibold ${data.unpaid_total > 0 ? "text-amber-600" : "text-gray-400"}`}>
            {formatByCurrency(data.unpaid_by_currency ?? { CNY: data.unpaid_total })}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {data.unpaid_total > 0 ? t({ en: `${data.invoices.filter((i) => i.status === "unpaid").length} invoice(s)`, zh: `${data.invoices.filter((i) => i.status === "unpaid").length} 张` }) : t({ en: "None", zh: "无" })}
          </div>
        </div>
        <div className={`border rounded-lg p-5 ${data.is_suspended ? "bg-red-50 border-red-200" : "bg-white"}`}>
          <div className={`text-xs mb-1 ${data.is_suspended ? "text-red-700" : "text-gray-500"}`}>{t({ en: "Overdue", zh: "逾期金额" })}</div>
          <div className={`text-2xl font-semibold ${data.is_suspended ? "text-red-600" : "text-gray-400"}`}>
            {formatByCurrency(data.overdue_by_currency ?? { CNY: data.overdue_total })}
          </div>
          <div className={`text-xs mt-1 ${data.is_suspended ? "text-red-700" : "text-gray-400"}`}>
            {data.is_suspended ? t({ en: "⚠ Service suspended; restored after settlement", zh: "⚠ 服务已暂停，结清后恢复" }) : t({ en: `Due within ${data.grace_days} days after issue date`, zh: `到期后 ${data.grace_days} 天内付清` })}
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 mb-6 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="font-medium text-gray-800">{t({ en: "Settle current month early", zh: "提前结清本月账单" })}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {t({ en: "Invoices are normally issued automatically on the 1st of each month. If you plan to leave the platform or delete your account, you can issue the current-month invoice yourself after ", zh: "一般情况下账单于每月 1 日自动出账；若你想离开平台或注销账号，可在" })}<strong>{t({ en: `cancelling all subscriptions, taking down all services, and ${settle?.idle_minutes_required ?? 30} minutes of idle time`, zh: `取消所有订阅 + 下架所有服务 + 静默 ${settle?.idle_minutes_required ?? 30} 分钟` })}</strong>{t({ en: ". After issuing, any further billable requests this month will start a new invoice.", zh: "后，主动把当前月份用量出账并结清。出账后本月若再有计费请求会另起一张账单。" })}
            </p>
            {settle && settle.reasons.length > 0 && (
              <ul className="mt-2 text-xs text-amber-700 list-disc list-inside space-y-0.5">
                {settle.reasons.map((r, i) => (<li key={i}>{r}</li>))}
              </ul>
            )}
            {settleMsg && <p className="mt-2 text-xs text-green-600">{settleMsg}</p>}
            {settleErr && <p className="mt-2 text-xs text-red-600">{settleErr}</p>}
          </div>
          <button
            onClick={handleSettleNow}
            disabled={!settle?.eligible || settling}
            className="shrink-0 px-4 py-2 text-sm border border-line-strong text-fg rounded-lg hover:bg-accent-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {settling ? t({ en: "Issuing...", zh: "出账中..." }) : t({ en: "Settle now", zh: "提前结清" })}}
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 mb-6 text-sm leading-relaxed">
        <p className="font-medium">{t({ en: "Pay-as-you-go billing notes", zh: "计量后付费说明" })}</p>
        <ul className="list-disc list-inside mt-1 text-xs text-amber-800 space-y-0.5">
          <li>{t({ en: "This platform charges ", zh: "本平台采用" })}<span className="font-semibold">{t({ en: "per usage with monthly post-payment", zh: "按量计费 / 月结后付" })}</span>{t({ en: " — no prepayment required.", zh: "模式，不收取任何预付款" })}</li>
          <li>{t({ en: `Last month's invoice is auto-generated on the 1st; due date is end-of-month + ${data.grace_days} days`, zh: `每月 1 日自动生成上月账单；到期日为月末 + ${data.grace_days} 天` })}</li>
          <li>{t({ en: "Unpaid invoices accumulate; overdue invoices will ", zh: "未付账单会累计；逾期未付将" })}<span className="font-semibold">{t({ en: "automatically suspend", zh: "自动停用" })}</span>{t({ en: " your API access.", zh: " API 调用权限" })}</li>
          <li>{t({ en: "After payment, please contact the admin to mark the invoice paid; online payment is coming soon.", zh: "付款后请联系管理员标记“已付”，未来会支持在线支付" })}</li>
        </ul>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Period", zh: "账期" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Currency", zh: "货币" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Amount", zh: "金额" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Due date", zh: "到期日" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Issued at", zh: "出账时间" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Paid at", zh: "付款时间" })}</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-400">{t({ en: "No invoices yet (the first invoice will be generated on the 1st of next month)", zh: "暂无账单（首个账单将于下月 1 日生成）" })}</td>
              </tr>
            ) : (
              data.invoices.map((inv) => {
                const overdue = inv.status === "unpaid" && inv.due_date < today
                return (
                  <tr key={inv.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{fmtMonth(inv.period_start)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.currency || "CNY"}</td>
                    <td className="px-4 py-3 text-right font-mono">{symbolOf(inv.currency)}{inv.total_cost.toFixed(6)}</td>
                    <td className="px-4 py-3">{inv.due_date}</td>
                    <td className="px-4 py-3">
                      {inv.status === "paid" ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">{t({ en: "Paid", zh: "已付" })}</span>
                      ) : overdue ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-red-50 text-red-700 border border-red-200">{t({ en: "Overdue", zh: "逾期" })}</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">{t({ en: "Pending", zh: "待支付" })}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.created_at}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.paid_at || "—"}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
