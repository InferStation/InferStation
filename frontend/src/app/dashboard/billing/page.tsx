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

interface Topup {
  id: number
  gross_usd_cents: number
  net_usd_cents: number
  channel_fee_cents: number
  channel: string
  channel_ref: string | null
  status: "pending" | "succeeded" | "refunded" | "failed" | "orphan"
  created_at: string
  settled_at: string | null
}

interface BalanceStatus {
  balance_cents: number
  credit_limit_cents: number
  available_cents: number
}

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

const STATUS_STYLE: Record<Topup["status"], string> = {
  succeeded: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  refunded: "bg-gray-100 text-gray-600 border-gray-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  orphan: "bg-red-50 text-red-700 border-red-200",
}

export default function BillingPage() {
  const t = useT()
  const [presets, setPresets] = useState<PresetsResp | null>(null)
  const [topups, setTopups] = useState<Topup[]>([])
  const [balance, setBalance] = useState<BalanceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState("")

  const reload = async () => {
    setLoading(true)
    try {
      const [p, h, b] = await Promise.all([
        apiFetch("/api/payments/topup/presets"),
        apiFetch("/api/payments/my-topups"),
        apiFetch("/api/billing/balance").catch(() => null),
      ])
      setPresets(p)
      setTopups(h.topups || [])
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
          return_url: typeof window !== "undefined" ? `${window.location.origin}/dashboard/billing` : undefined,
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
              en: "Top ups credit your balance at face value. Refunds available within 14 days minus a 10% processing fee (covers non-recoverable Freemius / card-network fees).",
              zh: "充值按面值进入余额。14 天内可申请退款，扣除 10% 手续费（用于抵消 Freemius / 卡组织已收取的通道费）。",
            })}
          </p>
        </>
      )}

      {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

      <h2 className="text-lg font-semibold mb-3 mt-8">{t({ en: "Top up history", zh: "充值记录" })}</h2>
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Time", zh: "时间" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Amount", zh: "金额" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Channel fee", zh: "渠道费" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Channel", zh: "渠道" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Status", zh: "状态" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Reference", zh: "交易号" })}</th>
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
              topups.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 text-xs text-gray-500">{r.created_at}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-green-700">{usd(r.gross_usd_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-500">-{usd(r.channel_fee_cents)}</td>
                  <td className="px-4 py-3 text-xs">{r.channel}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{r.channel_ref || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
