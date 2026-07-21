/**
 * EmptyState — designed-empty placeholder.
 */
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  illustration?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = "md",
  className,
  illustration,
}: EmptyStateProps) {
  const pad = size === "sm" ? "py-10 px-6" : size === "lg" ? "py-20 px-8" : "py-14 px-8";

  return (
    <div className={cn("flex flex-col items-center justify-center text-center", pad, className)}>
      {illustration ?? (
        <div className="relative mb-5">
          <div className="absolute inset-0 -m-6 rounded-full bg-brand-gradient-soft blur-2xl opacity-60" />
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl bg-surface-raised border border-line-soft text-brand-indigo-300 [&>svg]:h-7 [&>svg]:w-7">
            {icon ?? <span className="block h-2 w-2 rounded-full bg-brand-indigo-400" />}
          </div>
        </div>
      )}
      <h3 className="text-base font-semibold text-ink-primary text-balance">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-ink-tertiary text-pretty">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-6 flex items-center gap-2.5">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
