import type { Metadata } from "next"
import "./globals.css"
import { AuthProvider } from "@/context/AuthContext"
import Navbar from "@/components/Navbar"
import Footer from "@/components/Footer"
import AppShell from "@/components/AppShell"

export const metadata: Metadata = {
  title: "天枢 - 模型服务聚合平台",
  description: "天枢 · 轻量级 LLM API 网关，连接消费者与模型提供者",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen flex flex-col">
        <AuthProvider>
          <Navbar />
          <AppShell>{children}</AppShell>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  )
}
