"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface Withdrawal {
  id: number
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

interface Summary {
  available_cents: number
}

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

const STATUS_STYLE: Record<Withdrawal["status"], string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  paid: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-gray-100 text-gray-600 border-gray-200",
}

export default function WithdrawalsPage() {
  const t = useT()
  const [rows, setRows] = useState<Withdrawal[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [msg, setMsg] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("paypal")
  const [address, setAddress] = useState("")

  const reload = async () => {
    setLoading(true)
    try {
      const [w, s] = await Promise.all([
        apiFetch("/api/provider/withdrawals"),
        apiFetch("/api/provider/earnings"),
      ])
      setRows(w.withdrawals || [])
      setSummary({ available_cents: s.available_cents })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "load failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(""); setMsg("")
    const usdAmt = parseFloat(amount)
    if (!Number.isFinite(usdAmt) || usdAmt < 50) {
      setError(t({ en: "Minimum withdrawal is $50", zh: "最低提现金额为 $50" }))
      return
    }
    const cents = Math.round(usdAmt * 100)
    if (!address.trim()) {
      setError(t({ en: "Payout address is required", zh: "请填写收款地址" }))
      return
    }
    setSubmitting(true)
    try {
      await apiFetch("/api/provider/withdrawals", {
        method: "POST",
        body: JSON.stringify({
          amount_usd_cents: cents,
          payout_method: method,
          payout_address: address.trim(),
        }),
      })
      setMsg(t({ en: "Withdrawal filed; admin will review shortly.", zh: "提现申请已提交，管理员会尽快审核。" }))
      setAmount("")
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t({ en: "Submit failed", zh: "提交失败" }))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{t({ en: "Withdrawals", zh: "提现" })}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {t({
          en: "Cash out your provider earnings. Minimum $50 per withdrawal. Admin manually pays out via the channel below.",
          zh: "把你的服务商收益提现到指定渠道。每笔最低 $50，由管理员人工审核打款。",
        })}
      </p>

      <div className="bg-white border rounded-lg p-5 mb-6">
        <div className="text-xs text-gray-500 mb-1">{t({ en: "Available to withdraw", zh: "当前可提现" })}</div>
        <div className="text-3xl font-semibold text-green-600 mb-4">{usd(summary?.available_cents ?? 0)}</div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">{t({ en: "Amount (USD)", zh: "金额 (USD)" })}</span>
            <input
              type="number"
              min="50"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50.00"
              className="w-full px-3 py-2 border rounded text-sm"
              required
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">{t({ en: "Method", zh: "方式" })}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full px-3 py-2 border rounded text-sm">
              <option value="paypal">PayPal</option>
              <option value="wise">Wise</option>
              <option value="usdt-trc20">USDT (TRC20)</option>
              <option value="usdt-erc20">USDT (ERC20)</option>
              <option value="bank-wire">{t({ en: "Bank wire", zh: "银行电汇" })}</option>
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="block text-xs text-gray-500 mb-1">
              {t({ en: "Address / account", zh: "收款地址 / 账号" })}
            </span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t({ en: "PayPal email / wallet address / IBAN ...", zh: "PayPal 邮箱 / 钱包地址 / IBAN..." })}
              className="w-full px-3 py-2 border rounded text-sm"
              required
            />
          </label>
          <div className="sm:col-span-4 flex items-center justify-between gap-3">
            <div className="text-xs">
              {error && <span className="text-red-600">{error}</span>}
              {msg && <span className="text-green-600">{msg}</span>}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm border border-line-strong rounded-lg hover:bg-accent-soft disabled:opacity-40"
            >
              {submitting ? t({ en: "Submitting...", zh: "提交中..." }) : t({ en: "Request withdrawal", zh: "申请提现" })}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Filed", zh: "申请时间" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Amount", zh: "金额" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Method", zh: "方式" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Address", zh: "地址" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Tx ref / note", zh: "交易号 / 备注" })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400">
                  {t({ en: "No withdrawals yet", zh: "暂无提现记录" })}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 text-xs text-gray-500">{r.created_at}</td>
                  <td className="px-4 py-3 text-right font-mono">{usd(r.amount_usd_cents)}</td>
                  <td className="px-4 py-3">{r.payout_method}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[260px] truncate" title={r.payout_address}>{r.payout_address}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {r.channel_ref ? <span className="font-mono">{r.channel_ref}</span> : "—"}
                    {r.review_note && <div className="mt-0.5">{r.review_note}</div>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
