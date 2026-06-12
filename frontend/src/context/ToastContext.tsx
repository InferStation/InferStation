"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/cn"

type ToastType = "success" | "error" | "info"

interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number
}

interface ToastOptions {
  type?: ToastType
  /** Auto-dismiss delay in ms. Defaults to 6000 for errors, 3500 otherwise. */
  duration?: number
}

interface ToastContextValue {
  show: (message: string, opts?: ToastOptions) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>")
  return ctx
}

let _nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const remove = React.useCallback((id: number) => {
    setToasts((list) => list.filter((x) => x.id !== id))
  }, [])

  const show = React.useCallback((message: string, opts?: ToastOptions) => {
    const type = opts?.type ?? "info"
    const duration = opts?.duration ?? (type === "error" ? 6000 : 3500)
    setToasts((list) => [...list, { id: ++_nextId, type, message, duration }])
  }, [])

  const value = React.useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, d) => show(m, { type: "success", duration: d }),
      error: (m, d) => show(m, { type: "error", duration: d }),
      info: (m, d) => show(m, { type: "info", duration: d }),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
            {toasts.map((tst) => (
              <ToastCard key={tst.id} toast={tst} onClose={remove} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 5a1 1 0 112 0v5a1 1 0 11-2 0V5zm1 9.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z"
        clipRule="evenodd"
      />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11.5a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 012 0v5a1 1 0 11-2 0V9z"
        clipRule="evenodd"
      />
    </svg>
  ),
}

const ICON_COLOR: Record<ToastType, string> = {
  success: "text-emerald-500",
  error: "text-red-500",
  info: "text-blue-500",
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: (id: number) => void }) {
  const [visible, setVisible] = React.useState(false)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const beginClose = React.useCallback(() => {
    setVisible(false)
    closeTimer.current = setTimeout(() => onClose(toast.id), 200)
  }, [onClose, toast.id])

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    const auto = setTimeout(beginClose, toast.duration)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(auto)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [beginClose, toast.duration])

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-3 min-w-[260px] max-w-sm rounded-xl border border-line bg-surface px-4 py-3 shadow-lg transition-all duration-200",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", ICON_COLOR[toast.type])}>{ICONS[toast.type]}</span>
      <p className="flex-1 text-sm text-fg whitespace-pre-line break-words leading-snug">{toast.message}</p>
      <button
        onClick={beginClose}
        aria-label="Close"
        className="shrink-0 -mr-1 -mt-0.5 rounded p-0.5 text-fg-subtle hover:text-fg hover:bg-accent-soft transition-colors"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M6.3 6.3a1 1 0 011.4 0L10 8.6l2.3-2.3a1 1 0 111.4 1.4L11.4 10l2.3 2.3a1 1 0 01-1.4 1.4L10 11.4l-2.3 2.3a1 1 0 01-1.4-1.4L8.6 10 6.3 7.7a1 1 0 010-1.4z" />
        </svg>
      </button>
    </div>
  )
}
