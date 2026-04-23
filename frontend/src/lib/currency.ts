// Helpers for displaying multi-currency amounts in the UI.

export const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
}

export function symbolOf(currency: string | undefined | null): string {
  if (!currency) return "¥"
  return CURRENCY_SYMBOLS[currency] || ""
}

/**
 * Format a per-currency map as a single human-readable string,
 * e.g. {CNY: 1.23, USD: 4.56} → "¥1.230000 + $4.560000".
 * Falls back to "¥0.000000" when the map is empty.
 */
export function formatByCurrency(
  map: Record<string, number> | undefined | null,
  digits = 6,
): string {
  if (!map || Object.keys(map).length === 0) return "¥0." + "0".repeat(digits)
  const parts: string[] = []
  // Stable order: CNY first, USD second, then others alphabetically.
  const keys = Object.keys(map).sort((a, b) => {
    const order = (k: string) => (k === "CNY" ? 0 : k === "USD" ? 1 : 2)
    const oa = order(a), ob = order(b)
    if (oa !== ob) return oa - ob
    return a.localeCompare(b)
  })
  for (const k of keys) {
    parts.push(`${symbolOf(k)}${(map[k] || 0).toFixed(digits)}`)
  }
  return parts.join(" + ")
}
