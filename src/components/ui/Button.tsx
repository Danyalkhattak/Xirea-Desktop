/**
 * Button — Xirea's primary action primitive.
 *
 * Variants:
 *  - primary: brand gradient, for the single most important action on screen
 *  - secondary: surface-raised, for the next-most important
 *  - ghost: transparent, for tertiary actions
 *  - outline: hairline border, for inline actions
 *  - danger: status.danger, for destructive actions
 *
 * Sizes: sm / md / lg / icon
 *
 * Includes a tasteful ripple-feedback and a hover/tap micro animation.
 */
import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, useAnimation } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

// Framer Motion's `motion.button` redefines onDrag / onAnimationStart etc.
// Strip them from our rest props so callers can pass plain HTML button handlers
// without colliding with Motion's typed handlers.
type NativeButtonAttrs = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

export interface ButtonProps extends NativeButtonAttrs {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "text-white bg-gradient-to-br from-brand-indigo-500 to-brand-indigo-600 hover:brightness-110 shadow-[0_2px_8px_rgba(99,102,241,0.28)] hover:shadow-[0_4px_12px_rgba(99,102,241,0.36)]",
  secondary:
    "text-ink-primary bg-surface-raised hover:bg-surface-hover border border-line-soft hover:border-line-medium",
  ghost:
    "text-ink-secondary hover:text-ink-primary hover:bg-overlay/4",
  outline:
    "text-ink-primary bg-surface-raised/60 border border-line-medium hover:bg-surface-hover hover:border-brand-indigo-400/60",
  danger:
    "text-white bg-status-danger/90 hover:bg-status-danger shadow-[0_2px_8px_rgba(239,68,68,0.24)]",
  subtle:
    "text-ink-secondary bg-overlay/6 hover:bg-overlay/10 border border-line-subtle",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-2 rounded-xl",
  lg: "h-11 px-6 text-sm gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-xl",
};

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, iconLeft, iconRight, fullWidth, className, children, disabled, onClick, ...rest },
  ref,
) {
  const ripplesRef = useRef<Ripple[]>([]);
  const rippleId = useRef(0);
  const controls = useAnimation();

  const handleClick: ButtonHTMLAttributes<HTMLButtonElement>["onClick"] = (e) => {
    if (disabled || loading) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 1.4;
    const id = rippleId.current++;
    ripplesRef.current = [...ripplesRef.current, { id, x, y, size }];
    void controls.start({ scale: [0.97, 1], transition: { duration: 0.18, ease: [0.34, 1.56, 0.64, 1] } });
    onClick?.(e);
  };

  return (
    <motion.button
      ref={ref}
      animate={controls}
      whileHover={{ y: disabled ? 0 : -0.5 }}
      whileTap={{ y: disabled ? 0 : 0.5, scale: disabled ? 1 : 0.985 }}
      transition={{ type: "spring", stiffness: 460, damping: 32 }}
      onClick={handleClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center font-medium select-none",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo-400/70 focus-visible:ring-offset-0",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        "overflow-hidden",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 grid place-items-center bg-inherit">
          <span className="block h-3.5 w-3.5 rounded-full border-2 border-overlay/4000 border-t-white animate-spin-slow" />
        </span>
      )}
      {iconLeft && <span className="-ml-0.5 inline-flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">{iconLeft}</span>}
      {children && <span className={cn(loading && "opacity-0")}>{children}</span>}
      {iconRight && <span className="-mr-0.5 inline-flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">{iconRight}</span>}
      {ripplesRef.current.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute rounded-full bg-overlay/3000"
          style={{
            left: r.x - r.size / 2,
            top: r.y - r.size / 2,
            width: r.size,
            height: r.size,
            animation: "xirea-ripple 0.6s ease-out forwards",
          }}
          onAnimationEnd={() => {
            ripplesRef.current = ripplesRef.current.filter((x) => x.id !== r.id);
          }}
        />
      ))}
      <style>{`@keyframes xirea-ripple { 0% { transform: scale(0); opacity: 0.6; } 100% { transform: scale(1); opacity: 0; } }`}</style>
    </motion.button>
  );
});
