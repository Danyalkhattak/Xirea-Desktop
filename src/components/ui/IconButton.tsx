/**
 * IconButton — square button for icon-only actions (toolbar, list rows, etc.)
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "ghost" | "subtle" | "outline" | "primary" | "danger";
type Size = "xs" | "sm" | "md" | "lg";

type NativeButtonAttrs = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

export interface IconButtonProps extends NativeButtonAttrs {
  variant?: Variant;
  size?: Size;
  label: string; // used as aria-label + tooltip title
  children: ReactNode;
  active?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  ghost: "text-ink-tertiary hover:text-ink-primary hover:bg-overlay/6",
  subtle: "text-ink-secondary bg-overlay/6 hover:bg-overlay/10 border border-line-subtle",
  outline: "text-ink-primary bg-surface-raised/60 border border-line-medium hover:bg-surface-hover hover:border-brand-indigo-400/60",
  primary: "text-white bg-gradient-to-br from-brand-indigo-500 to-brand-indigo-600 shadow-[0_2px_8px_rgba(99,102,241,0.24)]",
  danger: "text-status-danger/80 hover:text-status-danger hover:bg-status-danger/10",
};

const SIZES: Record<Size, string> = {
  xs: "h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5 rounded-md",
  sm: "h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5 rounded-lg",
  md: "h-9 w-9 [&>svg]:h-4 [&>svg]:w-4 rounded-xl",
  lg: "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5 rounded-xl",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", label, children, active, className, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.06 }}
      whileTap={{ scale: disabled ? 1 : 0.92 }}
      transition={{ type: "spring", stiffness: 480, damping: 24 }}
      className={cn(
        "relative inline-grid cursor-pointer place-items-center transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo-400/70",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        active && "bg-overlay/8 text-ink-primary ring-1 ring-brand-indigo-400/40",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
