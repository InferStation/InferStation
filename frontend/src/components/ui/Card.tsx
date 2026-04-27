import * as React from "react"
import { cn } from "@/lib/cn"

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn("bg-surface border border-line rounded-xl", className)}
      {...rest}
    />
  ),
)
Card.displayName = "Card"

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("px-5 py-4 border-b border-line flex items-center justify-between gap-3", className)} {...rest} />
)

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...rest }) => (
  <h3 className={cn("text-[15px] font-semibold text-fg", className)} {...rest} />
)

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...rest }) => (
  <p className={cn("text-xs text-fg-muted mt-1", className)} {...rest} />
)

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("p-5", className)} {...rest} />
)

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("px-5 py-3 border-t border-line bg-bg/50 rounded-b-xl flex items-center justify-end gap-2", className)} {...rest} />
)
