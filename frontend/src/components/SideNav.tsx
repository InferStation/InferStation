"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"

type Item = { href: string; label: string; icon: string; exact?: boolean }
type Group = { title: string; items: Item[] }

const I = {
  market: "M3 7l9-4 9 4M5 9.5V19a1 1 0 001 1h12a1 1 0 001-1V9.5M9 21V12h6v9",
  sub: "M5 13l4 4L19 7",
  service: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2",
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  key: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z",
  chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  invoice: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  cog: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  shield: "M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z",
  doc: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z",
}

export default function SideNav() {
  const pathname = usePathname()
  const { user } = useAuth()

  const groups: Group[] = []

  // 模型
  const modelItems: Item[] = [{ href: "/models", label: "模型广场", icon: I.market }]
  if (user) modelItems.push({ href: "/my-subscriptions", label: "我的订阅", icon: I.sub })
  if (user && (user.role === "provider" || user.role === "both" || user.role === "admin")) {
    modelItems.push({ href: "/my-services", label: "我的服务", icon: I.service })
  }
  groups.push({ title: "模型", items: modelItems })

  // 账户管理
  if (user) {
    groups.push({
      title: "账户管理",
      items: [
        { href: "/dashboard", label: "账号信息", icon: I.user, exact: true },
        { href: "/dashboard/keys", label: "API 密钥", icon: I.key },
        { href: "/dashboard/usage", label: "使用明细", icon: I.chart },
        { href: "/dashboard/invoices", label: "账单", icon: I.invoice },
        { href: "/dashboard/other", label: "其他", icon: I.cog },
      ],
    })
  }

  // 管理
  if (user && user.role === "admin") {
    groups.push({ title: "管理", items: [{ href: "/admin", label: "管理后台", icon: I.shield }] })
  }

  // 文档
  groups.push({ title: "帮助", items: [{ href: "/docs", label: "文档中心", icon: I.doc }] })

  const isActive = (item: Item) => {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + "/")
  }

  return (
    <aside className="w-56 shrink-0 hidden md:block border-r border-gray-200 bg-white">
      <nav className="sticky top-0 p-3 space-y-4 max-h-screen overflow-y-auto">
        <Link href="/" className="flex items-center px-2 py-2 mb-1">
          <span className="text-xl font-bold text-indigo-600">天枢</span>
        </Link>
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {g.title}
            </div>
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = isActive(item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-indigo-50 text-indigo-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
