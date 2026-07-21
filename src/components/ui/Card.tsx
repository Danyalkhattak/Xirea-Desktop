/**
 * Card — layered surface with optional header / footer / glow.
 */
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CardProps {
  children: ReactNode;
  className?: string;
  raised?: boolean;
  glow?: boolean;
  hover?: boolean;
  padded?: boolean;
}

export function Card({ children, className, raised, glow, hover, padded = true }: CardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl",
        raised ? "surface-raised" : "surface",
        padded && "p-5",
        hover && "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elev-3",
        glow && "brand-glow",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  icon,
  trailing,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 mb-4", className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-gradient-soft text-brand-indigo-300 [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-primary truncate">{title}</h3>
          {description && <p className="text-xs text-ink-tertiary mt-0.5">{description}</p>}
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
