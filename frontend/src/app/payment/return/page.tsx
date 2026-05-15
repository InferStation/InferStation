"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useT } from "@/context/LocaleContext"

function ReturnInner() {
  const t = useT()
  const sp = useSearchParams()
  const { user } = useAuth()
  const paymentId = sp.get("payment_id") || sp.get("checkout_id")
  const canceled = sp.get("canceled") === "1" || sp.get("status") === "canceled"

  return (
    <div className="max-w-md mx-auto py-16 px-4 text-center">
      <div className="mx-auto mb-6 w-14 h-14 rounded-full grid place-items-center bg-fg text-accent-fg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
          {canceled ? (
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">
        {canceled
          ? t({ en: "Payment canceled", zh: "支付已取消" })
          : t({ en: "Thanks — payment received", zh: "感谢，支付已收到" })}
      </h1>
      <p className="text-sm text-fg-muted leading-relaxed mb-6">
        {canceled
          ? t({
              en: "You canceled the checkout. Your balance is unchanged. You can try again from the Billing page.",
              zh: "你取消了支付流程，余额未变动。可在「账单 / 充值」页重新发起。",
            })
          : t({
              en: "Your top-up is being processed. Balance is credited as soon as the payment provider confirms (usually within a minute).",
              zh: "充值正在处理中，待支付方回调确认后将自动入账（通常一分钟内）。",
            })}
      </p>
      {paymentId && !canceled && (
        <p className="text-xs text-fg-subtle mb-6 font-mono break-all">
          {t({ en: "Reference", zh: "支付凭证" })}: {paymentId}
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        {user ? (
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90"
          >
            {t({ en: "Open billing", zh: "查看账单" })}
          </Link>
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90"
          >
            {t({ en: "Sign in", zh: "登录查看" })}
          </Link>
        )}
        <Link
          href="/"
          className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-surface border border-line text-fg text-sm hover:bg-accent-soft"
        >
          {t({ en: "Back to home", zh: "返回首页" })}
        </Link>
      </div>
    </div>
  )
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-fg-muted">…</div>}>
      <ReturnInner />
    </Suspense>
  )
}
