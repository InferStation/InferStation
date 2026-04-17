import type { Metadata } from "next"
import "./globals.css"
import { AuthProvider } from "@/context/AuthContext"
import Navbar from "@/components/Navbar"

export const metadata: Metadata = {
  title: "LLM Gateway - 模型服务聚合平台",
  description: "轻量级 LLM API 网关，连接消费者与模型提供者",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen flex flex-col">
        <AuthProvider>
          <Navbar />
          <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  )
}
