/**
 * UI store — controls the chrome of the app, not its content.
 * Sidebar state, command palette, modals, active route, etc.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ReactNode } from "react";
import type { RouteId } from "@/types";

export interface ModalState {
  id: string;
  title?: string;
  payload?: unknown;
}

interface UIState {
  /* Navigation */
  route: RouteId;
  activeThreadId: string | null;
  setRoute: (route: RouteId) => void;
  setActiveThread: (id: string | null) => void;

  /* Sidebar */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /* Sidebar bottom section (nav + profile) — collapsed by default, user opens it. */
  sidebarBottomOpen: boolean;
  setSidebarBottomOpen: (open: boolean) => void;
  toggleSidebarBottom: () => void;

  /* Activity panel (right side) */
  activityPanelOpen: boolean;
  toggleActivityPanel: () => void;
  setActivityPanel: (open: boolean) => void;

  /* Notifications panel (top bar bell dropdown) */
  notificationsPanelOpen: boolean;
  setNotificationsPanel: (open: boolean) => void;
  toggleNotificationsPanel: () => void;

  /* Command palette */
  commandPaletteOpen: boolean;
  setCommandPalette: (open: boolean) => void;
  toggleCommandPalette: () => void;

  /* Modals — generic registry */
  modals: ModalState[];
  openModal: (modal: ModalState) => void;
  closeModal: (id: string) => void;
  closeAllModals: () => void;

  /* Context menu */
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;

  /* Toasts */
  toasts: ToastEntry[];
  pushToast: (toast: Omit<ToastEntry, "id">) => string;
  dismissToast: (id: string) => void;

  /* Notifications — persistent list of in-app events (downloads, mentions, etc.) */
  notifications: NotificationEntry[];
  pushNotification: (n: Omit<NotificationEntry, "id" | "createdAt" | "read">) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Icon as a React node (e.g. `<Trash2 />`). Strings are NOT rendered as text. */
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

export interface ToastEntry {
  id: string;
  title: string;
  description?: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
  duration?: number;
}

export interface NotificationEntry {
  id: string;
  title: string;
  description?: string;
  variant: "default" | "success" | "warning" | "danger" | "info";
  /** Optional route to navigate to when clicked. */
  route?: RouteId;
  /** Optional thread id to open when clicked. */
  threadId?: string;
  createdAt: string;
  read: boolean;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      route: "chat",
      activeThreadId: null,
      setRoute: (route) => set({ route }),
      setActiveThread: (id) => set({ activeThreadId: id }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Sidebar bottom section (nav + profile) — collapsed by default.
      sidebarBottomOpen: false,
      setSidebarBottomOpen: (open) => set({ sidebarBottomOpen: open }),
      toggleSidebarBottom: () => set((s) => ({ sidebarBottomOpen: !s.sidebarBottomOpen })),

      activityPanelOpen: false,
      toggleActivityPanel: () => set((s) => ({ activityPanelOpen: !s.activityPanelOpen })),
      setActivityPanel: (open) => set({ activityPanelOpen: open }),

      notificationsPanelOpen: false,
      setNotificationsPanel: (open) => set({ notificationsPanelOpen: open }),
      toggleNotificationsPanel: () => set((s) => ({ notificationsPanelOpen: !s.notificationsPanelOpen })),

      commandPaletteOpen: false,
      setCommandPalette: (open) => set({ commandPaletteOpen: open }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

      modals: [],
      openModal: (modal) => set((s) => ({ modals: [...s.modals, modal] })),
      closeModal: (id) => set((s) => ({ modals: s.modals.filter((m) => m.id !== id) })),
      closeAllModals: () => set({ modals: [] }),

      contextMenu: null,
      openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
      closeContextMenu: () => set({ contextMenu: null }),

      toasts: [],
      pushToast: (toast) => {
        const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const entry: ToastEntry = { id, duration: 4000, ...toast };
        set((s) => ({ toasts: [...s.toasts, entry] }));
        if (entry.duration && entry.duration > 0) {
          setTimeout(() => {
            get().dismissToast(id);
          }, entry.duration);
        }
        // ALSO push a notification so the Bell dropdown has an entry.
        get().pushNotification({
          title: toast.title,
          description: toast.description,
          variant: toast.variant,
        });
        return id;
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      notifications: [],
      pushNotification: (n) => set((s) => ({
        notifications: [
          {
            ...n,
            id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            createdAt: new Date().toISOString(),
            read: false,
          },
          ...s.notifications,
        ].slice(0, 50), // keep at most 50
      })),
      markNotificationRead: (id) => set((s) => ({
        notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
      })),
      markAllNotificationsRead: () => set((s) => ({
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
      })),
      clearNotifications: () => set({ notifications: [] }),
    }),
    {
      name: "xirea:ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        activityPanelOpen: s.activityPanelOpen,
        sidebarBottomOpen: s.sidebarBottomOpen,
        notifications: s.notifications,
      }),
    },
  ),
);
