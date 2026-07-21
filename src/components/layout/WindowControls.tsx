/**
 * WindowControls — native window min / max / close buttons.
 *
 * On macOS we let the platform render its own traffic lights via
 * `titleBarStyle: "Overlay"` and `trafficLightPosition` in tauri.conf.json.
 * On Windows / Linux we render our own.
 *
 * Uses Tauri 2's `data-tauri-drag-region` attribute on the drag region
 * (see WindowDragRegion below) — this delegates drag handling to the OS,
 * and elements marked `data-tauri-drag-region="false"` (or any element
 * that consumes its own mousedown) automatically opt out of dragging.
 */
import { Minus, Square, X, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { windowClose, windowMinimize, windowToggleMaximize, onWindowMaximizeChange, isTauri } from "@/lib/tauri";

export function WindowControls({ platform }: { platform: string }) {
  const [maximized, setMaximized] = useState(false);

  // Sync the maximized state on mount AND whenever the window is resized
  // (which is what happens when the user maximizes / un-maximizes via the OS,
  // keyboard shortcut, or our own button).
  useEffect(() => {
    if (!isTauri()) return;
    let unsub: (() => void) | undefined;
    void onWindowMaximizeChange(setMaximized).then((u) => (unsub = u));
    // Also query the initial state once.
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow().isMaximized().then(setMaximized);
    });
    return () => unsub?.();
  }, []);

  if (platform.startsWith("Mac")) return null;

  // IMPORTANT: do NOT call `e.preventDefault()` on mousedown — on some
  // webviews (notably Windows WebView2) this can swallow the subsequent
  // `click` event, which was the root cause of the maximize button doing
  // nothing. We only need `stopPropagation` to prevent the drag region from
  // picking up the mousedown and treating it as a window drag.
  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleMaximize = (e: React.MouseEvent) => {
    e.stopPropagation();
    void windowToggleMaximize().then((nowMax) => {
      if (typeof nowMax === "boolean") setMaximized(nowMax);
    });
  };

  return (
    <div
      className="relative z-20 flex items-center"
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        aria-label="Minimize"
        data-tauri-drag-region="false"
        onMouseDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          void windowMinimize();
        }}
        className="grid h-9 w-12 cursor-pointer place-items-center text-ink-tertiary hover:bg-overlay/8 hover:text-ink-primary transition-colors"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        data-tauri-drag-region="false"
        onMouseDown={stop}
        onClick={handleMaximize}
        className="grid h-9 w-12 cursor-pointer place-items-center text-ink-tertiary hover:bg-overlay/8 hover:text-ink-primary transition-colors"
      >
        {maximized ? (
          <Copy className="h-3 w-3 -scale-x-100" />
        ) : (
          <Square className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        data-tauri-drag-region="false"
        onMouseDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          void windowClose();
        }}
        className="grid h-9 w-12 cursor-pointer place-items-center text-ink-tertiary hover:bg-status-danger hover:text-white transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Drag region — invisible strip across the top bar for native window dragging.
 *
 * Uses the Tauri 2 `data-tauri-drag-region` attribute, which is the
 * officially-supported way to enable window dragging. We DON'T call
 * `startDragging()` ourselves — Tauri's webview handles the drag natively
 * when this attribute is present, and calling `startDragging()` on top of
 * that causes the click event to be swallowed by the drag, which is why
 * the maximize button wasn't working.
 */
export function WindowDragRegion({ className }: { className?: string }) {
  return (
    <div
      data-tauri-drag-region="true"
      className={cn("drag-region absolute inset-0 z-0", className)}
    />
  );
}
