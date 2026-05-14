"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useT, type Bilingual } from "@/context/LocaleContext"
import {
  IconMarket,
  IconCheck,
  IconServer,
  IconUser,
  IconKey,
  IconChart,
  IconInvoice,
  IconCog,
  IconShield,
  IconDoc,
  IconLayers,
} from "@/components/ui/Icon"
import { cn } from "@/lib/cn"
import * as React from "react"

type Item = { href: string; label: Bilingual; Icon: React.FC<React.SVGProps<SVGSVGElement>>; exact?: boolean }
type Group = { title: Bilingual; items: Item[] }

export default function SideNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const t = useT()

  const groups: Group[] = []

  const modelItems: Item[] = [{ href: "/models", label: { en: "Models", zh: "模型广场" }, Icon: IconMarket }]
  if (user) modelItems.push({ href: "/my-subscriptions", label: { en: "My Subscriptions", zh: "我的订阅" }, Icon: IconCheck })
  if (user && (user.role === "provider" || user.role === "both" || user.role === "admin")) {
    modelItems.push({ href: "/my-services", label: { en: "My Services", zh: "我的服务" }, Icon: IconServer })
  }
  groups.push({ title: { en: "Models", zh: "模型" }, items: modelItems })

  if (user) {
    const accountItems: Item[] = [
      { href: "/dashboard", label: { en: "Account info", zh: "账号信息" }, Icon: IconUser, exact: true },
      { href: "/dashboard/keys", label: { en: "API Keys", zh: "API 密钥" }, Icon: IconKey },
      { href: "/dashboard/usage", label: { en: "Usage", zh: "使用明细" }, Icon: IconChart },
      { href: "/dashboard/invoices", label: { en: "Invoices", zh: "账单" }, Icon: IconInvoice },
    ]
    if (user.role === "provider" || user.role === "both" || user.role === "admin") {
      accountItems.push(
        { href: "/dashboard/earnings", label: { en: "Earnings", zh: "我的收益" }, Icon: IconChart },
        { href: "/dashboard/withdrawals", label: { en: "Withdrawals", zh: "提现" }, Icon: IconInvoice },
      )
    }
    accountItems.push({ href: "/dashboard/other", label: { en: "Other", zh: "其他" }, Icon: IconCog })
    groups.push({ title: { en: "Account", zh: "账户管理" }, items: accountItems })
  }

  if (user && user.role === "admin") {
    groups.push({ title: { en: "Admin", zh: "管理" }, items: [{ href: "/admin", label: { en: "Admin", zh: "管理后台" }, Icon: IconShield }] })
  }

  groups.push({ title: { en: "Help", zh: "帮助" }, items: [{ href: "/docs", label: { en: "Docs", zh: "文档中心" }, Icon: IconDoc }] })

  const isActive = (item: Item) => {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + "/")
  }

  return (
    <aside className="w-60 shrink-0 hidden md:block border-r border-line bg-surface">
      <div className="sticky top-0 flex flex-col h-screen">
        <Link href="/" className="flex items-center gap-2 px-5 h-14 border-b border-line">
          <div className="w-7 h-7 rounded-lg bg-fg text-accent-fg grid place-items-center">
            <IconLayers className="w-4 h-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">{t({ en: "Tianshu", zh: "天枢" })}</span>
        </Link>
        <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4 space-y-5">
          {groups.map((g) => (
            <div key={g.title.en}>
              <div className="px-2.5 mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                {t(g.title)}
              </div>
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const active = isActive(item)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "group flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] transition-colors",
                          active
                            ? "bg-accent-soft text-fg font-medium"
                            : "text-fg-muted hover:bg-accent-soft/60 hover:text-fg",
                        )}
                      >
                        <item.Icon
                          className={cn(
                            "w-4 h-4 shrink-0",
                            active ? "text-fg" : "text-fg-subtle group-hover:text-fg-muted",
                          )}
                        />
                        <span className="truncate">{t(item.label)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-line text-[11px] text-fg-subtle">
          {t({ en: "v1 · OpenAI-compatible gateway", zh: "v1 · OpenAI 兼容网关" })}
        </div>
      </div>
    </aside>
  )
}
