/**
 * Switch — toggle control.
 */
import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  trailing?: ReactNode;
  id?: string;
}

export function Switch({ checked, onChange, label, description, disabled, trailing, id }: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-center gap-3 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-checked={checked}
        className="xirea-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo-400/60"
      />
      {(label || description || trailing) && (
        <span className="flex flex-1 flex-col">
          {label && <span className="text-sm font-medium text-ink-primary">{label}</span>}
          {description && <span className="text-xs text-ink-tertiary">{description}</span>}
        </span>
      )}
      {trailing}
    </label>
  );
}

/* Animated pill variant for inline use */
export function SwitchPill({ checked, onChange, labels = ["Off", "On"] }: { checked: boolean; onChange: (v: boolean) => void; labels?: [string, string] }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-[108px] items-center rounded-full p-1 text-xs font-medium transition-colors",
        checked ? "bg-gradient-to-r from-brand-indigo-500 to-brand-indigo-600 text-white" : "bg-surface-hover text-ink-tertiary",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className="absolute h-5 w-12 rounded-full bg-white shadow-sm"
        style={{ left: checked ? "calc(100% - 48px - 4px)" : 4 }}
      />
      <span className="relative z-10 flex-1 text-center">{labels[0]}</span>
      <span className="relative z-10 flex-1 text-center">{labels[1]}</span>
    </button>
  );
}
