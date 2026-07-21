/**
 * Select — custom dropdown built on Radix-free primitives.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  size = "md",
  align = "left",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface-raised text-ink-primary transition-colors",
          "hover:border-line-medium focus:outline-none focus:border-brand-indigo-400/60 focus:shadow-[0_0_0_3px_rgba(129,140,248,0.12)]",
          size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-3.5 text-sm",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon}
          <span className={cn("truncate", !selected && "text-ink-muted")}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-ink-tertiary transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute z-50 mt-2 min-w-full overflow-hidden rounded-xl surface-raised p-1",
              align === "right" ? "right-0" : "left-0",
            )}
            style={{ width: "max-content", maxWidth: "320px" }}
          >
            <div className="max-h-72 overflow-y-auto py-0.5">
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                      "transition-colors",
                      isSelected ? "bg-brand-indigo-500/[0.14] text-ink-primary" : "text-ink-secondary hover:bg-overlay/4 hover:text-ink-primary",
                      option.disabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {option.icon && <span className="[&>svg]:h-4 [&>svg]:w-4">{option.icon}</span>}
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      {option.hint && <span className="text-xs text-ink-muted">{option.hint}</span>}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-brand-indigo-300" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
