"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"

interface Invoice {
  id: number
  period_start: string
  period_end: string
  total_cost: number
  status: "unpaid" | "paid" | "void"
  due_date: string
  created_at: string
  paid_at: string | null
}

interface BillingStatus {
  current_month_cost: number
  current_month_period: { start: string; end: string }
  invoices: Invoice[]
  unpaid_total: number
  overdue_total: number
  is_suspended: boolean
  grace_days: number
}

export default function InvoicesPage() {
  const [data, setData] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await apiFetch("/api/billing/status")
        setData(res)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="text-center py-20 text-gray-500">加载中...</div>
  if (!data) return <div className="text-center py-20 text-gray-500">无数据</div>

  const today = new Date().toISOString().slice(0, 10)
  const fmtMonth = (s: string) => s.slice(0, 7)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">账单</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">本月累计用量</div>
          <div className="text-2xl font-semibold">¥{data.current_month_cost.toFixed(6)}</div>
          <div className="text-xs text-gray-400 mt-1">{fmtMonth(data.current_month_period.start)} · 每月 1 日出账</div>
        </div>
        <div className="bg-white border rounded-lg p-5">
          <div className="text-xs text-gray-500 mb-1">未付账单</div>
          <div className={`text-2xl font-semibold ${data.unpaid_total > 0 ? "text-amber-600" : "text-gray-400"}`}>
            ¥{data.unpaid_total.toFixed(6)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {data.unpaid_total > 0 ? `${data.invoices.filter((i) => i.status === "unpaid").length} 张` : "无"}
          </div>
        </div>
        <div className={`border rounded-lg p-5 ${data.is_suspended ? "bg-red-50 border-red-200" : "bg-white"}`}>
          <div className={`text-xs mb-1 ${data.is_suspended ? "text-red-700" : "text-gray-500"}`}>逾期金额</div>
          <div className={`text-2xl font-semibold ${data.is_suspended ? "text-red-600" : "text-gray-400"}`}>
            ¥{data.overdue_total.toFixed(6)}
          </div>
          <div className={`text-xs mt-1 ${data.is_suspended ? "text-red-700" : "text-gray-400"}`}>
            {data.is_suspended ? "⚠ 服务已暂停，结清后恢复" : `到期后 ${data.grace_days} 天内付清`}
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 mb-6 text-sm leading-relaxed">
        <p className="font-medium">计量后付费说明</p>
        <ul className="list-disc list-inside mt-1 text-xs text-amber-800 space-y-0.5">
          <li>本平台采用<span className="font-semibold">按量计费 / 月结后付</span>模式，不收取任何预付款</li>
          <li>每月 1 日自动生成上月账单；到期日为月末 + {data.grace_days} 天</li>
          <li>未付账单会累计；逾期未付将<span className="font-semibold">自动停用</span> API 调用权限</li>
          <li>付款后请联系管理员标记"已付"，未来会支持在线支付</li>
        </ul>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">账期</th>
              <th className="text-right px-4 py-3 font-medium">金额</th>
              <th className="text-left px-4 py-3 font-medium">到期日</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">出账时间</th>
              <th className="text-left px-4 py-3 font-medium">付款时间</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400">暂无账单（首个账单将于下月 1 日生成）</td>
              </tr>
            ) : (
              data.invoices.map((inv) => {
                const overdue = inv.status === "unpaid" && inv.due_date < today
                return (
                  <tr key={inv.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{fmtMonth(inv.period_start)}</td>
                    <td className="px-4 py-3 text-right font-mono">¥{inv.total_cost.toFixed(6)}</td>
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
