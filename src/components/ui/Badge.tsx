/**
 * Badge — small status pill.
 */
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "brand" | "teal" | "fuchsia" | "success" | "warning" | "danger" | "outline" | "ghost";

const VARIANTS: Record<Variant, string> = {
  default: "bg-overlay/6 text-ink-secondary border-line-subtle",
  brand: "bg-brand-indigo-500/15 text-brand-indigo-300 border-brand-indigo-400/30",
  teal: "bg-brand-teal-500/15 text-brand-teal-300 border-brand-teal-400/30",
  fuchsia: "bg-brand-fuchsia-500/15 text-brand-fuchsia-300 border-brand-fuchsia-400/30",
  success: "bg-status-success/15 text-status-success border-status-success/30",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/30",
  danger: "bg-status-danger/15 text-status-danger border-status-danger/30",
  outline: "bg-transparent text-ink-tertiary border-line-medium",
  ghost: "bg-transparent text-ink-tertiary border-transparent",
};

export interface BadgeProps {
  variant?: Variant;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ variant = "default", children, icon, className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-2xs font-medium uppercase tracking-wider",
        VARIANTS[variant],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {icon && <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  );
}
