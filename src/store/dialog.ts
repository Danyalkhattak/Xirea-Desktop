/**
 * Dialog store — Xirea-styled replacements for window.confirm / window.prompt.
 *
 * Why: Tauri's webview does NOT expose window.confirm / window.prompt (they
 * silently return undefined or throw "dialog.confirm not allowed. Command not
 * found"). The Tauri plugin-dialog `confirm()` exists but renders a native OS
 * dialog that looks foreign inside the app. We render our own brand-styled
 * modal instead.
 */
import { create } from "zustand";
import type { ReactNode } from "react";

export interface DialogConfig {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  /** "danger" turns the confirm button red. */
  variant?: "default" | "danger" | "primary";
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, render a text input (prompt-style). */
  input?: {
    defaultValue?: string;
    placeholder?: string;
    /** When true, allow submitting with no text. */
    allowEmpty?: boolean;
  };
  onConfirm: (value: string) => void;
  onCancel?: () => void;
}

interface DialogState {
  dialog: DialogConfig | null;
  confirm: (config: Omit<DialogConfig, "id">) => Promise<string | null>;
  prompt: (config: Omit<DialogConfig, "id" | "onConfirm"> & { onConfirm: (value: string) => void }) => Promise<string | null>;
  close: (result: string | null) => void;
}

// Internal resolver — set when `confirm`/`prompt` is called, cleared on close.
let resolver: ((value: string | null) => void) | null = null;

export const useDialogStore = create<DialogState>((set, get) => ({
  dialog: null,

  confirm: (config) =>
    new Promise((resolve) => {
      // Replace any open dialog.
      if (resolver) resolver(null);
      resolver = resolve;
      set({
        dialog: {
          ...config,
          id: `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          onConfirm: (value: string) => {
            config.onConfirm(value);
            get().close(value);
          },
        },
      });
    }),

  prompt: (config) =>
    new Promise((resolve) => {
      if (resolver) resolver(null);
      resolver = resolve;
      set({
        dialog: {
          ...config,
          id: `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          onConfirm: (value: string) => {
            config.onConfirm(value);
            get().close(value);
          },
        },
      });
    }),

  close: (result) => {
    if (resolver) {
      resolver(result);
      resolver = null;
    }
    set({ dialog: null });
  },
}));

/**
 * Imperative helpers — call from anywhere in the app.
 * Returns the input value (for `promptX`) or "true"/null for `confirmX`.
 */
export const dialog = {
  confirm: (config: Omit<DialogConfig, "id" | "onConfirm" | "input"> & {
    onConfirm?: () => void;
  }) =>
    useDialogStore.getState().confirm({
      ...config,
      onConfirm: () => config.onConfirm?.(),
    }),
  prompt: (config: Omit<DialogConfig, "id" | "onConfirm"> & {
    onConfirm: (value: string) => void;
  }) =>
    useDialogStore.getState().prompt({
      ...config,
      onConfirm: (value: string) => config.onConfirm(value),
    }),
};

/** Convenience wrappers — promise-returning. */
export const confirmDialog = (
  title: string,
  description?: string,
  opts?: { variant?: "danger" | "primary" | "default"; confirmLabel?: string; cancelLabel?: string; icon?: ReactNode },
): Promise<boolean> =>
  new Promise((resolve) => {
    const { confirm } = useDialogStore.getState();
    void confirm({
      title,
      description,
      variant: opts?.variant ?? "default",
      confirmLabel: opts?.confirmLabel ?? "Confirm",
      cancelLabel: opts?.cancelLabel ?? "Cancel",
      icon: opts?.icon,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

export const promptDialog = (
  title: string,
  opts?: {
    description?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    allowEmpty?: boolean;
    variant?: "default" | "danger" | "primary";
    icon?: ReactNode;
  },
): Promise<string | null> =>
  new Promise((resolve) => {
    const { prompt } = useDialogStore.getState();
    void prompt({
      title,
      description: opts?.description,
      variant: opts?.variant ?? "primary",
      confirmLabel: opts?.confirmLabel ?? "Save",
      cancelLabel: opts?.cancelLabel ?? "Cancel",
      icon: opts?.icon,
      input: {
        defaultValue: opts?.defaultValue,
        placeholder: opts?.placeholder,
        allowEmpty: opts?.allowEmpty,
      },
      onConfirm: (value) => resolve(value),
      onCancel: () => resolve(null),
    });
  });
