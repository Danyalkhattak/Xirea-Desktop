/**
 * Tooltip — context-aware hover tooltip with delay + spring.
 */
import { type ReactNode, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  shortcut?: string;
  delay?: number;
  className?: string;
}

export function Tooltip({ content, children, side = "top", shortcut, delay = 320, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useState<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = () => {
    if (timer[0]) clearTimeout(timer[0]);
    const t = setTimeout(() => setVisible(true), delay);
    timer[1](t);
  };
  const onLeave = () => {
    if (timer[0]) clearTimeout(timer[0]);
    setVisible(false);
  };

  const sideClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  const anim = {
    top: { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 } },
    bottom: { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } },
    left: { initial: { opacity: 0, x: 4 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 4 } },
    right: { initial: { opacity: 0, x: -4 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -4 } },
  };

  return (
    <span
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      className={cn("relative inline-flex", className)}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.span
            initial={anim[side].initial}
            animate={anim[side].animate}
            exit={anim[side].exit}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "pointer-events-none absolute z-[100] whitespace-nowrap rounded-lg",
              "bg-surface-overlay/95 backdrop-blur-sm border border-line-medium",
              "px-2.5 py-1.5 text-xs font-medium text-ink-primary shadow-elev-3",
              "flex items-center gap-2",
              sideClasses[side],
            )}
            role="tooltip"
          >
            <span>{content}</span>
            {shortcut && <kbd className="kbd">{shortcut}</kbd>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
