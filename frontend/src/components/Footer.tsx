"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useT } from "@/context/LocaleContext"

const HIDE = ["/login", "/register"]

export default function Footer() {
  const pathname = usePathname()
  const t = useT()
  const { user } = useAuth()
  if (HIDE.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null
  // Closed beta: for unauthenticated visitors (legal/payment-return pages),
  // render a minimal footer with only policy links + contact, to avoid
  // leaking product surface (/models, /docs, /about, /dashboard).
  if (!user) {
    return (
      <footer className="bg-surface border-t border-line mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-[13px] text-fg-muted flex flex-wrap items-center justify-between gap-3">
          <span className="text-fg-subtle text-xs">© {new Date().getFullYear()} Tianshu</span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-fg">{t({ en: "Terms", zh: "服务条款" })}</Link>
            <Link href="/privacy" className="hover:text-fg">{t({ en: "Privacy", zh: "隐私政策" })}</Link>
            <Link href="/sla" className="hover:text-fg">{t({ en: "SLA", zh: "服务等级" })}</Link>
            <a href="mailto:bleu_jours@outlook.com" className="hover:text-fg">{t({ en: "Contact", zh: "联系" })}</a>
          </div>
        </div>
      </footer>
    )
  }
  return (
    <footer className="bg-surface border-t border-line mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-[13px]">
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">{t({ en: "Product", zh: "产品" })}</h4>
            <ul className="space-y-1.5 text-fg-muted">
              <li><Link href="/models" className="hover:text-fg">{t({ en: "Models", zh: "模型广场" })}</Link></li>
              <li><Link href="/docs" className="hover:text-fg">{t({ en: "Developer Docs", zh: "开发者文档" })}</Link></li>
              <li><Link href="/dashboard" className="hover:text-fg">{t({ en: "Console", zh: "控制台" })}</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">{t({ en: "Policies", zh: "政策" })}</h4>
            <ul className="space-y-1.5 text-fg-muted">
              <li><Link href="/terms" className="hover:text-fg">{t({ en: "Terms", zh: "服务条款" })}</Link></li>
              <li><Link href="/privacy" className="hover:text-fg">{t({ en: "Privacy", zh: "隐私政策" })}</Link></li>
              <li><Link href="/sla" className="hover:text-fg">{t({ en: "SLA", zh: "服务等级" })}</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">{t({ en: "About", zh: "关于" })}</h4>
            <ul className="space-y-1.5 text-fg-muted">
              <li><Link href="/about" className="hover:text-fg">{t({ en: "About Tianshu", zh: "关于天枢" })}</Link></li>
              <li>
                <a href="mailto:bleu_jours@outlook.com" className="hover:text-fg">{t({ en: "Contact", zh: "联系我们" })}</a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">{t({ en: "Disclaimer", zh: "免责声明" })}</h4>
            <p className="text-fg-muted text-xs leading-relaxed">
              {t({ en: "Tianshu is an open aggregation platform; model content is supplied by third-party providers. The platform is not responsible for the accuracy or legality of generated content. Please read the ", zh: "天枢是一个开放聚合平台，模型内容由第三方提供者提供。平台不对生成内容的准确性或合法性负责，使用前请阅读" })}
              <Link href="/terms" className="text-fg hover:underline ml-1">{t({ en: "Terms of Service", zh: "服务条款" })}</Link>{t({ en: " before use.", zh: "。" })}
            </p>
          </div>
        </div>
        <div className="border-t border-line mt-6 pt-4 text-xs text-fg-subtle flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} {t({ en: "Tianshu Gateway", zh: "天枢 · Tianshu Gateway" })}</span>
          <span>OpenAI-compatible LLM aggregation platform</span>
        </div>
      </div>
    </footer>
  )
}
