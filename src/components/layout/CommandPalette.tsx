/**
 * CommandPalette — Cmd+K overlay for fast navigation and actions.
 *
 * Searches across: routes, chat threads, prompts, models, providers, files.
 * Returns an action result; selecting it executes that action.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  CornerDownLeft,
  MessageSquare,
  Cpu,
  Cloud,
  Files as FilesIcon,
  Download,
  Sparkles,
  Settings,
  Box,
  Plus,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui";
import { useChatStore } from "@/store/chat";
import { useModelsStore } from "@/store/models";
import { useProvidersStore } from "@/store/providers";
import { usePromptsStore } from "@/store/prompts";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import type { RouteId } from "@/types";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: string;
  action: () => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPalette);
  const setRoute = useUIStore((s) => s.setRoute);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const createThread = useChatStore((s) => s.createThread);
  const threads = useChatStore((s) => s.threads);
  const localModels = useModelsStore((s) => s.local);
  const providers = useProvidersStore((s) => s.providers);
  const prompts = usePromptsStore((s) => s.prompts);
  const files = useFilesStore((s) => s.files);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => {
    const navigate = (route: RouteId) => () => {
      setRoute(route);
      setActiveThread(null);
    };
    const groups: CommandItem[][] = [];

    groups.push([
      { id: "new-chat", label: "New chat", hint: "Chat", icon: Plus, group: "Actions", action: () => { const id = createThread(); setActiveThread(id); setRoute("chat"); } },
      { id: "toggle-theme", label: settings.theme === "dark" ? "Switch to light theme" : "Switch to dark theme", hint: "Theme", icon: settings.theme === "dark" ? Sun : Moon, group: "Actions", action: () => updateSettings("theme", settings.theme === "dark" ? "light" : "dark") },
    ]);

    groups.push(
      [
        { id: "go-chat", label: "Go to Chat", icon: MessageSquare, group: "Navigate", action: navigate("chat") },
        { id: "go-models", label: "Go to Models", icon: Cpu, group: "Navigate", action: navigate("models") },
        { id: "go-providers", label: "Go to Providers", icon: Cloud, group: "Navigate", action: navigate("providers") },
        { id: "go-hf", label: "Go to Hugging Face", icon: Box, group: "Navigate", action: navigate("huggingface") },
        { id: "go-files", label: "Go to Files", icon: FilesIcon, group: "Navigate", action: navigate("files") },
        { id: "go-downloads", label: "Go to Downloads", icon: Download, group: "Navigate", action: navigate("downloads") },
        { id: "go-prompts", label: "Go to Prompt Library", icon: Sparkles, group: "Navigate", action: navigate("prompts") },
        { id: "go-settings", label: "Go to Settings", icon: Settings, group: "Navigate", action: navigate("settings") },
      ] satisfies CommandItem[],
    );

    groups.push(
      threads.slice(0, 8).map((t) => ({
        id: `thread:${t.id}`,
        label: t.title,
        hint: "Thread",
        icon: MessageSquare,
        group: "Chats",
        action: () => { setActiveThread(t.id); setRoute("chat"); },
      })),
    );

    groups.push(
      localModels.slice(0, 6).map((m) => ({
        id: `model:${m.id}`,
        label: m.name,
        hint: "Local model",
        icon: Cpu,
        group: "Models",
        action: navigate("models"),
      })),
    );

    groups.push(
      providers.slice(0, 6).map((p) => ({
        id: `provider:${p.id}`,
        label: p.name,
        hint: "Provider",
        icon: Cloud,
        group: "Providers",
        action: navigate("providers"),
      })),
    );

    groups.push(
      prompts.slice(0, 6).map((p) => ({
        id: `prompt:${p.id}`,
        label: p.title,
        hint: "Prompt",
        icon: Sparkles,
        group: "Prompts",
        action: navigate("prompts"),
      })),
    );

    groups.push(
      files.slice(0, 6).map((f) => ({
        id: `file:${f.id}`,
        label: f.name,
        hint: "File",
        icon: FilesIcon,
        group: "Files",
        action: navigate("files"),
      })),
    );

    return groups;
  }, [threads, localModels, providers, prompts, files, settings.theme, createThread, setActiveThread, setRoute, updateSettings]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return items;
    return items
      .map((group) => group.filter((item) => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q)))
      .filter((group) => group.length > 0);
  }, [items, query]);

  const flat = flatten(filtered);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((v) => Math.min(v + 1, flat.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((v) => Math.max(0, v - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const target = flat[active];
        if (target) {
          target.action();
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    // Reset state when the palette opens — but NOT on every `active` change.
    setTimeout(() => {
      inputRef.current?.focus();
      setQuery("");
      setActive(0);
    }, 16);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, active, setOpen]);

  // Keep `active` bounded to the current filtered list length.
  useEffect(() => {
    const max = flat.length - 1;
    if (active > max) setActive(Math.max(0, max));
  }, [flat, active]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[250] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <div className="absolute inset-0 bg-surface-midnight/72 backdrop-blur-md" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl surface-raised shadow-elev-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3">
              <Search className="h-4 w-4 text-ink-tertiary" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search or jump to…"
                className="flex-1 bg-transparent text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
              />
              <kbd className="kbd">esc</kbd>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {flat.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="text-sm text-ink-tertiary">No results for “{query}”</p>
                </div>
              )}
              {filtered.map((group, gi) => (
                <div key={gi} className="mb-1">
                  <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-ink-muted">{group[0]?.group}</div>
                  {group.map((item) => {
                    const index = flat.findIndex((x) => x.id === item.id);
                    const isActive = index === active;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setActive(index)}
                        onClick={() => {
                          item.action();
                          setOpen(false);
                        }}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                          isActive ? "bg-overlay/6" : "hover:bg-overlay/4",
                        )}
                      >
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-overlay/4 border border-line-subtle text-ink-tertiary [&>svg]:h-3.5 [&>svg]:w-3.5">
                          <Icon />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-sm font-medium text-ink-primary">{item.label}</span>
                          {item.hint && <span className="block text-2xs text-ink-tertiary">{item.hint}</span>}
                        </span>
                        {isActive && <CornerDownLeft className="h-3 w-3 text-brand-indigo-300" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-3 py-2 text-2xs text-ink-faint">
              <div className="flex items-center gap-3">
                <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navigate</span>
                <span><kbd className="kbd">↵</kbd> select</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-brand-indigo-400 to-brand-indigo-500" />
                <span>Xirea Command</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function flatten(groups: CommandItem[][]): CommandItem[] {
  return groups.flat();
}
