"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface EarningRow {
  period_ym: string
  gross_usd_cents: number
  channel_fee_cents: number
  platform_fee_cents: number
  provider_cut_cents: number
  finalized_at: string | null
}

interface EarningsResp {
  total_earned_cents: number
  total_paid_cents: number
  pending_withdraw_cents: number
  available_cents: number
  history: EarningRow[]
}

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function EarningsPage() {
  const t = useT()
  const [data, setData] = useState<EarningsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    (async () => {
      try {
        setData(await apiFetch("/api/provider/earnings"))
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "load failed")
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>
  if (error) return <div className="text-center py-20 text-red-500">{error}</div>
  if (!data) return null

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{t({ en: "Earnings", zh: "我的收益" })}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {t({
          en: "Consumer spend on your backends, split into channel fee (Freemius), platform fee (10%), and your cut.",
          zh: "消费者在你的后端上的支出，拆分为渠道费（Freemius）、平台费（10%）以及你的实际收益。",
        })}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">{t({ en: "Total earned", zh: "历史总收益" })}</div>
          <div className="text-2xl font-semibold">{usd(data.total_earned_cents)}</div>
        </div>
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">{t({ en: "Paid out", zh: "已提现" })}</div>
          <div className="text-2xl font-semibold text-gray-600">{usd(data.total_paid_cents)}</div>
        </div>
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">{t({ en: "Pending withdraw", zh: "提现处理中" })}</div>
          <div className="text-2xl font-semibold text-amber-600">{usd(data.pending_withdraw_cents)}</div>
        </div>
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">{t({ en: "Available", zh: "可提现" })}</div>
          <div className="text-2xl font-semibold text-green-600">{usd(data.available_cents)}</div>
          <a href="/dashboard/withdrawals" className="text-xs text-accent hover:underline mt-1 inline-block">
            {t({ en: "Withdraw →", zh: "去提现 →" })}
          </a>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Period", zh: "账期" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Gross", zh: "毛收入" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Channel fee", zh: "渠道费" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Platform fee", zh: "平台费" })}</th>
              <th className="text-right px-4 py-3 font-medium">{t({ en: "Your cut", zh: "实际收益" })}</th>
              <th className="text-left px-4 py-3 font-medium">{t({ en: "Finalized", zh: "结算时间" })}</th>
            </tr>
          </thead>
          <tbody>
            {data.history.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400">
                  {t({ en: "No earnings yet. Earnings are finalized on the 1st of the following month.", zh: "暂无收益。每月 1 日会结算上月收益。" })}
                </td>
              </tr>
            ) : (
              data.history.map((r) => (
                <tr key={r.period_ym} className="border-t">
                  <td className="px-4 py-3 font-medium">{r.period_ym}</td>
                  <td className="px-4 py-3 text-right font-mono">{usd(r.gross_usd_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-500">-{usd(r.channel_fee_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-500">-{usd(r.platform_fee_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-green-700">{usd(r.provider_cut_cents)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.finalized_at || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
