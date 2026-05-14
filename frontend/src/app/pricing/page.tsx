"use client"

import Link from "next/link"
import { useT } from "@/context/LocaleContext"

const TIERS: { key: string; usd: number; label: string; bonus?: string }[] = [
  { key: "starter",  usd: 20,   label: "$20" },
  { key: "standard", usd: 100,  label: "$100" },
  { key: "pro",      usd: 500,  label: "$500" },
  { key: "studio",   usd: 2000, label: "$2000" },
]

export default function PricingPage() {
  const t = useT()
  return (
    <div className="space-y-16 pb-20">
      <section className="text-center pt-16">
        <h1 className="text-[36px] font-semibold tracking-tight mb-3">
          {t({ en: "Top up. Spend by token. Done.", zh: "充值即用，按 token 扣费，仅此而已" })}
        </h1>
        <p className="text-base text-fg-muted max-w-xl mx-auto">
          {t({
            en: "Every dollar you top up lands in your balance at face value. Token prices are set by individual providers and shown on each model card.",
            zh: "你充多少 USD，余额就到账多少。每个 token 的单价由后端服务商各自标价，模型卡上一目了然。",
          })}
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TIERS.map((tier) => (
            <div key={tier.key} className="bg-surface border border-line rounded-xl p-5 text-center">
              <div className="text-xs uppercase tracking-wider text-fg-subtle mb-1">{tier.key}</div>
              <div className="text-3xl font-semibold mb-1">{tier.label}</div>
              <div className="text-xs text-fg-muted">{t({ en: "= " + tier.label + " balance", zh: "= " + tier.label + " 余额" })}</div>
            </div>
          ))}
        </div>
        <div className="text-center mt-6">
          <Link href="/billing" className="inline-flex items-center h-10 px-5 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90">
            {t({ en: "Top up now", zh: "立即充值" })}
          </Link>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-3">
        <h2 className="text-xl font-semibold mb-4 text-center">{t({ en: "How a $1 call splits", zh: "1 USD 调用费用的去向" })}</h2>
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          <Row label={t({ en: "Provider (GPU owner)", zh: "服务商（GPU 所有者）" })} pct="82.4%" usd="$0.824" muted={false} />
          <Row label={t({ en: "Platform (Tianshu)", zh: "平台（天枢）" })} pct="10%" usd="$0.100" muted={true} />
          <Row label={t({ en: "Payment channel (Freemius MoR)", zh: "支付渠道（Freemius MoR）" })} pct="7.6%" usd="$0.076" muted={true} last />
        </div>
        <p className="text-xs text-fg-muted text-center mt-3 leading-relaxed">
          {t({
            en: "The platform fee covers traffic, queueing, billing, fraud control. The payment channel covers card processing, FX, sales-tax remittance, refunds.",
            zh: "平台费用于流量、调度、计费、风控；渠道费由 Freemius（Merchant of Record）承担信用卡处理、外汇、销售税申报、退款。",
          })}
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-3 grid md:grid-cols-2 gap-4">
        <div className="bg-surface border border-line rounded-xl p-6">
          <h3 className="font-semibold mb-2">{t({ en: "No subscription", zh: "无订阅" })}</h3>
          <p className="text-[13px] text-fg-muted leading-relaxed">
            {t({
              en: "Top up only what you plan to use. No monthly seat fee, no trial credits, no expiry on your balance.",
              zh: "想用多少就充多少。没有月费、没有试用赠送、余额永不过期。",
            })}
          </p>
        </div>
        <div className="bg-surface border border-line rounded-xl p-6">
          <h3 className="font-semibold mb-2">{t({ en: "Self-owned backends are free", zh: "自己的后端 100% 免单" })}</h3>
          <p className="text-[13px] text-fg-muted leading-relaxed">
            {t({
              en: "Running a backend you registered yourself? Token traffic flowing to your own GPU is fully waived — no platform fee, no channel fee.",
              zh: "如果你调用的是自己注册的后端，token 费用 100% 豁免——不收平台费、也不收渠道费。",
            })}
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-3">
        <h2 className="text-xl font-semibold mb-4 text-center">{t({ en: "FAQ", zh: "常见问题" })}</h2>
        <div className="space-y-3">
          <Faq q={t({ en: "What currency do you charge?", zh: "用什么货币计费？" })} a={t({ en: "USD only. Freemius accepts cards in 60+ local currencies and converts to USD at the prevailing rate.", zh: "仅 USD。Freemius 支持 60+ 本地货币卡支付，按当时汇率结算为 USD。" })} />
          <Faq q={t({ en: "Where does my money go?", zh: "我的钱去哪了？" })} a={t({ en: "Your top up amount is credited as balance in full. Per-token deductions are tracked against this balance; the splits above are accounting entries — you never pay them on top of the token price.", zh: "充值金额按面值进入你的余额。按 token 扣费时直接从余额扣减；上面的费用拆分仅是平台与服务商之间的账务，对你而言不会额外加收。" })} />
          <Faq q={t({ en: "Refunds?", zh: "可以退款吗？" })} a={t({ en: "Yes — within 14 days of top up, contact admin and we'll refund any unused portion via Freemius. After 14 days the balance is non-refundable but never expires.", zh: "可以。充值 14 天内联系管理员，余额未消费部分原路退回。超过 14 天不再退款，但余额永不过期。" })} />
          <Faq q={t({ en: "When am I suspended?", zh: "什么时候会被暂停？" })} a={t({ en: "When your balance drops below your credit limit (default $0, i.e. when balance hits zero). Top up to resume immediately.", zh: "当余额跌破你的信用额度（默认 $0，也就是余额归零时）。充值后立即恢复调用。" })} />
        </div>
      </section>
    </div>
  )
}

function Row({ label, pct, usd, muted, last }: { label: string; pct: string; usd: string; muted: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 ${last ? "" : "border-b border-line"}`}>
      <div className="text-sm">{label}</div>
      <div className="flex items-baseline gap-3">
        <span className={`text-sm font-mono ${muted ? "text-fg-muted" : "text-fg font-semibold"}`}>{pct}</span>
        <span className={`text-xs font-mono ${muted ? "text-fg-subtle" : "text-fg-muted"}`}>{usd}</span>
      </div>
    </div>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="bg-surface border border-line rounded-lg p-4 group">
      <summary className="cursor-pointer text-sm font-medium list-none flex items-center justify-between">
        <span>{q}</span>
        <span className="text-fg-subtle group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <p className="text-[13px] text-fg-muted mt-2 leading-relaxed">{a}</p>
    </details>
  )
}
