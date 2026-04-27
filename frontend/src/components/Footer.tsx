"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const HIDE = ["/login", "/register"]

export default function Footer() {
  const pathname = usePathname()
  if (HIDE.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null
  return (
    <footer className="bg-surface border-t border-line mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-[13px]">
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">产品</h4>
            <ul className="space-y-1.5 text-fg-muted">
              <li><Link href="/models" className="hover:text-fg">模型广场</Link></li>
              <li><Link href="/docs" className="hover:text-fg">开发者文档</Link></li>
              <li><Link href="/dashboard" className="hover:text-fg">控制台</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">政策</h4>
            <ul className="space-y-1.5 text-fg-muted">
              <li><Link href="/terms" className="hover:text-fg">服务条款</Link></li>
              <li><Link href="/privacy" className="hover:text-fg">隐私政策</Link></li>
              <li><Link href="/sla" className="hover:text-fg">服务等级</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">关于</h4>
            <ul className="space-y-1.5 text-fg-muted">
              <li><Link href="/about" className="hover:text-fg">关于天枢</Link></li>
              <li>
                <a href="mailto:support@tianshu-gateway.cloud" className="hover:text-fg">联系我们</a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-fg mb-2 text-xs uppercase tracking-wider text-fg-subtle">免责声明</h4>
            <p className="text-fg-muted text-xs leading-relaxed">
              天枢是一个开放聚合平台，模型内容由第三方提供者提供。平台不对生成内容的准确性或合法性负责，
              使用前请阅读
              <Link href="/terms" className="text-fg hover:underline ml-1">服务条款</Link>。
            </p>
          </div>
        </div>
        <div className="border-t border-line mt-6 pt-4 text-xs text-fg-subtle flex flex-wrap justify-between gap-2">
          <span>© {new Date().getFullYear()} 天枢 · Tianshu Gateway</span>
          <span>OpenAI-compatible LLM aggregation platform</span>
        </div>
      </div>
    </footer>
  )
}
