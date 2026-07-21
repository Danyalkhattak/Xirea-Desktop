/**
 * Textarea — auto-grow textarea with refined styling.
 */
import { forwardRef, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow = true, minHeight = 56, maxHeight = 320, value, onChange, ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // Allow caller-provided ref to work too
  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  const resize = () => {
    const el = innerRef.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
  };

  useLayoutEffect(resize, []);
  useEffect(resize, [value, minHeight, maxHeight, autoGrow]);

  return (
    <textarea
      ref={setRef}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      style={{ minHeight, maxHeight }}
      className={cn(
        "w-full resize-none rounded-xl bg-surface-raised border border-line-soft",
        "px-3.5 py-2.5 text-sm text-ink-primary placeholder:text-ink-muted",
        "transition-colors duration-150",
        "focus:outline-none focus:border-brand-indigo-400/60 focus:bg-surface-hover focus:shadow-[0_0_0_3px_rgba(129,140,248,0.12)]",
        className,
      )}
      {...rest}
    />
  );
});
