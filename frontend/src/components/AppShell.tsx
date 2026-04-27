"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import SideNav from "@/components/SideNav"
import TopBar from "@/components/TopBar"
import { IconLayers } from "@/components/ui/Icon"

const NO_SHELL = ["/login", "/register"]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const hideShell = NO_SHELL.some((p) => pathname === p || pathname.startsWith(p + "/"))
  const showSide = !!user && !hideShell

  // For login / register: render full-bleed children, no shell, no footer wrapper.
  if (hideShell) {
    return <>{children}</>
  }

  if (!showSide) {
    return (
      <>
        {!hideShell && (
          <header className="bg-surface border-b border-line">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-fg text-accent-fg grid place-items-center">
                  <IconLayers className="w-4 h-4" />
                </div>
                <span className="text-[15px] font-semibold tracking-tight">天枢</span>
              </Link>
              <div className="flex items-center gap-1">
                <Link href="/models" className="px-3 h-8 inline-flex items-center text-[13px] text-fg-muted hover:text-fg rounded-md hover:bg-accent-soft">模型广场</Link>
                <Link href="/docs" className="px-3 h-8 inline-flex items-center text-[13px] text-fg-muted hover:text-fg rounded-md hover:bg-accent-soft">文档</Link>
                <Link href="/login" className="px-3 h-8 inline-flex items-center text-[13px] text-fg-muted hover:text-fg rounded-md hover:bg-accent-soft">登录</Link>
                <Link href="/register" className="ml-1 px-3 h-8 inline-flex items-center text-[13px] rounded-md bg-fg text-accent-fg hover:bg-fg/90">注册</Link>
              </div>
            </div>
          </header>
        )}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </>
    )
  }

  return (
    <main className="flex-1 w-full">
      <div className="flex min-h-screen">
        <SideNav />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <div className="flex-1 px-6 lg:px-8 py-6 bg-bg">
            <div className="w-full">{children}</div>
          </div>
        </div>
      </div>
    </main>
  )
}
