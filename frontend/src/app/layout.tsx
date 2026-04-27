import type { Metadata } from "next"
import { Inter, Noto_Sans_SC, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/context/AuthContext"
import { ThemeProvider } from "@/context/ThemeContext"
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
  // Pre-hydration script: read theme preference and apply class before paint
  // to avoid light/dark flash.
  const themeInit = `(function(){try{var s=localStorage.getItem('theme');var m=(s==='light'||s==='dark'||s==='system')?s:'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`
  return (
    <html lang="zh-CN" className={`${inter.variable} ${noto.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="bg-bg text-fg min-h-screen flex flex-col font-sans antialiased">
        <ThemeProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
            <Footer />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
