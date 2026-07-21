/**
 * Sidebar — the heart of Xirea navigation.
 *
 * Sections:
 *   1. New chat button + global search
 *   2. Chat list (Pinned / Recent / Folders)
 *   3. Bottom nav: Models, Providers, HuggingFace, Files, Downloads, Prompts
 *   4. User profile + Settings
 *
 * Collapsible: when collapsed, turns into a 56px rail with icons only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Search,
  MessageSquare,
  Pin,
  Folder,
  Cpu,
  Cloud,
  HardDrive,
  Download,
  Files as FilesIcon,
  Sparkles,
  Settings,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Box,
  Trash2,
  Pencil,
  Archive,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { useUIStore } from "@/store/ui";
import { useChatStore } from "@/store/chat";
import { useModelsStore } from "@/store/models";
import { useDownloadsStore } from "@/store/downloads";
import { useProvidersStore } from "@/store/providers";
import { useSettingsStore } from "@/store/settings";
import { promptDialog } from "@/store/dialog";
import type { RouteId } from "@/types";

interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const route = useUIStore((s) => s.route);
  const setRoute = useUIStore((s) => s.setRoute);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const setCommandPalette = useUIStore((s) => s.setCommandPalette);
  const createThread = useChatStore((s) => s.createThread);
  // Bottom section (nav + profile) — collapsed by default; user opens it with the "+" button.
  const sidebarBottomOpen = useUIStore((s) => s.sidebarBottomOpen);
  const setSidebarBottomOpen = useUIStore((s) => s.setSidebarBottomOpen);

  // Selectors that derive primitives (numbers) are safe — Zustand compares with Object.is,
  // so even though `.reduce()` allocates nothing, the returned `.length` is a
  // stable primitive and will not trigger re-renders unless the count actually changes.
  const localModelCount = useModelsStore((s) => s.local.length);
  const activeDownloadCount = useDownloadsStore(
    (s) => s.tasks.reduce((n, t) => (t.state === "downloading" || t.state === "queued" ? n + 1 : n), 0),
  );
  const enabledProviderCount = useProvidersStore((s) => s.providers.reduce((n, p) => (p.enabled ? n + 1 : n), 0));

  const navItems: NavItem[] = useMemo(
    () => [
      { id: "models", label: "Models", icon: Cpu, badge: localModelCount || undefined },
      { id: "providers", label: "Providers", icon: Cloud, badge: enabledProviderCount || undefined },
      { id: "huggingface", label: "Hugging Face", icon: Box },
      { id: "files", label: "Files", icon: FilesIcon },
      { id: "downloads", label: "Downloads", icon: Download, badge: activeDownloadCount || undefined },
      { id: "prompts", label: "Prompts", icon: Sparkles },
    ],
    [localModelCount, enabledProviderCount, activeDownloadCount],
  );

  const handleNewChat = () => {
    const id = createThread();
    setActiveThread(id);
    setRoute("chat");
  };

  return (
    <aside
      className={cn(
        "relative flex h-full w-full flex-col bg-surface-deep/80 backdrop-blur-xl border-r border-line-subtle",
        "overflow-hidden",
      )}
    >
      {/* Top — New chat */}
      <div className="flex flex-col gap-2 p-2.5 pb-1.5">
        {collapsed ? (
          <Tooltip content="New chat" shortcut="Mod+N" side="right">
            <IconButton label="New chat" variant="primary" size="md" onClick={handleNewChat} className="w-full">
              <Plus />
            </IconButton>
          </Tooltip>
        ) : (
          <motion.button
            type="button"
            whileHover={{ y: -0.5 }}
            whileTap={{ y: 0.5, scale: 0.985 }}
            onClick={handleNewChat}
            className={cn(
              "group relative flex h-9 cursor-pointer items-center gap-2 overflow-hidden rounded-xl",
              "bg-gradient-to-br from-brand-indigo-500 to-brand-indigo-600 px-3 text-white",
              "shadow-[0_4px_16px_rgba(99,102,241,0.32)] hover:shadow-[0_6px_24px_rgba(99,102,241,0.40)]",
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium truncate">New chat</span>
            <kbd className="ml-auto hidden lg:inline-flex items-center gap-0.5 rounded-md bg-overlay/1500 px-1.5 py-0.5 text-2xs font-medium text-overlay/9000">
              ⌘N
            </kbd>
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-overlay/2500 to-transparent group-hover:translate-x-full transition-transform duration-700" />
          </motion.button>
        )}

        {!collapsed && (
          <button
            type="button"
            onClick={() => setCommandPalette(true)}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-line-subtle bg-surface-raised/60 px-2.5 text-xs text-ink-muted hover:text-ink-tertiary hover:border-line-soft transition-colors"
          >
            <Search className="h-3 w-3" />
            <span>Search…</span>
          </button>
        )}
      </div>

      {/* Middle — chat list */}
      <ChatListSection collapsed={collapsed} />

      {/* Bottom nav + profile — collapsed by default, opened with the "+" button.
          When open, a "-" button at the top collapses it again.
          When the SIDEBAR itself is in rail (icon-only) mode, we always show
          the nav icons (no toggle) — that's the whole point of the rail. */}
      {collapsed ? (
        // Rail mode: just show nav icons + settings icon + profile.
        <>
          <div className="flex flex-col gap-0.5 p-2 pt-1.5 border-t border-line-subtle">
            {navItems.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={route === item.id}
                collapsed={collapsed}
                onClick={() => {
                  setRoute(item.id);
                  setActiveThread(null);
                }}
              />
            ))}
            <NavButton
              item={{ id: "settings", label: "Settings", icon: Settings }}
              active={route === "settings"}
              collapsed={collapsed}
              onClick={() => {
                setRoute("settings");
                setActiveThread(null);
              }}
            />
          </div>
          <div className="mt-auto p-2 pt-1.5 border-t border-line-subtle">
            <UserProfile collapsed={collapsed} />
          </div>
        </>
      ) : (
        // Expanded mode: bottom section is collapsible (default: hidden).
        <>
          <AnimatePresence initial={false}>
            {sidebarBottomOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-0.5 p-2 pt-1.5 border-t border-line-subtle">
                  {navItems.map((item) => (
                    <NavButton
                      key={item.id}
                      item={item}
                      active={route === item.id}
                      collapsed={collapsed}
                      onClick={() => {
                        setRoute(item.id);
                        setActiveThread(null);
                      }}
                    />
                  ))}
                </div>

                <div className="flex flex-col gap-0.5 p-2 pt-1.5 border-t border-line-subtle">
                  <NavButton
                    item={{ id: "settings", label: "Settings", icon: Settings }}
                    active={route === "settings"}
                    collapsed={collapsed}
                    onClick={() => {
                      setRoute("settings");
                      setActiveThread(null);
                    }}
                  />
                  <UserProfile collapsed={collapsed} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Collapse toggle — "+" to open the bottom section, "-" to close it. */}
          <div className="mt-auto p-2 pt-1.5 border-t border-line-subtle">
            <button
              type="button"
              onClick={() => setSidebarBottomOpen(!sidebarBottomOpen)}
              className={cn(
                "flex w-full h-8 cursor-pointer items-center justify-center gap-2 rounded-lg",
                "text-ink-tertiary hover:bg-overlay/4 hover:text-ink-secondary transition-colors",
              )}
              aria-label={sidebarBottomOpen ? "Hide navigation" : "Show navigation"}
            >
              {sidebarBottomOpen ? (
                <>
                  <Minus className="h-3.5 w-3.5" />
                  <span className="text-2xs font-medium">Hide navigation</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  <span className="text-2xs font-medium">Show navigation</span>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function NavButton({ item, active, collapsed, onClick }: { item: NavItem; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  const button = (
    <motion.button
      type="button"
      whileHover={{ x: collapsed ? 0 : 1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "group relative flex h-9 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-overlay/8 text-ink-primary"
          : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4",
        collapsed && "justify-center px-0",
      )}
    >
      {active && !collapsed && (
        <motion.span
          layoutId="sidebar-active"
          transition={{ type: "spring", stiffness: 480, damping: 32 }}
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-brand-indigo-400 to-brand-indigo-500"
        />
      )}
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-brand-indigo-300")} />
      {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
      {!collapsed && item.badge !== undefined && item.badge > 0 && (
        <span className="rounded-md bg-overlay/6 px-1.5 py-0.5 text-2xs font-medium text-ink-tertiary">
          {item.badge}
        </span>
      )}
      {collapsed && item.badge !== undefined && item.badge > 0 && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-teal-400" />
      )}
    </motion.button>
  );

  if (collapsed) {
    return (
      <Tooltip content={item.label} side="right">
        {button}
      </Tooltip>
    );
  }
  return button;
}

function ChatListSection({ collapsed }: { collapsed: boolean }) {
  const threads = useChatStore((s) => s.threads);
  const folders = useChatStore((s) => s.folders);
  const activeThreadId = useUIStore((s) => s.activeThreadId);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const setRoute = useUIStore((s) => s.setRoute);
  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const togglePin = useChatStore((s) => s.togglePinThread);
  const renameThread = useChatStore((s) => s.renameThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const archiveThread = useChatStore((s) => s.archiveThread);
  const [query, setQuery] = useState("");

  if (collapsed) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center gap-1 py-3">
        <Tooltip content="Chats" side="right">
          <IconButton label="Chats" size="md" variant="ghost">
            <MessageSquare />
          </IconButton>
        </Tooltip>
        <Tooltip content="Pinned" side="right">
          <IconButton label="Pinned" size="md" variant="ghost">
            <Pin />
          </IconButton>
        </Tooltip>
        <Tooltip content="Folders" side="right">
          <IconButton label="Folders" size="md" variant="ghost">
            <Folder />
          </IconButton>
        </Tooltip>
      </div>
    );
  }

  const pinned = threads.filter((t) => t.pinned && !t.archived);
  const recent = threads.filter((t) => !t.pinned && !t.archived);
  const filteredPinned = pinned.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()));
  const filteredRecent = recent.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2.5 pb-1.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">Chats</span>
          <span className="text-2xs text-ink-faint">{threads.length}</span>
        </div>
      </div>
      <div className="px-2.5 pb-2">
        <div className="flex h-7 items-center gap-1.5 rounded-lg border border-line-subtle bg-surface-raised/40 px-2 text-xs">
          <Search className="h-3 w-3 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-transparent text-ink-secondary placeholder:text-ink-faint focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
        {threads.length === 0 && (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-xl bg-surface-raised border border-line-subtle text-ink-faint">
              <MessageSquare className="h-4 w-4" />
            </div>
            <p className="text-xs text-ink-tertiary">No conversations yet</p>
            <p className="text-2xs text-ink-faint mt-1">Press ⌘N to start one</p>
          </div>
        )}

        {filteredPinned.length > 0 && (
          <SidebarSection icon={Pin} label="Pinned" defaultOpen>
            {filteredPinned.map((t) => (
              <ChatRow
                key={t.id}
                title={t.title}
                preview={t.lastPreview}
                ts={t.updatedAt}
                active={activeThreadId === t.id}
                onClick={() => {
                  setActiveThread(t.id);
                  setRoute("chat");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, [
                    { id: "open", label: "Open", icon: <MessageSquare />, onSelect: () => { setActiveThread(t.id); setRoute("chat"); } },
                    { id: "rename", label: "Rename", icon: <Pencil />, onSelect: () => {
                      void promptDialog("Rename chat", {
                        description: "Give this conversation a new title.",
                        defaultValue: t.title,
                        placeholder: "Chat title",
                        confirmLabel: "Save",
                      }).then((next) => {
                        if (next && next.trim()) renameThread(t.id, next.trim());
                      });
                    } },
                    { id: "pin", label: t.pinned ? "Unpin" : "Pin", icon: <Pin />, onSelect: () => togglePin(t.id) },
                    { id: "archive", label: "Archive", icon: <Archive />, onSelect: () => archiveThread(t.id, true) },
                    { id: "delete", label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => deleteThread(t.id) },
                  ]);
                }}
              />
            ))}
          </SidebarSection>
        )}

        {folders.map((folder) => {
          const folderThreads = threads.filter((t) => t.folderId === folder.id && !t.archived);
          if (folderThreads.length === 0) return null;
          return (
            <SidebarSection
              key={folder.id}
              icon={Folder}
              label={folder.name}
              accent={folder.color}
              defaultOpen={!folder.collapsed}
            >
              {folderThreads.map((t) => (
                <ChatRow
                  key={t.id}
                  title={t.title}
                  preview={t.lastPreview}
                  ts={t.updatedAt}
                  active={activeThreadId === t.id}
                  onClick={() => {
                    setActiveThread(t.id);
                    setRoute("chat");
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openContextMenu(e.clientX, e.clientY, [
                      { id: "open", label: "Open", icon: <MessageSquare />, onSelect: () => { setActiveThread(t.id); setRoute("chat"); } },
                      { id: "rename", label: "Rename", icon: <Pencil />, onSelect: () => {
                        void promptDialog("Rename chat", {
                          description: "Give this conversation a new title.",
                          defaultValue: t.title,
                          placeholder: "Chat title",
                          confirmLabel: "Save",
                        }).then((next) => {
                          if (next && next.trim()) renameThread(t.id, next.trim());
                        });
                      } },
                      { id: "delete", label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => deleteThread(t.id) },
                    ]);
                  }}
                />
              ))}
            </SidebarSection>
          );
        })}

        {filteredRecent.length > 0 && (
          <SidebarSection icon={MessageSquare} label="Recent" defaultOpen>
            {filteredRecent.map((t) => (
              <ChatRow
                key={t.id}
                title={t.title}
                preview={t.lastPreview}
                ts={t.updatedAt}
                active={activeThreadId === t.id}
                onClick={() => {
                  setActiveThread(t.id);
                  setRoute("chat");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, [
                    { id: "open", label: "Open", icon: <MessageSquare />, onSelect: () => { setActiveThread(t.id); setRoute("chat"); } },
                    { id: "rename", label: "Rename", icon: <Pencil />, onSelect: () => {
                      void promptDialog("Rename chat", {
                        description: "Give this conversation a new title.",
                        defaultValue: t.title,
                        placeholder: "Chat title",
                        confirmLabel: "Save",
                      }).then((next) => {
                        if (next && next.trim()) renameThread(t.id, next.trim());
                      });
                    } },
                    { id: "pin", label: t.pinned ? "Unpin" : "Pin", icon: <Pin />, onSelect: () => togglePin(t.id) },
                    { id: "archive", label: "Archive", icon: <Archive />, onSelect: () => archiveThread(t.id, true) },
                    { id: "delete", label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => deleteThread(t.id) },
                  ]);
                }}
              />
            ))}
          </SidebarSection>
        )}
      </div>
    </div>
  );
}

function SidebarSection({
  icon: Icon,
  label,
  children,
  defaultOpen,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-semibold uppercase tracking-wider text-ink-muted hover:text-ink-tertiary transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Icon className="h-3 w-3" style={accent ? { color: accent } : undefined} />
        <span className="flex-1 text-left">{label}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-0.5 py-0.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatRow({
  title,
  preview,
  ts,
  active,
  onClick,
  onContextMenu,
}: {
  title: string;
  preview?: string;
  ts: string;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors",
        active ? "bg-overlay/8" : "hover:bg-overlay/4",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("flex-1 truncate text-sm font-medium", active ? "text-ink-primary" : "text-ink-secondary")}>
          {truncate(title, 32)}
        </span>
        <span className="shrink-0 text-2xs text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity">
          {formatRelativeTime(ts)}
        </span>
        <MoreHorizontal className="h-3.5 w-3.5 text-ink-faint opacity-0 group-hover:opacity-100" />
      </div>
      {preview && <span className="truncate text-2xs text-ink-faint">{preview}</span>}
    </motion.button>
  );
}

function UserProfile({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const displayName = useSettingsStore((s) => s.settings.displayName);
  const bio = useSettingsStore((s) => s.settings.bio);
  const profilePicture = useSettingsStore((s) => s.settings.profilePicture);
  const update = useSettingsStore((s) => s.update);
  const [draftName, setDraftName] = useState(displayName);
  const [draftBio, setDraftBio] = useState(bio);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the draft fields in sync with the store when not editing.
  useEffect(() => {
    if (!editing) {
      setDraftName(displayName);
      setDraftBio(bio);
    }
  }, [displayName, bio, editing]);

  const save = () => {
    update("displayName", draftName.trim() || "Xirea User");
    update("bio", draftBio.trim() || "Local profile");
    setEditing(false);
  };

  const cancel = () => {
    setDraftName(displayName);
    setDraftBio(bio);
    setEditing(false);
  };

  const handlePickPicture = () => {
    fileInputRef.current?.click();
  };

  const handlePictureChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Read the file as a data URL so it persists in localStorage and survives
    // app restarts without needing to keep the source file on disk.
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        update("profilePicture", result);
        useUIStore.getState().pushToast({
          title: "Profile picture updated",
          variant: "success",
        });
      }
    };
    reader.onerror = () => {
      useUIStore.getState().pushToast({
        title: "Could not load picture",
        description: "Try a smaller image (PNG or JPG, under 4 MB).",
        variant: "danger",
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemovePicture = () => {
    update("profilePicture", undefined);
    useUIStore.getState().pushToast({
      title: "Profile picture removed",
      variant: "info",
    });
  };

  if (collapsed) {
    return (
      <Tooltip content={displayName} side="right">
        <div className="grid h-10 w-full place-items-center rounded-xl border border-line-subtle bg-surface-raised">
          <ProfileAvatar picture={profilePicture} name={displayName} size={28} />
        </div>
      </Tooltip>
    );
  }

  return (
    <div className="relative mt-1">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handlePictureChosen}
      />
      <motion.button
        type="button"
        whileHover={{ y: -0.5 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl border border-line-subtle bg-surface-raised/60 p-1.5 pr-2 hover:border-line-soft transition-colors",
        )}
      >
        <ProfileAvatar picture={profilePicture} name={displayName} size={28} ring />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-ink-primary">{displayName}</span>
          <span className="truncate text-2xs text-ink-tertiary">{bio}</span>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
      </motion.button>
      <AnimatePresence>
        {open && !collapsed && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full left-0 right-0 mb-2 surface-raised rounded-xl border border-line-soft p-2 shadow-elev-3"
          >
            {editing ? (
              <div className="flex flex-col gap-2 p-1">
                {/* Profile picture preview + change / remove buttons */}
                <div className="flex items-center gap-3">
                  <ProfileAvatar picture={profilePicture} name={draftName} size={40} />
                  <div className="flex flex-col gap-1 flex-1">
                    <button
                      type="button"
                      onClick={handlePickPicture}
                      className="cursor-pointer rounded-lg bg-surface-deep border border-line-soft px-2.5 py-1 text-2xs text-ink-secondary hover:text-ink-primary hover:border-line-medium"
                    >
                      Change picture
                    </button>
                    {profilePicture && (
                      <button
                        type="button"
                        onClick={handleRemovePicture}
                        className="cursor-pointer rounded-lg px-2.5 py-1 text-2xs text-status-danger hover:bg-status-danger/10"
                      >
                        Remove picture
                      </button>
                    )}
                  </div>
                </div>
                <label className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">Display name</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg bg-surface-deep border border-line-soft px-2.5 py-1.5 text-xs text-ink-primary focus:outline-none focus:border-brand-indigo-400/60"
                  autoFocus
                />
                <label className="text-2xs font-semibold uppercase tracking-wider text-ink-muted mt-1">Bio</label>
                <input
                  type="text"
                  value={draftBio}
                  onChange={(e) => setDraftBio(e.target.value)}
                  placeholder="Local profile"
                  className="w-full rounded-lg bg-surface-deep border border-line-soft px-2.5 py-1.5 text-xs text-ink-primary focus:outline-none focus:border-brand-indigo-400/60"
                />
                <div className="flex gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex-1 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs text-ink-tertiary hover:text-ink-primary hover:bg-overlay/6"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    className="flex-1 cursor-pointer rounded-lg bg-gradient-to-br from-brand-indigo-500 to-brand-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary hover:bg-overlay/6 hover:text-ink-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useUIStore.getState().setRoute("settings");
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary hover:bg-overlay/6 hover:text-ink-primary"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Open settings
                </button>
                <div className="my-1 h-px bg-line-subtle" />
                <button
                  type="button"
                  onClick={() => {
                    useUIStore.getState().setRoute("downloads");
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary hover:bg-overlay/6 hover:text-ink-primary"
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  Storage & downloads
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useUIStore.getState().setRoute("archived");
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary hover:bg-overlay/6 hover:text-ink-primary"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archived chats
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
