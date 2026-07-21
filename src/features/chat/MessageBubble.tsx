/**
 * MessageBubble — a single chat message with full action toolbar.
 *
 * Features:
 *  - User / assistant variants with distinct styling
 *  - Markdown rendering with syntax highlighting
 *  - Streaming indicator with a "thinking" trace
 *  - Hover toolbar: copy, edit, regenerate, pin, bookmark, delete
 *  - Attachments preview strip (for user messages)
 *  - Reasoning collapsible (for assistant messages)
 */
import { memo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Copy,
  Check,
  Pencil,
  RefreshCw,
  Pin,
  Bookmark,
  Trash2,
  ChevronDown,
  Brain,
  User,
  AlertCircle,
  Square,
  type LucideIcon,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { clipboardWriteText } from "@/lib/tauri";
import type { ChatMessage } from "@/types";
import { Markdown } from "./Markdown";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { useChatStore } from "@/store/chat";

interface MessageBubbleProps {
  message: ChatMessage;
  threadId: string;
  isLast: boolean;
  canRegenerate: boolean;
  onRegenerate?: () => void;
  onStop?: () => void;
  onEdit?: (content: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  threadId,
  isLast,
  canRegenerate,
  onRegenerate,
  onStop,
  onEdit,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isStreaming = message.streaming?.state === "streaming" || message.streaming?.state === "thinking";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const togglePin = useChatStore((s) => s.toggleMessagePinned);
  const toggleBookmark = useChatStore((s) => s.toggleMessageBookmarked);
  const updateMessage = useChatStore((s) => s.updateMessage);

  const handleCopy = async () => {
    await clipboardWriteText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleSaveEdit = () => {
    updateMessage(threadId, message.id, { content: draft, updatedAt: new Date().toISOString() });
    onEdit?.(draft);
    setEditing(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn("group relative flex gap-3 px-4 py-4", isUser ? "flex-row-reverse" : "flex-row")}
    >
      {/* Avatar */}
      <div
        className={cn(
          "relative grid h-7 w-7 shrink-0 place-items-center rounded-lg overflow-hidden",
          isUser
            ? "bg-gradient-to-br from-brand-indigo-400 to-brand-indigo-500 text-white"
            : "bg-surface-raised",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <BrandGlyph />}
        {isStreaming && (
          <motion.span
            className="absolute inset-0 rounded-lg ring-2 ring-brand-indigo-400/60"
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
        )}
      </div>

      {/* Message body */}
      <div className={cn("flex min-w-0 max-w-[min(100%,_860px)] flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
        {/* Meta row */}
        <div className={cn("flex items-center gap-2 text-2xs text-ink-faint", isUser && "flex-row-reverse")}>
          <span className="font-semibold text-ink-tertiary">{isUser ? "You" : "Xirea"}</span>
          {message.modelId && <span className="hidden sm:inline text-ink-faint">· {message.modelId}</span>}
          <span>· {formatRelativeTime(message.createdAt)}</span>
          {message.pinned && <Pin className="h-2.5 w-2.5 text-brand-fuchsia-400" />}
          {message.bookmarked && <Bookmark className="h-2.5 w-2.5 text-brand-teal-400" fill="currentColor" />}
        </div>

        {/* Reasoning trace */}
        {message.reasoning && (
          <div className="w-full">
            <button
              type="button"
              onClick={() => setReasoningOpen((v) => !v)}
              className="flex items-center gap-1.5 text-2xs text-ink-muted hover:text-ink-tertiary transition-colors"
            >
              <Brain className="h-3 w-3" />
              <span>Reasoning</span>
              <ChevronDown className={cn("h-3 w-3 transition-transform", reasoningOpen && "rotate-180")} />
            </button>
            <AnimatePresence>
              {reasoningOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-1.5 overflow-hidden"
                >
                  <div className="rounded-lg border border-line-subtle bg-surface-deep/60 p-3 text-xs text-ink-tertiary italic">
                    {message.reasoning}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Content */}
        <div
          className={cn(
            "relative w-full rounded-2xl border px-4 py-3",
            isUser
              ? "bg-brand-indigo-500/[0.10] border-brand-indigo-400/20"
              : "bg-surface-raised/70 border-line-subtle",
            message.error && "border-status-danger/40 bg-status-danger/[0.04]",
          )}
        >
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(12, Math.max(2, draft.split("\n").length + 1))}
                className="w-full resize-none rounded-lg bg-surface-deep border border-line-soft p-2.5 text-sm text-ink-primary focus:outline-none focus:border-brand-indigo-400/60"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(message.content);
                    setEditing(false);
                  }}
                  className="rounded-lg px-2.5 py-1 text-xs text-ink-tertiary hover:text-ink-primary hover:bg-overlay/4"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="rounded-lg bg-gradient-to-br from-brand-indigo-500 to-brand-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
                >
                  Save
                </button>
              </div>
            </div>
          ) : isStreaming && !message.content ? (
            <ThinkingIndicator />
          ) : (
            <Markdown>{message.content || ""}</Markdown>
          )}

          {/* Error */}
          {message.error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-status-danger/40 bg-status-danger/[0.08] p-2.5 text-xs text-status-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-semibold">Generation failed</p>
                <p className="text-status-danger/80">{message.error}</p>
              </div>
            </div>
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-deep/60 px-2.5 py-1.5 text-xs"
                >
                  {a.kind === "image" && a.previewUrl ? (
                    <img src={a.previewUrl} alt={a.name} className="h-6 w-6 rounded object-cover" />
                  ) : (
                    <div className="grid h-6 w-6 place-items-center rounded bg-brand-gradient-soft text-brand-indigo-300">
                      <span className="text-2xs font-bold">{a.kind.toUpperCase()[0]}</span>
                    </div>
                  )}
                  <span className="text-ink-secondary">{a.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Streaming cursor */}
          {isStreaming && message.content && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 rounded-sm bg-brand-indigo-400 animate-blink" />
          )}
        </div>

        {/* Action toolbar */}
        {!editing && !message.error && (
          <div
            className={cn(
              "flex items-center gap-0.5 opacity-0 transition-opacity",
              isUser ? "flex-row-reverse" : "flex-row",
              "group-hover:opacity-100",
              (isLast && isStreaming) && "opacity-100",
            )}
          >
            {isStreaming ? (
              <Tooltip content="Stop generating">
                <IconButton label="Stop" size="xs" variant="ghost" onClick={onStop}>
                  <Square className="h-3 w-3 fill-current" />
                </IconButton>
              </Tooltip>
            ) : (
              <>
                <ActionIcon icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy"} onClick={handleCopy} active={copied} />
                {isUser && (
                  <ActionIcon icon={Pencil} label="Edit" onClick={() => setEditing(true)} />
                )}
                {isAssistant && canRegenerate && (
                  <ActionIcon icon={RefreshCw} label="Regenerate" onClick={onRegenerate} />
                )}
                <ActionIcon icon={Pin} label={message.pinned ? "Unpin" : "Pin"} active={message.pinned} onClick={() => togglePin(threadId, message.id)} />
                <ActionIcon
                  icon={Bookmark}
                  label={message.bookmarked ? "Remove bookmark" : "Bookmark"}
                  active={message.bookmarked}
                  onClick={() => toggleBookmark(threadId, message.id)}
                />
                <ActionIcon icon={Trash2} label="Delete" destructive onClick={() => deleteMessage(threadId, message.id)} />
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
});

function ActionIcon({
  icon: Icon,
  label,
  onClick,
  active,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        size="xs"
        variant="ghost"
        onClick={onClick}
        className={cn(
          active && "text-brand-indigo-300 bg-brand-indigo-500/[0.10]",
          destructive && "hover:text-status-danger hover:bg-status-danger/10",
        )}
      >
        <Icon className={cn(active && "fill-current")} />
      </IconButton>
    </Tooltip>
  );
}

function BrandGlyph() {
  return (
    <img
      src="/icon.png"
      alt="Xirea"
      className="h-4 w-4 rounded-[28%]"
      draggable={false}
    />
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-ink-tertiary">Thinking</span>
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-brand-indigo-400"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  );
}
