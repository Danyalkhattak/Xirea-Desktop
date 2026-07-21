/**
 * TopBar — the always-visible chrome at the top of the Xirea window.
 *
 * Layout: [window-drag-region] [brand+collapse] [search/command palette] [spacer] [notifications] [activity panel] [window controls]
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PanelLeft,
  PanelRight,
  Search,
  Command,
  Bell,
  CheckCheck,
  Trash2,
  Inbox,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUIStore } from "@/store/ui";
import { WindowControls } from "./WindowControls";
import { getAppMeta } from "@/lib/tauri";

export function TopBar() {
  const [platform, setPlatform] = useState("");
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleActivityPanel = useUIStore((s) => s.toggleActivityPanel);
  const activityPanelOpen = useUIStore((s) => s.activityPanelOpen);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCommandPalette = useUIStore((s) => s.setCommandPalette);
  const notificationsPanelOpen = useUIStore((s) => s.notificationsPanelOpen);
  const setNotificationsPanel = useUIStore((s) => s.setNotificationsPanel);
  const unreadCount = useUIStore((s) => s.notifications.filter((n) => !n.read).length);

  useEffect(() => {
    void getAppMeta().then((m) => setPlatform(m.platform));
  }, []);

  return (
    <header
      data-tauri-drag-region="true"
      className={cn(
        "drag-region relative z-30 flex h-12 items-center gap-2 px-2.5",
        "glass border-b border-line-subtle",
      )}
    >
      {/* Left: sidebar toggle + brand */}
      <div className="relative z-10 flex items-center gap-1.5">
        <IconButton
          label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          size="sm"
          variant="ghost"
          onClick={toggleSidebar}
          active={!sidebarCollapsed}
          className="cursor-pointer"
          data-tauri-drag-region="false"
        >
          <PanelLeft />
        </IconButton>
        <div className="flex items-center gap-2 pl-1">
          <BrandMark />
          <span className="hidden md:inline text-sm font-semibold tracking-tight text-ink-primary font-display">
            Xirea
          </span>
          <span className="hidden lg:inline-flex h-4 px-1.5 items-center rounded text-2xs font-medium text-brand-teal-300 bg-brand-teal-500/10 border border-brand-teal-400/20">
            v1.0
          </span>
        </div>
      </div>

      {/* Center: command palette trigger */}
      <div className="relative z-10 mx-auto flex w-full max-w-xl">
        <motion.button
          type="button"
          whileHover={{ y: -0.5 }}
          whileTap={{ y: 0.5 }}
          onClick={() => setCommandPalette(true)}
          data-tauri-drag-region="false"
          className={cn(
            "group flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-line-soft bg-surface-raised/60 px-3",
            "text-ink-muted hover:border-line-medium hover:text-ink-tertiary transition-colors",
          )}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-xs">Search chats, models, prompts…</span>
          <kbd className="kbd">
            <Command className="hidden md:inline h-2.5 w-2.5" />K
          </kbd>
        </motion.button>
      </div>

      {/* Right: actions */}
      <div className="relative z-10 ml-auto flex items-center gap-1">
        <NotificationsBell
          open={notificationsPanelOpen}
          onToggle={() => setNotificationsPanel(!notificationsPanelOpen)}
          unreadCount={unreadCount}
        />
        <Tooltip content={activityPanelOpen ? "Hide activity panel" : "Show activity panel"}>
          <IconButton
            label="Toggle activity panel"
            size="sm"
            variant="ghost"
            onClick={toggleActivityPanel}
            active={activityPanelOpen}
            className="cursor-pointer"
            data-tauri-drag-region="false"
          >
            <PanelRight />
          </IconButton>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-line-subtle" />
        <WindowControls platform={platform} />
      </div>
    </header>
  );
}

/** Notifications bell — opens a dropdown panel listing recent notifications. */
function NotificationsBell({ open, onToggle, unreadCount }: { open: boolean; onToggle: () => void; unreadCount: number }) {
  const notifications = useUIStore((s) => s.notifications);
  const markAllRead = useUIStore((s) => s.markAllNotificationsRead);
  const markRead = useUIStore((s) => s.markNotificationRead);
  const clear = useUIStore((s) => s.clearNotifications);
  const setRoute = useUIStore((s) => s.setRoute);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const setNotificationsPanel = useUIStore((s) => s.setNotificationsPanel);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setNotificationsPanel(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, setNotificationsPanel]);

  return (
    <div className="relative" ref={ref}>
      <Tooltip content="Notifications">
        <button
          type="button"
          aria-label="Notifications"
          onClick={onToggle}
          data-tauri-drag-region="false"
          className={cn(
            "relative grid h-8 w-8 cursor-pointer place-items-center rounded-lg transition-colors",
            open ? "bg-overlay/8 text-ink-primary" : "text-ink-tertiary hover:bg-overlay/4 hover:text-ink-secondary",
          )}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-status-danger px-0.5 text-[9px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-2 w-[360px] surface-raised rounded-xl border border-line-soft shadow-elev-3 z-[100] overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-ink-tertiary" />
                <span className="text-xs font-semibold text-ink-primary">Notifications</span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-status-danger/15 px-1.5 py-0.5 text-2xs font-semibold text-status-danger">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded text-ink-tertiary hover:bg-overlay/6 hover:text-ink-primary disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Mark all as read"
                >
                  <CheckCheck className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={clear}
                  disabled={notifications.length === 0}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded text-ink-tertiary hover:bg-status-danger/10 hover:text-status-danger disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Clear all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <Inbox className="mx-auto mb-2 h-6 w-6 text-ink-faint" />
                  <p className="text-xs text-ink-tertiary">You're all caught up</p>
                  <p className="text-2xs text-ink-faint mt-1">New activity will appear here</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      markRead(n.id);
                      if (n.route) setRoute(n.route);
                      if (n.threadId) setActiveThread(n.threadId);
                      setNotificationsPanel(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-2.5 border-b border-line-subtle px-3 py-2.5 text-left transition-colors hover:bg-overlay/4",
                      !n.read && "bg-brand-indigo-500/[0.04]",
                    )}
                  >
                    <span className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      n.read ? "bg-ink-faint" : "bg-brand-indigo-400",
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink-primary truncate">{n.title}</p>
                      {n.description && (
                        <p className="text-2xs text-ink-tertiary line-clamp-2 mt-0.5">{n.description}</p>
                      )}
                      <p className="text-2xs text-ink-faint mt-1">{formatRelativeTime(n.createdAt)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Compact brand mark — used in the top bar. Uses the real Xirea icon PNG. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/icon.png"
      alt="Xirea"
      width={size}
      height={size}
      className="rounded-[28%] border border-line-soft shadow-sm"
      draggable={false}
    />
  );
}