/**
 * Toast layer — subscribes to the UI store.
 */
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { cn } from "@/lib/utils";

const ICONS = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const STYLES = {
  default: "border-line-medium",
  info: "border-brand-indigo-400/40",
  success: "border-status-success/40",
  warning: "border-status-warning/40",
  danger: "border-status-danger/40",
};

const ICON_STYLES = {
  default: "text-ink-tertiary",
  info: "text-brand-indigo-300",
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
};

export function ToastLayer() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-6 right-6 z-[400] flex w-[360px] flex-col gap-2.5">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.variant] ?? Info;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl surface-raised border p-3.5 shadow-elev-3",
                STYLES[toast.variant],
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_STYLES[toast.variant])} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-primary">{toast.title}</p>
                {toast.description && <p className="text-xs text-ink-tertiary mt-0.5">{toast.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-ink-tertiary hover:text-ink-primary transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
