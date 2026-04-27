"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useT } from "@/context/LocaleContext"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const t = useT()

  useEffect(() => {
    if (!loading && !user) router.push("/login")
  }, [loading, user, router])

  if (loading || !user) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>

  return <>{children}</>
}
