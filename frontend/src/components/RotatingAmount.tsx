"use client"

import { useEffect, useState } from "react"
import { symbolOf } from "@/lib/currency"

/**
 * Show a per-currency amount map by cycling through each currency every
 * `intervalMs` (default 3s).  Currencies with a zero / missing value are
 * skipped.  When only one currency has a value, no rotation happens.
 *
 * Currency display order: USD first, then others alphabetically — same as
 * formatByCurrency in lib/currency.ts.
 */
export function RotatingAmount({
  map,
  digits = 6,
  intervalMs = 3000,
  prefix,
}: {
  map: Record<string, number> | undefined | null
  digits?: number
  intervalMs?: number
  prefix?: string
}) {
  const entries = Object.entries(map || {})
    .filter(([, v]) => Number(v) > 0)
    .sort(([a], [b]) => {
      const order = (k: string) => (k === "USD" ? 0 : 1)
      const oa = order(a), ob = order(b)
      if (oa !== ob) return oa - ob
      return a.localeCompare(b)
    })

  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (entries.length <= 1) return
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % entries.length)
    }, intervalMs)
    return () => clearInterval(t)
  }, [entries.length, intervalMs])

  if (entries.length === 0) {
    return (
      <span>
        {prefix}$0.{"0".repeat(digits)}
      </span>
    )
  }

  const safeIdx = idx % entries.length
  const [cur, val] = entries[safeIdx]
  return (
    <span title={entries.map(([k, v]) => `${symbolOf(k)}${v.toFixed(digits)}`).join("\n")}>
      {prefix}
      {symbolOf(cur)}
      {val.toFixed(digits)}
    </span>
  )
}
