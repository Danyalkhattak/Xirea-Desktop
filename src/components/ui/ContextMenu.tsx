/**
 * Context menu — custom right-click menu, portal-rendered.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useUIStore, type ContextMenuItem } from "@/store/ui";
import { cn } from "@/lib/utils";

export function ContextMenuLayer() {
  const menu = useUIStore((s) => s.contextMenu);
  const close = useUIStore((s) => s.closeContextMenu);

  useEffect(() => {
    if (!menu) return;
    const onClick = () => close();
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menu, close]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {menu && (
        <motion.div
          role="menu"
          initial={{ opacity: 0, scale: 0.94, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 320) }}
          className="fixed z-[300] min-w-[220px] surface-raised rounded-xl p-1 shadow-elev-4"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.items.map((item) =>
            item.separator ? (
              <div key={item.id} className="my-1 h-px bg-line-subtle" />
            ) : (
              <button
                key={item.id}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.();
                  close();
                }}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  item.destructive
                    ? "text-status-danger hover:bg-status-danger/10"
                    : "text-ink-secondary hover:bg-overlay/6 hover:text-ink-primary",
                )}
              >
                {item.icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 text-ink-tertiary group-hover:text-current">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <kbd className="kbd">{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export type { ContextMenuItem };
