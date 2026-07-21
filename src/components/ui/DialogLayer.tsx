/**
 * DialogLayer — renders the brand-styled confirm / prompt modal.
 *
 * Replaces window.confirm / window.prompt which don't work inside Tauri
 * webviews. Subscribes to useDialogStore and shows a single modal at a time.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, AlertCircle, HelpCircle, X } from "lucide-react";
import { useDialogStore } from "@/store/dialog";
import { Button } from "@/components/ui/Button";

export function DialogLayer() {
  const dialog = useDialogStore((s) => s.dialog);
  const close = useDialogStore((s) => s.close);

  // Local input state — synced with the dialog when it opens.
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (dialog?.input) {
      setValue(dialog.input.defaultValue ?? "");
      // Focus the input after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [dialog?.id, dialog?.input]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter" && dialog.input) {
        e.preventDefault();
        const allowEmpty = dialog.input.allowEmpty ?? false;
        if (!allowEmpty && !value.trim()) return;
        dialog.onConfirm(value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, value, close]);

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          className="fixed inset-0 z-[300] grid place-items-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-surface-midnight/72 backdrop-blur-md"
            onClick={() => close(null)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md surface-raised rounded-2xl border border-line-soft p-5 shadow-elev-4"
          >
            {/* Close (X) — top right */}
            <button
              type="button"
              aria-label="Close dialog"
              onClick={() => close(null)}
              className="absolute right-3 top-3 grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink-faint hover:bg-overlay/6 hover:text-ink-secondary transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="flex items-start gap-3">
              {dialog.icon ? (
                <div
                  className={
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl border " +
                    (dialog.variant === "danger"
                      ? "bg-status-danger/10 border-status-danger/20 text-status-danger"
                      : dialog.variant === "primary"
                        ? "bg-brand-indigo-500/15 border-brand-indigo-400/20 text-brand-indigo-300"
                        : "bg-overlay/8 border-line-soft text-ink-tertiary")
                  }
                >
                  {dialog.icon}
                </div>
              ) : dialog.variant === "danger" ? (
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-status-danger/10 border border-status-danger/20 text-status-danger">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              ) : dialog.variant === "primary" ? (
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-indigo-500/15 border border-brand-indigo-400/20 text-brand-indigo-300">
                  <HelpCircle className="h-4 w-4" />
                </div>
              ) : (
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-overlay/8 border border-line-soft text-ink-tertiary">
                  <AlertCircle className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0 flex-1 pt-0.5">
                <h3 id="dialog-title" className="text-base font-semibold text-ink-primary font-display">
                  {dialog.title}
                </h3>
                {dialog.description && (
                  <p className="mt-1 text-sm text-ink-tertiary leading-relaxed whitespace-pre-wrap">
                    {dialog.description}
                  </p>
                )}
              </div>
            </div>

            {dialog.input && (
              <div className="mt-4">
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={dialog.input.placeholder}
                  className="w-full rounded-lg bg-surface-deep border border-line-soft px-3 py-2 text-sm text-ink-primary placeholder:text-ink-faint focus:outline-none focus:border-brand-indigo-400/60"
                />
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => close(null)}
                className="cursor-pointer"
              >
                {dialog.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={dialog.variant === "danger" ? "danger" : "primary"}
                size="md"
                onClick={() => {
                  if (dialog.input) {
                    const allowEmpty = dialog.input.allowEmpty ?? false;
                    if (!allowEmpty && !value.trim()) return;
                    dialog.onConfirm(value);
                  } else {
                    dialog.onConfirm("");
                  }
                }}
                className="cursor-pointer"
              >
                {dialog.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
