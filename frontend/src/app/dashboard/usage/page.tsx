"use client"

import { useEffect, useState } from "react"
import { formatTokens } from "@/lib/format"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"

interface UsageStat {
  model: string
  currency: string
  total_input: number
  total_output: number
  total_cached: number
  total_cost: number
  self_cost: number
  billable_cost: number
  requests: number
}

interface HourlyRow {
  hour_start: string
  model: string
  currency: string
  total_input: number
  total_output: number
  total_cached: number
  total_cost: number
  self_cost: number
  billable_cost: number
  requests: number
}

interface DailyRow {
  day: string
  model: string
  currency: string
  total_input: number
  total_output: number
  total_cached: number
  total_cost: number
  self_cost: number
  billable_cost: number
  requests: number
}

type Tab = "summary" | "hourly" | "daily"

export default function UsagePage() {
  const t = useT()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>("summary")
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [hourly, setHourly] = useState<HourlyRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (!user) return
    if (tab === "summary") apiFetch(`/api/usage`).then(setUsage).catch(() => {})
    else if (tab === "hourly") apiFetch(`/api/usage/hourly`).then(setHourly).catch(() => {})
    else if (tab === "daily") apiFetch(`/api/usage/daily?days=${days}`).then(setDaily).catch(() => {})
  }, [user, days, tab])

  if (!user) return null

  const symbol = (c: string) => (c === "USD" ? "$" : "¥")
  const fmtCost = (v: number, c: string) => {
    const s = symbol(c)
    if (v > 0 && v < 0.0000005) return t({ en: `below ${s}0.000000`, zh: `低于 ${s}0.000000` })
    return `${s}${v.toFixed(6)}`
  }

  const totalRequests = usage.reduce((s, u) => s + u.requests, 0)
  const totalInput = usage.reduce((s, u) => s + u.total_input, 0)
  const totalOutput = usage.reduce((s, u) => s + u.total_output, 0)
  const totalCached = usage.reduce((s, u) => s + (u.total_cached || 0), 0)
  const costByCurrency = usage.reduce<Record<string, number>>((acc, u) => {
    const cur = u.currency || "CNY"
    acc[cur] = (acc[cur] || 0) + u.total_cost
    return acc
  }, {})
  const selfByCurrency = usage.reduce<Record<string, number>>((acc, u) => {
    const cur = u.currency || "CNY"
    acc[cur] = (acc[cur] || 0) + (u.self_cost || 0)
    return acc
  }, {})
  const billableByCurrency = usage.reduce<Record<string, number>>((acc, u) => {
    const cur = u.currency || "CNY"
    acc[cur] = (acc[cur] || 0) + (u.billable_cost ?? (u.total_cost - (u.self_cost || 0)))
    return acc
  }, {})
  const fmtCurrencyMap = (m: Record<string, number>) =>
    Object.keys(m).length === 0
      ? "¥0.000000"
      : Object.entries(m).map(([c, v]) => fmtCost(v, c)).join(" + ")
  const totalCostStr = fmtCurrencyMap(costByCurrency)
  const totalSelfStr = fmtCurrencyMap(selfByCurrency)
  const totalBillableStr = fmtCurrencyMap(billableByCurrency)
  const hasSelf = Object.values(selfByCurrency).some((v) => v > 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">{t({ en: "Usage", zh: "使用明细" })}</h1>
        <div className="flex items-center gap-2">
          {tab === "daily" && (
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-fg/40 focus:outline-none"
            >
              <option value={7}>{t({ en: "Last 7 days", zh: "近 7 天" })}</option>
              <option value={30}>{t({ en: "Last 30 days", zh: "近 30 天" })}</option>
              <option value={90}>{t({ en: "Last 90 days", zh: "近 90 天" })}</option>
            </select>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        {(["summary", "hourly", "daily"] as Tab[]).map((tk) => (
          <button
            key={tk}
            onClick={() => setTab(tk)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === tk ? "border-fg text-fg font-medium" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {tk === "summary" ? t({ en: "Per-model summary", zh: "按模型汇总" }) : tk === "hourly" ? t({ en: "Today by hour", zh: "今日按小时" }) : t({ en: "History by day", zh: "历史按天" })}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400 mb-4">
        {t({ en: "All times in ", zh: "所有时间按 " })}<span className="font-medium">{t({ en: "CST (UTC+8)", zh: "CST（UTC+8）" })}</span>{t({ en: "; daily archival at 00:00 also refreshes pricing; ", zh: " 统计；每日 00:00 归档前一日数据并刷新计价价格；" })}<span className="font-medium">{t({ en: "“Per-model summary” only counts the current month and resets to zero after the monthly billing run on the 1st at 00:00.", zh: "「按模型汇总」仅统计本月用量，每月 1 日 00:00 归档结算后归零" })}</span>{t({ en: "", zh: "。" })}
      </p>

      {tab === "summary" && (
        <>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5 mb-6">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t({ en: "Requests this month", zh: "本月请求数" })}</div>
              <div className="text-2xl font-bold">{totalRequests}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t({ en: "Input tokens this month", zh: "本月输入 tokens" })}</div>
              <div className="text-2xl font-bold">{formatTokens(totalInput)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t({ en: "Output tokens this month", zh: "本月输出 tokens" })}</div>
              <div className="text-2xl font-bold">{formatTokens(totalOutput)}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t({ en: "Cached tokens this month", zh: "本月缓存命中 tokens" })}</div>
              <div className="text-2xl font-bold text-sky-600">{formatTokens(totalCached)}</div>
              <div className="text-xs text-gray-400 mt-1">
                {totalInput > 0 ? t({ en: `${((totalCached / totalInput) * 100).toFixed(1)}% hit rate`, zh: `${((totalCached / totalInput) * 100).toFixed(1)}% 命中率` }) : "—"}
              </div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t({ en: "Total cost this month", zh: "本月总花费" })}</div>
              <div className="text-xl font-bold text-green-600">{totalBillableStr}</div>
              {hasSelf && (
                <div className="text-xs text-emerald-700 mt-1" title={t({ en: "Calls to your own backend models are fully discounted", zh: "使用自己名下的后端模型已全额减免" })}>{t({ en: `Owned-model discount: ${totalSelfStr}`, zh: `已减免自有模型 ${totalSelfStr}` })}</div>
              )}
            </div>
          </div>

          {usage.length === 0 ? (
            <p className="text-gray-500">{t({ en: "No usage records yet", zh: "暂无使用记录" })}</p>
          ) : (
            <div className="bg-white rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">{t({ en: "Model", zh: "模型" })}</th>
                    <th className="text-right px-4 py-3 font-medium">{t({ en: "Requests", zh: "请求数" })}</th>
                    <th className="text-right px-4 py-3 font-medium">{t({ en: "Input tokens", zh: "输入 tokens" })}</th>
                    <th className="text-right px-4 py-3 font-medium">{t({ en: "Output tokens", zh: "输出 tokens" })}</th>
                    <th className="text-right px-4 py-3 font-medium">{t({ en: "Cached", zh: "缓存命中" })}</th>
                    <th className="text-right px-4 py-3 font-medium" title={t({ en: "Calls to your own backend models are fully discounted", zh: "使用自己名下的后端模型已全额减免" })}>{t({ en: "Cost", zh: "花费" })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {usage.map((u, i) => {
                    const cur = u.currency || "CNY"
                    const self = u.self_cost || 0
                    const billable = u.billable_cost ?? (u.total_cost - self)
                    return (
                    <tr key={i}>
                      <td className="px-4 py-3 font-mono">{u.model}</td>
                      <td className="px-4 py-3 text-right">{u.requests}</td>
                      <td className="px-4 py-3 text-right">{formatTokens(u.total_input)}</td>
                      <td className="px-4 py-3 text-right">{formatTokens(u.total_output)}</td>
                      <td className="px-4 py-3 text-right text-sky-600">
                        {formatTokens(u.total_cached || 0)}
                        {u.total_input > 0 && (
                          <span className="text-xs text-gray-400 ml-1">({((u.total_cached / u.total_input) * 100).toFixed(0)}%)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{fmtCost(billable, cur)} <span className="text-xs text-gray-400">{cur}</span></td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "hourly" && (
        hourly.length === 0 ? (
          <p className="text-gray-500">{t({ en: "No calls today (hourly buckets are written immediately on each request)", zh: "今日暂无调用（数据每次请求后即时写入小时桶）" })}</p>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t({ en: "Time slot (CST)", zh: "时段 (CST)" })}</th>
                  <th className="text-left px-4 py-3 font-medium">{t({ en: "Model", zh: "模型" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Requests", zh: "请求数" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Input", zh: "输入" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Output", zh: "输出" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Cached", zh: "缓存命中" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Cost", zh: "花费" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Owned discount", zh: "自有模型减免" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Billable", zh: "实际计费" })}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {hourly.map((r, i) => {
                  const cur = r.currency || "CNY"
                  const self = r.self_cost || 0
                  const billable = r.billable_cost ?? (r.total_cost - self)
                  return (
                  <tr key={i}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.hour_start}</td>
                    <td className="px-4 py-3 font-mono">{r.model}</td>
                    <td className="px-4 py-3 text-right">{r.requests}</td>
                    <td className="px-4 py-3 text-right">{formatTokens(r.total_input)}</td>
                    <td className="px-4 py-3 text-right">{formatTokens(r.total_output)}</td>
                    <td className="px-4 py-3 text-right text-sky-600">{formatTokens(r.total_cached || 0)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtCost(r.total_cost, cur)}</td>
                    <td className={`px-4 py-3 text-right ${self > 0 ? "text-emerald-600" : "text-gray-300"}`}>{self > 0 ? `−${fmtCost(self, cur)}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{fmtCost(billable, cur)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === "daily" && (
        daily.length === 0 ? (
          <p className="text-gray-500">{t({ en: "No archived data yet (archived once daily at 00:00 CST/UTC+8)", zh: "暂无归档数据（每日 00:00 CST（UTC+8） 归档一次）" })}</p>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t({ en: "Date", zh: "日期" })}</th>
                  <th className="text-left px-4 py-3 font-medium">{t({ en: "Model", zh: "模型" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Requests", zh: "请求数" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Input", zh: "输入" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Output", zh: "输出" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Cached", zh: "缓存命中" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Cost", zh: "花费" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Owned discount", zh: "自有模型减免" })}</th>
                  <th className="text-right px-4 py-3 font-medium">{t({ en: "Billable", zh: "实际计费" })}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {daily.map((r, i) => {
                  const cur = r.currency || "CNY"
                  const self = r.self_cost || 0
                  const billable = r.billable_cost ?? (r.total_cost - self)
                  return (
                  <tr key={i}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.day}</td>
                    <td className="px-4 py-3 font-mono">{r.model}</td>
                    <td className="px-4 py-3 text-right">{r.requests}</td>
                    <td className="px-4 py-3 text-right">{formatTokens(r.total_input)}</td>
                    <td className="px-4 py-3 text-right">{formatTokens(r.total_output)}</td>
                    <td className="px-4 py-3 text-right text-sky-600">{formatTokens(r.total_cached || 0)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmtCost(r.total_cost, cur)}</td>
                    <td className={`px-4 py-3 text-right ${self > 0 ? "text-emerald-600" : "text-gray-300"}`}>{self > 0 ? `−${fmtCost(self, cur)}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{fmtCost(billable, cur)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
