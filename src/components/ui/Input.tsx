/**
 * Input — text field with a refined focus state.
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  invalid?: boolean;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { iconLeft, iconRight, invalid, className, containerClassName, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        "group relative flex h-10 items-center rounded-xl",
        "bg-surface-raised border border-line-soft",
        "transition-colors duration-150",
        "focus-within:border-brand-indigo-400/60 focus-within:bg-surface-hover focus-within:shadow-[0_0_0_3px_rgba(129,140,248,0.12)]",
        invalid && "border-status-danger/60 focus-within:border-status-danger focus-within:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]",
        containerClassName,
      )}
    >
      {iconLeft && (
        <span className="pl-3 pr-2 text-ink-tertiary group-focus-within:text-brand-indigo-300 [&>svg]:h-4 [&>svg]:w-4">
          {iconLeft}
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          "h-full w-full bg-transparent px-3 text-sm text-ink-primary placeholder:text-ink-muted",
          "focus:outline-none",
          iconLeft && "pl-0",
          iconRight && "pr-0",
          className,
        )}
        {...rest}
      />
      {iconRight && (
        <span className="pr-3 pl-2 text-ink-tertiary [&>svg]:h-4 [&>svg]:w-4">
          {iconRight}
        </span>
      )}
    </div>
  );
});
