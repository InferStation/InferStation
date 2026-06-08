"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface Preset {
  key: string
  label: string
  usd_cents: number
  usd: number
}

interface PresetsResp {
  enabled: boolean
  sandbox: boolean
  presets: Preset[]
}

interface RefundRequestInfo {
  status: "pending" | "approved" | "rejected" | "failed"
  requested_cents: number
  fee_cents: number
  reason: string | null
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

interface Topup {
  id: number
  gross_usd_cents: number
  net_usd_cents: number
  channel_fee_cents: number
  refunded_cents: number
  channel: string
  channel_ref: string | null
  status: "pending" | "succeeded" | "refunded" | "partially_refunded" | "failed" | "orphan"
  created_at: string
  settled_at: string | null
  refund_request: RefundRequestInfo | null
}

interface BalanceStatus {
  balance_cents: number
  credit_limit_cents: number
  available_cents: number
}

interface TopupsResp {
  topups: Topup[]
  count: number
  refund_window_days: number
  refund_fee_bps: number
}

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

const STATUS_STYLE: Record<Topup["status"], string> = {
  succeeded: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  refunded: "bg-gray-100 text-gray-600 border-gray-200",
  partially_refunded: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  orphan: "bg-red-50 text-red-700 border-red-200",
}

const REQUEST_STYLE: Record<RefundRequestInfo["status"], string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  rejected: "bg-gray-100 text-gray-600 border-gray-200",
  failed: "bg-red-50 text-red-700 border-red-200",
}

export default function BillingPage() {
  const t = useT()
  const [presets, setPresets] = useState<PresetsResp | null>(null)
  const [topups, setTopups] = useState<Topup[]>([])
  const [refundWindow, setRefundWindow] = useState(14)
  const [refundFeeBps, setRefundFeeBps] = useState(1000)
  const [balance, setBalance] = useState<BalanceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [refundTopup, setRefundTopup] = useState<Topup | null>(null)
  const [refundReason, setRefundReason] = useState("")
  const [refundSubmitting, setRefundSubmitting] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const [p, h, b] = await Promise.all([
        apiFetch("/api/payments/topup/presets"),
        apiFetch("/api/payments/my-topups"),
        apiFetch("/api/billing/balance").catch(() => null),
      ])
      setPresets(p)
      const tr = h as TopupsResp
      setTopups(tr.topups || [])
      if (tr.refund_window_days) setRefundWindow(tr.refund_window_days)
      if (tr.refund_fee_bps) setRefundFeeBps(tr.refund_fee_bps)
      setBalance(b)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "load failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleTopup = async (preset: string) => {
    setError("")
    setSubmitting(preset)
    try {
      const r = await apiFetch("/api/payments/topup/checkout", {
        method: "POST",
        body: JSON.stringify({
          preset,
          return_url: typeof window !== "undefined" ? `${window.location.origin}/payment/return` : undefined,
        }),
      })
      if (r.url) {
        window.location.href = r.url
      } else {
        setError(t({ en: "Checkout URL not returned", zh: "未返回支付链接" }))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t({ en: "Checkout failed", zh: "发起支付失败" }))
    } finally {
      setSubmitting(null)
    }
  }

  const isRefundable = (_r: Topup) => {
    // Top ups are non-refundable. Admins may still issue out-of-band refunds for
    // chargebacks or fraud cases via the admin console, but users cannot request
    // refunds from the UI.
    return false
  }

  const openRefund = (r: Topup) => {
    setRefundTopup(r)
    setRefundReason("")
    setError("")
    setInfo("")
  }

  const submitRefund = async () => {
    if (!refundTopup) return
    setRefundSubmitting(true)
    try {
      const r = await apiFetch(`/api/payments/topups/${refundTopup.id}/refund-request`, {
        method: "POST",
        body: JSON.stringify({ reason: refundReason }),
      })
      setRefundTopup(null)
      setInfo(t({
        en: `Refund request submitted. You will be refunded ${usd(Math.round(r.requested_usd * 100))} (10% processing fee retained) once approved.`,
        zh: `退款申请已提交。审核通过后将退还 ${usd(Math.round(r.requested_usd * 100))}（已扣除 10% 手续费）。`,
      }))
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t({ en: "Refund request failed", zh: "申请退款失败" }))
    } finally {
      setRefundSubmitting(false)
    }
  }

  if (loading) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{t({ en: "Top up balance", zh: "充值" })}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {t({
          en: "Pay once, spend by token. Your top up lands in balance at face value — no fees on top.",
          zh: "一次充值，按 token 慢慢用。充多少进多少余额，不加收任何手续费。",
        })}
      </p>

      {balance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border rounded-lg p-5">
            <div className="text-xs text-gray-500 mb-1">{t({ en: "Current balance", zh: "当前余额" })}</div>
            <div className={`text-2xl font-semibold ${balance.balance_cents < 0 ? "text-red-600" : ""}`}>
              {usd(balance.balance_cents)}
            </div>
          </div>
          <div className="bg-white border rounded-lg p-5">
            <div className="text-xs text-gray-500 mb-1">{t({ en: "Credit limit", zh: "信用额度" })}</div>
            <div className="text-2xl font-semibold text-gray-600">{usd(balance.credit_limit_cents)}</div>
          </div>
          <div className="bg-white border rounded-lg p-5">
            <div className="text-xs text-gray-500 mb-1">{t({ en: "Available to spend", zh: "可用额度" })}</div>
            <div className={`text-2xl font-semibold ${balance.available_cents <= 0 ? "text-amber-600" : "text-green-600"}`}>
              {usd(balance.available_cents)}
            </div>
          </div>
        </div>
      )}

      {!presets?.enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-800">
          {t({
            en: "Online top up is not configured on this gateway. Please contact the admin to add credit manually.",
            zh: "本网关尚未配置在线充值。请联系管理员手动加额。",
          })}
        </div>
      )}

      {presets?.enabled && (
        <>
          {presets.sandbox && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
              {t({ en: "Sandbox mode — test cards only, no real charges.", zh: "沙箱模式 — 仅可用测试卡，不会真实扣款。" })}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {presets.presets.map((p) => (
              <button
                key={p.key}
                onClick={() => handleTopup(p.key)}
                disabled={submitting !== null}
                className="bg-white border rounded-xl p-5 text-center hover:border-fg hover:shadow disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">{p.key}</div>
                <div className="text-3xl font-semibold mb-2">{p.label}</div>
                <div className="text-xs text-gray-500">
                  {submitting === p.key ? t({ en: "Redirecting...", zh: "跳转中..." }) : t({ en: "Pay with card →", zh: "信用卡支付 →" })}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            {t({
              en: "Top ups credit your balance at face value. All top ups are final and non-refundable. Your balance never expires.",
              zh: "充值按面值进入余额。所有充值一经到账概不退款，余额永不过期。",
            })}
          </p>
        </>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">{error}</div>}
      {info && <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-700 mb-4">{info}</div>}

      <h2 className="text-lg font-semibold mb-3 mt-8">{t({ en: "Top up history", zh: "充值记录" })}</h2>
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Time", zh: "时间" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Amount", zh: "金额" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Refunded", zh: "已退" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Reference", zh: "交易号" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Action", zh: "操作" })}</th>
            </tr>
          </thead>
          <tbody>
            {topups.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400">
                  {t({ en: "No top ups yet", zh: "暂无充值记录" })}
                </td>
              </tr>
            ) : (
              topups.map((r) => {
                const refundable = isRefundable(r)
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-4 py-3 text-xs text-gray-500">{r.created_at}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-green-700">{usd(r.gross_usd_cents)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {r.refunded_cents > 0 ? (
                        <span className="text-amber-700">-{usd(r.refunded_cents)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit px-2 py-0.5 rounded text-xs border ${STATUS_STYLE[r.status]}`}>
                          {r.status}
                        </span>
                        {r.refund_request && (
                          <span
                            className={`inline-flex w-fit px-2 py-0.5 rounded text-xs border ${REQUEST_STYLE[r.refund_request.status]}`}
                            title={r.refund_request.review_note || r.refund_request.reason || ""}
                          >
                            {t({ en: "request", zh: "申请" })}: {r.refund_request.status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono break-all">{r.channel_ref || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openRefund(r)}
                        disabled={!refundable}
                        className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t({ en: "Request refund", zh: "申请退款" })}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {refundTopup && (() => {
        const remaining = refundTopup.gross_usd_cents - refundTopup.refunded_cents
        const fee = Math.floor(remaining * refundFeeBps / 10000)
        const refundAmount = remaining - fee
        return (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => !refundSubmitting && setRefundTopup(null)}>
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-2">{t({ en: "Request a refund", zh: "申请退款" })}</h3>
              <p className="text-sm text-gray-600 mb-4">
                {t({
                  en: `Original top-up: ${usd(refundTopup.gross_usd_cents)} · already refunded ${usd(refundTopup.refunded_cents)} · remaining ${usd(remaining)}.`,
                  zh: `原充值 ${usd(refundTopup.gross_usd_cents)} · 已退 ${usd(refundTopup.refunded_cents)} · 剩余 ${usd(remaining)}。`,
                })}
              </p>
              <div className="bg-gray-50 border rounded p-3 text-sm mb-4">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-600">{t({ en: "You will receive", zh: "实际退款" })}</span>
                  <span className="font-mono font-semibold text-green-700">{usd(refundAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{t({ en: "Processing fee (10%)", zh: "手续费 (10%)" })}</span>
                  <span className="font-mono">-{usd(fee)}</span>
                </div>
              </div>
              <label className="block text-sm text-gray-700 mb-1">{t({ en: "Reason (optional)", zh: "退款原因（可选）" })}</label>
              <textarea
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                rows={3}
                className="w-full border rounded p-2 text-sm mb-4"
                placeholder={t({ en: "Tell us why so we can improve.", zh: "告诉我们原因，便于改进。" })}
              />
              <p className="text-xs text-gray-500 mb-4">
                {t({
                  en: `The refund will be reviewed by an admin and returned to your original payment method. Refund window: ${refundWindow} days from top up.`,
                  zh: `退款将由管理员审核后原路退回。可退款时限：充值后 ${refundWindow} 天。`,
                })}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRefundTopup(null)}
                  disabled={refundSubmitting}
                  className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {t({ en: "Cancel", zh: "取消" })}
                </button>
                <button
                  onClick={submitRefund}
                  disabled={refundSubmitting}
                  className="px-4 py-2 text-sm bg-fg text-bg rounded hover:opacity-90 disabled:opacity-50"
                >
                  {refundSubmitting ? t({ en: "Submitting...", zh: "提交中..." }) : t({ en: "Submit request", zh: "提交申请" })}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
