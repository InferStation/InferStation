"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"

export type Lang = "en" | "zh"

interface LocaleContextValue {
  lang: Lang
  setLang: (l: Lang) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const STORAGE_KEY = "lang"

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Default to English; SSR initial is "en" to match the pre-hydration script.
  const [lang, setLangState] = useState<Lang>("en")

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === "en" || stored === "zh") {
        setLangState(stored)
        document.documentElement.lang = stored === "zh" ? "zh-CN" : "en"
      } else {
        document.documentElement.lang = "en"
      }
    } catch {}
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en"
    } catch {}
  }, [])

  return (
    <LocaleContext.Provider value={{ lang, setLang }}>{children}</LocaleContext.Provider>
  )
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider")
  return ctx
}

export type Bilingual = { en: string; zh: string }

/** Translate an inline {en, zh} pair against the current locale. */
export function useT() {
  const { lang } = useLocale()
  return (b: Bilingual) => b[lang]
}
