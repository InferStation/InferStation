"use client"

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { useAuth } from "@/context/AuthContext"

const API = process.env.NEXT_PUBLIC_API_URL || ""

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
  const { user, token } = useAuth()
  // Skip persisting on the very first apply that came from the server / storage.
  const hydratedFromServer = useRef(false)

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

  // When the authenticated user's stored locale becomes available, adopt it
  // without echoing it back to the server.
  useEffect(() => {
    if (!user) return
    const serverLocale = (user.locale === "en" || user.locale === "zh") ? user.locale : null
    if (serverLocale) {
      hydratedFromServer.current = true
      setLangState(serverLocale)
      try {
        localStorage.setItem(STORAGE_KEY, serverLocale)
        document.documentElement.lang = serverLocale === "zh" ? "zh-CN" : "en"
      } catch {}
    }
  }, [user])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en"
    } catch {}
    // Persist to the user's account so transactional emails follow the
    // chosen language. Anonymous visitors only get localStorage.
    if (token) {
      fetch(`${API}/api/user/locale`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ locale: l }),
      }).catch(() => {})
    }
  }, [token])

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
