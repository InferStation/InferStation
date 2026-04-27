import * as React from "react"
import { cn } from "@/lib/cn"

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent"

const TONES: Record<Tone, string> = {
  neutral: "bg-accent-soft text-fg-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger:  "bg-danger/10 text-danger",
  info:    "bg-blue-50 text-blue-700",
  accent:  "bg-fg text-accent-fg",
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  dot?: boolean
}

export const Badge: React.FC<BadgeProps> = ({ tone = "neutral", dot, className, children, ...rest }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
      TONES[tone],
      className,
    )}
    {...rest}
  >
    {dot && (
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "danger" && "bg-danger",
          tone === "info" && "bg-blue-500",
          tone === "neutral" && "bg-fg-subtle",
          tone === "accent" && "bg-accent-fg",
        )}
      />
    )}
    {children}
  </span>
)
