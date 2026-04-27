import type { Metadata } from "next"
import { Inter, Noto_Sans_SC, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/context/AuthContext"
import { ThemeProvider } from "@/context/ThemeContext"
import { LocaleProvider } from "@/context/LocaleContext"
import Footer from "@/components/Footer"
import AppShell from "@/components/AppShell"

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" })
const noto = Noto_Sans_SC({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-noto" })
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" })

export const metadata: Metadata = {
  title: "Tianshu — LLM API Gateway",
  description: "Tianshu · lightweight LLM API gateway connecting consumers and model providers",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Pre-hydration script: apply theme + language attributes before paint to avoid flash.
  const themeInit = `(function(){try{var s=localStorage.getItem('theme');var m=(s==='light'||s==='dark'||s==='system')?s:'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');document.documentElement.style.colorScheme=d?'dark':'light';var l=localStorage.getItem('lang');if(l!=='en'&&l!=='zh')l='en';document.documentElement.lang=l==='zh'?'zh-CN':'en';}catch(e){}})();`
  return (
    <html lang="en" className={`${inter.variable} ${noto.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="bg-bg text-fg min-h-screen flex flex-col font-sans antialiased">
        <ThemeProvider>
          <LocaleProvider>
            <AuthProvider>
              <AppShell>{children}</AppShell>
              <Footer />
            </AuthProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
