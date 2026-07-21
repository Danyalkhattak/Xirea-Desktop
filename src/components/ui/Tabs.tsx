/**
 * Tabs — segmented control + underline variants.
 */
import { type ReactNode, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "underline" | "segmented" | "pill";
  size?: "sm" | "md";
  className?: string;
}

export function Tabs({ items, value, onChange, variant = "underline", size = "md", className }: TabsProps) {
  if (variant === "segmented") {
    return (
      <div className={cn("inline-flex items-center gap-0.5 rounded-xl bg-surface-raised border border-line-soft p-1", className)}>
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                "relative inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors",
                size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
                active ? "text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary",
              )}
            >
              {active && (
                <motion.span
                  layoutId="tab-segmented"
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className="absolute inset-0 rounded-lg bg-overlay/8 border border-line-soft"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {item.icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{item.icon}</span>}
                {item.label}
                {item.badge}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === "pill") {
    return (
      <div className={cn("inline-flex items-center gap-1", className)}>
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                "relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "text-white" : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4",
              )}
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-brand-indigo-500 to-brand-indigo-600"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {item.icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{item.icon}</span>}
                {item.label}
                {item.badge}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // underline
  return (
    <div className={cn("flex items-center gap-1 border-b border-line-subtle", className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary",
            )}
          >
            <span className="flex items-center gap-1.5">
              {item.icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{item.icon}</span>}
              {item.label}
              {item.badge}
            </span>
            {active && (
              <motion.span
                layoutId="tab-underline"
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-brand-indigo-400 to-brand-indigo-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* Controlled tabs hook */
export function useTabs(initial: string) {
  return useState<string>(initial);
}
