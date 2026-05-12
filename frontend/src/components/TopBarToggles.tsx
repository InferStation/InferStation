"use client"

import * as React from "react"
import { useTheme, type ThemeMode } from "@/context/ThemeContext"
import { useLocale, useT, type Lang } from "@/context/LocaleContext"
import {
  IconSun,
  IconMoon,
  IconMonitor,
  IconLanguages,
  IconChevronDown,
} from "@/components/ui/Icon"
import { cn } from "@/lib/cn"

/** Small dropdown shared between Theme and Language switchers. */
function MenuButton({
  ariaLabel,
  open,
  onToggle,
  trigger,
  children,
  buttonRef,
}: {
  ariaLabel: string
  open: boolean
  onToggle: () => void
  trigger: React.ReactNode
  children: React.ReactNode
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onToggle()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onToggle() }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onToggle])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1 h-8 px-2 rounded-md text-fg-muted hover:text-fg hover:bg-accent-soft transition-colors",
        )}
      >
        {trigger}
        <IconChevronDown className="w-3 h-3 text-fg-subtle" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[140px] rounded-xl border border-line bg-surface shadow-pop py-1 animate-fade-in z-40"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 h-8 text-[13px]",
        active ? "text-fg bg-accent-soft" : "text-fg-muted hover:text-fg hover:bg-accent-soft",
      )}
    >
      <span className="w-4 h-4 text-fg-subtle">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active && <span className="text-fg-subtle text-[11px]">●</span>}
    </button>
  )
}

export function ThemeToggle() {
  const { mode, resolved, setMode } = useTheme()
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const Trigger = resolved === "dark" ? IconMoon : IconSun
  const items: Array<{ key: ThemeMode; icon: React.ReactNode; label: string }> = [
    { key: "light", icon: <IconSun className="w-4 h-4" />, label: t({ en: "Light", zh: "浅色" }) },
    { key: "dark", icon: <IconMoon className="w-4 h-4" />, label: t({ en: "Dark", zh: "深色" }) },
    { key: "system", icon: <IconMonitor className="w-4 h-4" />, label: t({ en: "System", zh: "跟随系统" }) },
  ]
  return (
    <MenuButton
      ariaLabel={t({ en: "Appearance", zh: "外观" })}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      trigger={<Trigger className="w-4 h-4" />}
    >
      <div className="px-3 pb-1 pt-0.5 text-[11px] uppercase tracking-wider text-fg-subtle">
        {t({ en: "Appearance", zh: "外观" })}
      </div>
      {items.map((it) => (
        <MenuItem
          key={it.key}
          active={mode === it.key}
          onClick={() => { setMode(it.key); setOpen(false) }}
          icon={it.icon}
          label={it.label}
        />
      ))}
    </MenuButton>
  )
}

export function LanguageToggle() {
  const { lang, setLang } = useLocale()
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const items: Array<{ key: Lang; label: string }> = [
    { key: "en", label: "English" },
    { key: "zh", label: "中文" },
  ]
  return (
    <MenuButton
      ariaLabel={t({ en: "Language", zh: "语言" })}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      trigger={
        <span className="flex items-center gap-1">
          <IconLanguages className="w-4 h-4" />
          <span className="text-[12px] uppercase">{lang}</span>
        </span>
      }
    >
      <div className="px-3 pb-1 pt-0.5 text-[11px] uppercase tracking-wider text-fg-subtle">
        {t({ en: "Language", zh: "语言" })}
      </div>
      {items.map((it) => (
        <MenuItem
          key={it.key}
          active={lang === it.key}
          onClick={() => { setLang(it.key); setOpen(false) }}
          icon={<span className="text-[10px] uppercase">{it.key}</span>}
          label={it.label}
        />
      ))}
    </MenuButton>
  )
}
