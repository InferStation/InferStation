import type { Metadata } from "next"
import { Inter, Noto_Sans_SC, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/context/AuthContext"
import Footer from "@/components/Footer"
import AppShell from "@/components/AppShell"

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" })
const noto = Noto_Sans_SC({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-noto" })
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" })

export const metadata: Metadata = {
  title: "天枢 - 模型服务聚合平台",
  description: "天枢 · 轻量级 LLM API 网关，连接消费者与模型提供者",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${noto.variable} ${mono.variable}`}>
      <body className="bg-bg text-fg min-h-screen flex flex-col font-sans antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  )
}
