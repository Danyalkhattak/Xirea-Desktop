/**
 * Resizable horizontal split — for sidebar | workspace | activity panel.
 * Uses pointer events for buttery dragging.
 *
 * The first pane's width is controlled by `size` (or `collapsedSize` when
 * `collapsed` is true). Dragging the handle updates `size` and persists it
 * to localStorage (under `xirea:resize:<storageKey>`).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ResizableProps {
  children: [ReactNode, ReactNode];
  /** Default width of the first pane (in px) when not collapsed and no stored value. */
  defaultSize?: number;
  /** Min width when dragging. */
  min?: number;
  /** Max width when dragging. */
  max?: number;
  /** Direction of the split. */
  direction?: "horizontal" | "vertical";
  /** localStorage key for persisting the dragged size. */
  storageKey?: string;
  /** When true, the first pane snaps to `collapsedSize` and the drag handle is hidden. */
  collapsed?: boolean;
  /** Width to use when `collapsed` is true. */
  collapsedSize?: number;
  className?: string;
}

export function Resizable({
  children,
  defaultSize = 280,
  min = 220,
  max = 480,
  direction = "horizontal",
  storageKey,
  collapsed = false,
  collapsedSize = 56,
  className,
}: ResizableProps) {
  // `size` holds the user-dragged width of the first pane. When `collapsed`
  // is true we render `collapsedSize` instead, but we keep `size` around so
  // that toggling collapse off restores the previous width instantly.
  const [size, setSize] = useState<number>(() => {
    if (storageKey && typeof localStorage !== "undefined") {
      const v = localStorage.getItem(`xirea:resize:${storageKey}`);
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
      }
    }
    return defaultSize;
  });
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = direction === "horizontal" ? e.clientX - rect.left : e.clientY - rect.top;
      const clamped = Math.max(min, Math.min(max, next));
      setSize(clamped);
      if (storageKey && typeof localStorage !== "undefined") {
        localStorage.setItem(`xirea:resize:${storageKey}`, String(clamped));
      }
    },
    [direction, max, min, storageKey],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const horizontal = direction === "horizontal";
  // Effective rendered width — collapsedSize wins when collapsed.
  const effectiveSize = collapsed ? collapsedSize : size;

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col", className)}
    >
      <div
        style={horizontal ? { width: effectiveSize } : { height: effectiveSize }}
        className={cn("min-h-0 min-w-0 shrink-0 overflow-hidden")}
      >
        {children[0]}
      </div>
      {/* Drag handle — hidden when collapsed so the user can't drag a collapsed pane. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation={horizontal ? "vertical" : "horizontal"}
          onPointerDown={(e) => {
            dragging.current = true;
            document.body.style.userSelect = "none";
            document.body.style.cursor = horizontal ? "ew-resize" : "ns-resize";
            e.preventDefault();
          }}
          data-active={dragging.current}
          className={cn(
            "resize-handle group relative shrink-0",
            horizontal ? "w-px cursor-ew-resize" : "h-px cursor-ns-resize",
            "bg-line-subtle hover:bg-brand-indigo-400/40",
          )}
        >
          <span
            className={cn(
              "absolute bg-transparent transition-colors",
              horizontal
                ? "inset-y-0 -left-1.5 -right-1.5"
                : "inset-x-0 -top-1.5 -bottom-1.5",
            )}
          />
        </div>
      )}
      <div className={cn("min-h-0 min-w-0 flex-1")}>{children[1]}</div>
    </div>
  );
}
