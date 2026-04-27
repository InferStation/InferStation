"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import SideNav from "@/components/SideNav"

const NO_SHELL = ["/login", "/register"]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const hideShell = NO_SHELL.some((p) => pathname === p || pathname.startsWith(p + "/"))
  const showSide = !!user && !hideShell

  if (!showSide) {
    return (
      <>
        {!hideShell && (
          <header className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
              <Link href="/" className="text-xl font-bold text-indigo-600">天枢</Link>
              <div className="flex items-center gap-3">
                <Link href="/models" className="text-sm text-gray-600 hover:text-gray-900">模型广场</Link>
                <Link href="/docs" className="text-sm text-gray-600 hover:text-gray-900">文档</Link>
                <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">登录</Link>
                <Link href="/register" className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">注册</Link>
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
        <div className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </div>
      </div>
    </main>
  )
}
