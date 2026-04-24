/**
 * 将 token 数格式化为最多 6 位数字显示：
 *   n < 1e6           → 原始整数（千位分隔）
 *   1e6 ≤ n < 1e9     → K（n/1e3）
 *   1e9 ≤ n < 1e12    → M（n/1e6）
 *   1e12 ≤ n < 1e15   → G（n/1e9）
 *   ≥ 1e15            → T（n/1e12）
 */
export function formatTokens(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return "0"
  const abs = Math.abs(v)
  const units: Array<{ min: number; div: number; suffix: string }> = [
    { min: 1e15, div: 1e12, suffix: "T" },
    { min: 1e12, div: 1e9, suffix: "G" },
    { min: 1e9, div: 1e6, suffix: "M" },
    { min: 1e6, div: 1e3, suffix: "K" },
  ]
  for (const u of units) {
    if (abs >= u.min) {
      const scaled = v / u.div
      const intPart = Math.trunc(Math.abs(scaled))
      const intDigits = intPart === 0 ? 1 : String(intPart).length
      const fractionDigits = Math.max(0, 6 - intDigits)
      return (
        scaled.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: fractionDigits,
        }) + u.suffix
      )
    }
  }
  return Math.trunc(v).toLocaleString()
}
