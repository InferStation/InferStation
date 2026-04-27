"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"

export type ThemeMode = "light" | "dark" | "system"

interface ThemeContextValue {
  mode: ThemeMode
  resolved: "light" | "dark"
  setMode: (m: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "theme"

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement
  if (resolved === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system")
  const [resolved, setResolved] = useState<"light" | "dark">("light")

  // Init from localStorage on mount
  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) as ThemeMode | null
    if (stored === "light" || stored === "dark" || stored === "system") {
      setModeState(stored)
    }
  }, [])

  // Resolve & apply whenever mode changes; if system, also listen to OS changes
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const compute = (): "light" | "dark" => {
      if (mode === "system") return mql.matches ? "dark" : "light"
      return mode
    }
    const sync = () => {
      const r = compute()
      setResolved(r)
      applyTheme(r)
    }
    sync()
    if (mode === "system") {
      mql.addEventListener("change", sync)
      return () => mql.removeEventListener("change", sync)
    }
  }, [mode])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch {}
  }, [])

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
