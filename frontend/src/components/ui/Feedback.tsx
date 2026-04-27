"use client"

import * as React from "react"
import { cn } from "@/lib/cn"
import { useT } from "@/context/LocaleContext"

interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <svg
      className={cn("animate-spin text-fg-subtle", className)}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

interface EmptyProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function Empty({ title, description, icon, action, className }: EmptyProps) {
  const t = useT()
  const finalTitle = title ?? t({ en: "No data", zh: "暂无数据" })
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-6", className)}>
      <div className="w-10 h-10 rounded-full bg-accent-soft flex items-center justify-center text-fg-subtle mb-3">
        {icon ?? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4-9 4-9-4z M3 12l9 4 9-4 M3 17l9 4 9-4" />
          </svg>
        )}
      </div>
      <div className="text-sm font-medium text-fg">{finalTitle}</div>
      {description && <div className="text-xs text-fg-muted mt-1 max-w-xs">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
