import * as React from "react"
import { cn } from "@/lib/cn"

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full h-9 px-3 text-sm rounded-lg bg-surface border border-line",
        "placeholder:text-fg-subtle",
        "focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...rest}
    />
  ),
)
Input.displayName = "Input"

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full px-3 py-2 text-sm rounded-lg bg-surface border border-line",
        "placeholder:text-fg-subtle",
        "focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40",
        "disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  ),
)
Textarea.displayName = "Textarea"

export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({ className, ...rest }) => (
  <label className={cn("block text-xs font-medium text-fg mb-1.5", className)} {...rest} />
)
