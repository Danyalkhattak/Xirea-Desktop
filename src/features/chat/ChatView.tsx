/**
 * ChatView — the main chat experience.
 *
 * Layout:
 *  - ChatHeader (thread title, model badge, actions)
 *  - MessagesList (virtualized scroll, anchor at bottom)
 *  - Composer
 *
 * When no thread is selected, renders a hero empty state with quick actions.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  MessageSquare,
  MoreHorizontal,
  Wand2,
  FileText,
  Code2,
  Lightbulb,
  PenLine,
  AlertCircle,
  Trash2,
  Pin,
  Pencil,
  Archive,
  PanelTop,
  Download,
} from "lucide-react";
import { cn, uid } from "@/lib/utils";
import { useChatStore } from "@/store/chat";
import { useUIStore } from "@/store/ui";
import { useSettingsStore } from "@/store/settings";
import { useProvidersStore } from "@/store/providers";
import { useModelsStore } from "@/store/models";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { Badge } from "@/components/ui/Badge";
import type { Attachment, ChatMessage } from "@/types";
import { streamResponse } from "@/lib/llm";
import { describeActiveModel } from "@/lib/llm";
import { confirmDialog, promptDialog } from "@/store/dialog";
import { saveFile, isTauri } from "@/lib/tauri";

export function ChatView() {
  const activeThreadId = useUIStore((s) => s.activeThreadId);
  const threads = useChatStore((s) => s.threads);
  const messages = useChatStore((s) => s.messages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const createThread = useChatStore((s) => s.createThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const togglePinThread = useChatStore((s) => s.togglePinThread);
  const archiveThread = useChatStore((s) => s.archiveThread);
  const renameThread = useChatStore((s) => s.renameThread);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const setRoute = useUIStore((s) => s.setRoute);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const openContextMenu = useUIStore((s) => s.openContextMenu);
  const pushToast = useUIStore((s) => s.pushToast);

  // Use primitive selectors to avoid object reference instability.
  const systemPrompt = useSettingsStore((s) => s.settings.systemPrompt);
  // Subscribe to defaultModelId and defaultProviderId so the header label
  // updates immediately when the user picks a different model from the
  // Composer's inline picker. Without these subscriptions, ChatView wouldn't
  // re-render when the default model changes, and the header would keep
  // showing the stale "previous" model.
  const defaultModelId = useSettingsStore((s) => s.settings.defaultModelId);
  const defaultProviderId = useSettingsStore((s) => s.settings.defaultProviderId);
  // Also subscribe to the providers list reference — when a provider is
  // enabled/disabled or its model list changes, the header label should
  // refresh too. We grab a stable primitive (the count) so we don't break
  // useSyncExternalStore's caching invariant.
  const providersVersion = useProvidersStore((s) => s.providers.length);
  const localModelsVersion = useModelsStore((s) => s.local.length);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const stopFnRef = useRef<{ cancel: () => Promise<void> } | null>(null);

  const thread = threads.find((t) => t.id === activeThreadId);
  const list = activeThreadId ? messages[activeThreadId] ?? [] : [];

  // Auto-scroll to bottom when new messages arrive
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [list.length, list.at(-1)?.content]);

  const streamAssistant = (threadId: string, prompt: string, assistantId: string) => {
    const active = describeActiveModel();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      modelId: active.model ?? "xirea-default",
      streaming: { state: "thinking", startedAt: Date.now(), tokens: 0 },
    };
    appendMessage(threadId, assistantMessage);
    setStreamingId(assistantId);

    // History = everything in this thread except the new assistant placeholder.
    const history = (useChatStore.getState().messages[threadId] ?? []).filter(
      (m) => m.id !== assistantId,
    );

    void streamResponse({
      prompt,
      history,
      system: systemPrompt,
      onDelta: (_delta, accumulated, tokens) => {
        updateMessage(threadId, assistantId, {
          content: accumulated,
          streaming: { state: "streaming", tokens, startedAt: assistantMessage.streaming?.startedAt },
        });
      },
      onReasoning: (delta) => {
        const existing = useChatStore.getState().messages[threadId]?.find((m) => m.id === assistantId);
        const prevReasoning = existing?.reasoning ?? "";
        updateMessage(threadId, assistantId, {
          reasoning: prevReasoning + delta,
        });
      },
      onDone: (final, tokens) => {
        updateMessage(threadId, assistantId, {
          content: final || "(empty response)",
          streaming: { state: "done", tokens },
          updatedAt: new Date().toISOString(),
        });
        setStreamingId(null);
        stopFnRef.current = null;
      },
      onError: (err) => {
        updateMessage(threadId, assistantId, {
          streaming: { state: "error" },
          error: err,
        });
        setStreamingId(null);
        stopFnRef.current = null;
        pushToast({ title: "Generation failed", description: err, variant: "danger" });
      },
    }).then((handle) => {
      stopFnRef.current = handle;
    });
  };

  const handleSend = async (text: string, attachments: Attachment[]) => {
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = createThread({ title: text.slice(0, 48) || "New chat" });
      setActiveThread(threadId);
    }

    const userMessage: ChatMessage = {
      id: uid("msg"),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    appendMessage(threadId, userMessage);

    streamAssistant(threadId, text || "(no prompt)", uid("msg"));
  };

  const handleStop = () => {
    void stopFnRef.current?.cancel();
    stopFnRef.current = null;
    if (streamingId && activeThreadId) {
      updateMessage(activeThreadId, streamingId, {
        streaming: { state: "cancelled" },
        updatedAt: new Date().toISOString(),
      });
    }
    setStreamingId(null);
  };

  const handleRegenerate = () => {
    if (!activeThreadId || list.length === 0) return;
    const lastUser = [...list].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Reset the last assistant message and re-stream
    const lastAssistant = [...list].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      updateMessage(activeThreadId, lastAssistant.id, {
        content: "",
        error: undefined,
        reasoning: undefined,
        streaming: { state: "thinking", startedAt: Date.now(), tokens: 0 },
      });
      setStreamingId(lastAssistant.id);

      const history = (useChatStore.getState().messages[activeThreadId] ?? [])
        .filter((m) => m.id !== lastAssistant.id);

      void streamResponse({
        prompt: lastUser.content,
        history,
        system: systemPrompt,
        onDelta: (_delta, accumulated, tokens) => {
          updateMessage(activeThreadId, lastAssistant.id, {
            content: accumulated,
            streaming: { state: "streaming", tokens },
          });
        },
        onDone: (final, tokens) => {
          updateMessage(activeThreadId, lastAssistant.id, {
            content: final || "(empty response)",
            streaming: { state: "done", tokens },
            updatedAt: new Date().toISOString(),
          });
          setStreamingId(null);
          stopFnRef.current = null;
        },
        onError: (err) => {
          updateMessage(activeThreadId, lastAssistant.id, {
            streaming: { state: "error" },
            error: err,
          });
          setStreamingId(null);
          stopFnRef.current = null;
        },
      }).then((handle) => {
        stopFnRef.current = handle;
      });
    }
  };

  // Pick a suggested hero action
  const handleHeroAction = (prompt: string) => {
    void handleSend(prompt, []);
  };

  /**
   * Export the current chat to a file. Tauri's save dialog writes to disk
   * directly; in browser dev mode we fall back to a download attribute.
   * Supports both Markdown (human-readable, with role headers) and JSON
   * (machine-readable, preserves all metadata).
   */
  const handleExportChat = async (format: "markdown" | "json") => {
    if (!thread) return;
    const msgs = list;
    const safeTitle = (thread.title || "chat").replace(/[^\w-]+/g, "_").slice(0, 60);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        thread,
        messages: msgs,
      };
      const json = JSON.stringify(payload, null, 2);
      const defaultName = `xirea-${safeTitle}-${stamp}.json`;
      if (isTauri()) {
        const target = await saveFile({
          defaultName,
          filters: [{ name: "JSON", extensions: ["json"] }],
          title: "Export chat as JSON",
        });
        if (!target) return;
        try {
          const { writeTextFile } = await import("@tauri-apps/plugin-fs");
          await writeTextFile(target, json);
          pushToast({ title: "Chat exported", description: target, variant: "success" });
        } catch (e) {
          pushToast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "danger" });
        }
      } else {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        pushToast({ title: "Chat exported", variant: "success" });
      }
    } else {
      // Markdown — human-readable transcript.
      const lines: string[] = [
        `# ${thread.title}`,
        "",
        `_Exported from Xirea on ${new Date().toLocaleString()}_`,
        "",
        "---",
        "",
      ];
      for (const m of msgs) {
        const speaker = m.role === "user" ? "🧑 You" : m.role === "assistant" ? "✨ Xirea" : m.role;
        const ts = new Date(m.createdAt).toLocaleString();
        lines.push(`## ${speaker} — _${ts}_`);
        if (m.modelId) lines.push(`_Model: \`${m.modelId}\`_`);
        lines.push("");
        lines.push(m.content || "_(empty)_");
        if (m.error) lines.push(`\n> ⚠️ **Error:** ${m.error}`);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      const md = lines.join("\n");
      const defaultName = `xirea-${safeTitle}-${stamp}.md`;
      if (isTauri()) {
        const target = await saveFile({
          defaultName,
          filters: [{ name: "Markdown", extensions: ["md"] }],
          title: "Export chat as Markdown",
        });
        if (!target) return;
        try {
          const { writeTextFile } = await import("@tauri-apps/plugin-fs");
          await writeTextFile(target, md);
          pushToast({ title: "Chat exported", description: target, variant: "success" });
        } catch (e) {
          pushToast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "danger" });
        }
      } else {
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        pushToast({ title: "Chat exported", variant: "success" });
      }
    }
  };

  if (!activeThreadId || !thread) {
    return <ChatEmptyState onPick={handleHeroAction} />;
  }

  const active = describeActiveModel();
  // Reference defaultModelId / defaultProviderId / providersVersion /
  // localModelsVersion so the subscriptions stay active — these values
  // trigger re-renders when changed, which makes the header label update
  // immediately when the user picks a different model, enables a provider,
  // or imports a local model.
  void defaultModelId;
  void defaultProviderId;
  void providersVersion;
  void localModelsVersion;

  return (
    <div className="flex h-full items-stretch justify-center">
      {/* Centered chat column — wraps header + messages + composer so they all
          share the same max-width and stay visually centered in the workspace.
          When the activity panel (right dock) is open, the workspace shrinks
          and the chat column stays centered in the remaining space; when the
          panel is closed, the chat column is centered in the full workspace.
          `items-stretch` + `justify-center` keeps the column both horizontally
          centered AND filling the full height of the workspace. */}
      <div className="flex h-full w-full max-w-5xl flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-surface-raised border border-line-subtle">
              <MessageSquare className="h-3.5 w-3.5 text-brand-indigo-300" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-ink-primary">{thread.title}</h2>
              <p className="text-2xs text-ink-faint">
                {thread.messageCount} messages · {active.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {thread.pinned && <Badge variant="fuchsia" dot>Pinned</Badge>}
            <Tooltip content="Toggle pin">
              <IconButton
                label={thread.pinned ? "Unpin chat" : "Pin chat"}
                size="sm"
                variant="ghost"
                active={thread.pinned}
                onClick={() => togglePinThread(thread.id)}
              >
                <Pin />
              </IconButton>
            </Tooltip>
            <Tooltip content="Chat actions">
              <IconButton
                label="More"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  openContextMenu(rect.left, rect.bottom, [
                    {
                      id: "rename",
                      label: "Rename",
                      icon: <Pencil />,
                      onSelect: () => {
                        void promptDialog("Rename chat", {
                          description: "Give this conversation a new title.",
                          defaultValue: thread.title,
                          placeholder: "Chat title",
                          confirmLabel: "Save",
                        }).then((next) => {
                          if (next && next.trim()) renameThread(thread.id, next.trim());
                        });
                      },
                    },
                    {
                      id: "pin",
                      label: thread.pinned ? "Unpin" : "Pin",
                      icon: <Pin />,
                      onSelect: () => togglePinThread(thread.id),
                    },
                    {
                      id: "archive",
                      label: "Archive",
                      icon: <Archive />,
                      onSelect: () => {
                        archiveThread(thread.id, true);
                        setActiveThread(null);
                        setRoute("chat");
                        pushToast({ title: "Chat archived", variant: "info" });
                      },
                    },
                    { id: "sep1", label: "", separator: true },
                    {
                      id: "export-md",
                      label: "Export as Markdown",
                      icon: <Download />,
                      onSelect: () => void handleExportChat("markdown"),
                    },
                    {
                      id: "export-json",
                      label: "Export as JSON",
                      icon: <Download />,
                      onSelect: () => void handleExportChat("json"),
                    },
                    { id: "sep2", label: "", separator: true },
                    {
                      id: "clear",
                      label: "Clear messages",
                      icon: <PanelTop />,
                      destructive: true,
                      onSelect: () => {
                        void confirmDialog("Clear all messages?", "This removes every message in this chat. The thread itself is kept. This cannot be undone.", {
                          variant: "danger",
                          confirmLabel: "Clear",
                        }).then((ok) => {
                          if (ok) {
                            clearMessages(thread.id);
                            pushToast({ title: "Messages cleared", variant: "info" });
                          }
                        });
                      },
                    },
                    {
                      id: "delete",
                      label: "Delete chat",
                      icon: <Trash2 />,
                      destructive: true,
                      onSelect: () => {
                        void confirmDialog("Delete this chat?", "This permanently removes the conversation and all its messages. This cannot be undone.", {
                          variant: "danger",
                          confirmLabel: "Delete",
                        }).then((ok) => {
                          if (ok) {
                            deleteThread(thread.id);
                            setActiveThread(null);
                            setRoute("chat");
                            pushToast({ title: "Chat deleted", variant: "info" });
                          }
                        });
                      },
                    },
                  ]);
                }}
              >
                <MoreHorizontal />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {/* Provider warning when no model is selected */}
        {!active.provider && (
          <div className="flex items-start gap-2 border-b border-status-warning/30 bg-status-warning/[0.06] px-4 py-2.5 text-xs text-status-warning">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-semibold">No provider configured</p>
              <p className="text-status-warning/80">
                Open <button type="button" className="underline cursor-pointer" onClick={() => useUIStore.getState().setRoute("providers")}>Providers</button> and enable one to start chatting.
              </p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto">
          <div className="px-2 py-2" style={{ display: "flex", flexDirection: "column", gap: "var(--msg-gap, 0.85rem)" }}>
            {list.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-6 w-6" />}
                title="What's on your mind?"
                description="Type a message below, or pick a starter prompt. Xirea runs entirely on-device — your conversation never leaves this machine."
                size="lg"
              />
            ) : (
              list.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  threadId={thread.id}
                  isLast={i === list.length - 1}
                  canRegenerate={!streamingId && m.role === "assistant" && i === list.length - 1}
                  onRegenerate={handleRegenerate}
                  onStop={handleStop}
                />
              ))
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-line-subtle bg-surface-deep/40 px-3 py-3">
          <Composer threadId={thread.id} onSend={handleSend} onStop={handleStop} streaming={!!streamingId} />
        </div>
      </div>
    </div>
  );
}

function ChatEmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  const cards = [
    { icon: PenLine, title: "Draft an email", prompt: "Draft a warm, professional email to my team announcing a project milestone. Keep it under 150 words.", accent: "brand-indigo" as const },
    { icon: Code2, title: "Review my code", prompt: "Review this TypeScript for bugs, performance, and readability:\n\n```ts\n// paste code here\n```", accent: "brand-teal" as const },
    { icon: Lightbulb, title: "Brainstorm ideas", prompt: "Brainstorm 10 non-obvious product ideas for on-device AI assistants. Group them by risk.", accent: "brand-fuchsia" as const },
    { icon: FileText, title: "Summarize a doc", prompt: "Summarize this document in 5 bullet points and a one-paragraph executive summary:\n\n", accent: "brand-indigo" as const },
  ];

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto p-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="mb-10 text-center"
      >
        <div className="relative mx-auto mb-6 h-20 w-20">
          <div className="absolute inset-0 rounded-3xl bg-brand-gradient-soft blur-2xl opacity-80 animate-pulse-soft" />
          <div className="relative grid h-20 w-20 place-items-center rounded-3xl bg-surface-raised border border-line-soft overflow-hidden">
            <img src="/icon.png" alt="Xirea" className="h-16 w-16 rounded-2xl" draggable={false} />
          </div>
        </div>
        <h1 className="text-3xl font-semibold text-ink-primary font-display text-balance">
          How can I help, <span className="text-gradient-brand">today</span>?
        </h1>
        <p className="mt-2 max-w-lg text-sm text-ink-tertiary text-pretty">
          A private, on-device AI assistant. Bring your own models, your own providers, your own files. Your data never leaves this machine.
        </p>
      </motion.div>

      {/* Quick action grid */}
      <div className="grid w-full max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.button
              key={card.title}
              type="button"
              onClick={() => onPick(card.prompt)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.04 * i, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              className={cn(
                "group relative flex items-start gap-3 overflow-hidden rounded-xl border border-line-soft bg-surface-raised/60 p-4 text-left",
                "hover:border-line-medium hover:bg-surface-hover transition-colors",
              )}
            >
              <div className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-xl border",
                card.accent === "brand-indigo" && "bg-brand-indigo-500/[0.10] border-brand-indigo-400/20 text-brand-indigo-300",
                card.accent === "brand-teal" && "bg-brand-teal-500/[0.10] border-brand-teal-400/20 text-brand-teal-300",
                card.accent === "brand-fuchsia" && "bg-brand-fuchsia-500/[0.10] border-brand-fuchsia-400/20 text-brand-fuchsia-300",
              )}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-primary">{card.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-tertiary">{card.prompt.replace(/\n/g, " ")}</p>
              </div>
              <Wand2 className="h-3.5 w-3.5 text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
            </motion.button>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="mt-8 flex items-center gap-3 text-2xs text-ink-faint">
        <span className="flex items-center gap-1"><kbd className="kbd">⌘</kbd><kbd className="kbd">N</kbd> New chat</span>
        <span className="flex items-center gap-1"><kbd className="kbd">⌘</kbd><kbd className="kbd">K</kbd> Search</span>
        <span className="flex items-center gap-1"><kbd className="kbd">⌘</kbd><kbd className="kbd">,</kbd> Settings</span>
      </div>
    </div>
  );
}
