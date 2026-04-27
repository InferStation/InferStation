"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { IconLogout, IconUser, IconCog, IconChevronDown } from "@/components/ui/Icon"
import { cn } from "@/lib/cn"

const TITLE_MAP: Array<[RegExp, string]> = [
  [/^\/$/, "首页"],
  [/^\/models(\/.*)?$/, "模型广场"],
  [/^\/my-subscriptions(\/.*)?$/, "我的订阅"],
  [/^\/my-services(\/.*)?$/, "我的服务"],
  [/^\/dashboard$/, "账号信息"],
  [/^\/dashboard\/keys$/, "API 密钥"],
  [/^\/dashboard\/usage$/, "使用明细"],
  [/^\/dashboard\/invoices$/, "账单"],
  [/^\/dashboard\/other$/, "其他"],
  [/^\/admin(\/.*)?$/, "管理后台"],
  [/^\/docs(\/.*)?$/, "文档中心"],
  [/^\/about/, "关于天枢"],
  [/^\/terms/, "服务条款"],
  [/^\/privacy/, "隐私政策"],
  [/^\/sla/, "服务等级"],
]

function pageTitle(pathname: string): string {
  for (const [re, name] of TITLE_MAP) if (re.test(pathname)) return name
  return ""
}

export default function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const title = pageTitle(pathname)

  return (
    <header className="sticky top-0 z-30 h-12 bg-surface/80 backdrop-blur border-b border-line flex items-center justify-between px-5">
      <div className="flex items-center gap-2 text-[13px] text-fg-muted min-w-0">
        {title && <span className="text-fg font-medium truncate">{title}</span>}
      </div>
      <div className="flex items-center gap-2">
        {user ? (
          <div className="relative" ref={ref}>
            <button
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "flex items-center gap-2 h-8 pl-1 pr-2 rounded-full transition-colors",
                "hover:bg-accent-soft",
              )}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <div className="w-6 h-6 rounded-full bg-fg text-accent-fg grid place-items-center text-[10px] font-semibold uppercase">
                {user.username.slice(0, 2)}
              </div>
              <span className="text-[13px] text-fg max-w-[120px] truncate">{user.username}</span>
              <IconChevronDown className="w-3.5 h-3.5 text-fg-subtle" />
            </button>
            {open && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 rounded-xl border border-line bg-surface shadow-pop py-1.5 animate-fade-in"
              >
                <div className="px-3 py-2 border-b border-line">
                  <div className="text-[13px] font-medium truncate">{user.username}</div>
                  <div className="text-[11px] text-fg-muted truncate">{user.email}</div>
                </div>
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 h-8 text-[13px] text-fg hover:bg-accent-soft"
                >
                  <IconUser className="w-4 h-4 text-fg-subtle" /> 账号信息
                </Link>
                <Link
                  href="/dashboard/other"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 h-8 text-[13px] text-fg hover:bg-accent-soft"
                >
                  <IconCog className="w-4 h-4 text-fg-subtle" /> 偏好设置
                </Link>
                <div className="my-1 border-t border-line" />
                <button
                  onClick={() => {
                    if (confirm("确认退出登录？")) {
                      logout()
                      setOpen(false)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-danger hover:bg-danger/10"
                >
                  <IconLogout className="w-4 h-4" /> 退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={() => router.push("/login")}
              className="h-8 px-3 text-[13px] text-fg-muted hover:text-fg"
            >
              登录
            </button>
            <button
              onClick={() => router.push("/register")}
              className="h-8 px-3 text-[13px] rounded-md bg-fg text-accent-fg hover:bg-fg/90"
            >
              注册
            </button>
          </>
        )}
      </div>
    </header>
  )
}
