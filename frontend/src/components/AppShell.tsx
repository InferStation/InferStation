"use client"

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
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    )
  }

  return (
    <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex gap-6 min-h-[calc(100vh-8rem)]">
        <SideNav />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </main>
  )
}
