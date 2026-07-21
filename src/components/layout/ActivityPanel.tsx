/**
 * ActivityPanel — right-side dock showing context for the current view.
 *
 * For chat: shows thread info, attachments, bookmarks, tokens.
 * For models: shows selected model metadata.
 * For other routes: collapses elegantly when there's no content.
 */
import { motion } from "framer-motion";
import {
  Pin,
  Bookmark,
  Paperclip,
  Info,
  Cpu,
  HardDrive,
  X,
  Clock,
  Hash,
} from "lucide-react";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import { useUIStore } from "@/store/ui";
import { useChatStore } from "@/store/chat";
import { IconButton } from "@/components/ui/IconButton";
import { EmptyState } from "@/components/ui/EmptyState";

export function ActivityPanel() {
  const close = useUIStore((s) => s.toggleActivityPanel);
  const activeThreadId = useUIStore((s) => s.activeThreadId);
  const route = useUIStore((s) => s.route);
  const threads = useChatStore((s) => s.threads);
  const messages = useChatStore((s) => s.messages);

  const thread = threads.find((t) => t.id === activeThreadId);
  const list = activeThreadId ? messages[activeThreadId] ?? [] : [];
  const pinned = list.filter((m) => m.pinned);
  const bookmarks = list.filter((m) => m.bookmarked);
  const attachments = list.flatMap((m) => m.attachments ?? []);

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={cn(
        "relative flex h-full flex-col bg-surface-deep/70 backdrop-blur-xl border-l border-line-subtle overflow-hidden",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-line-subtle">
        <div className="flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-ink-tertiary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Context</span>
        </div>
        <IconButton label="Close panel" size="xs" onClick={close}>
          <X />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!thread && route === "chat" && (
          <EmptyState
            size="sm"
            icon={<Pin className="h-5 w-5" />}
            title="No active chat"
            description="Pick a conversation from the sidebar to see its context here."
          />
        )}

        {thread && (
          <>
            <Section icon={Info} title="Thread">
              <div className="space-y-2 text-xs">
                <Row label="Title" value={thread.title} />
                <Row label="Created" value={formatRelativeTime(thread.createdAt)} />
                <Row label="Updated" value={formatRelativeTime(thread.updatedAt)} />
                <Row label="Messages" value={String(thread.messageCount)} />
                {thread.modelId && <Row label="Model" value={thread.modelId} />}
              </div>
            </Section>

            <Section icon={Pin} title={`Pinned (${pinned.length})`} empty={pinned.length === 0 ? "No pinned messages" : undefined}>
              <div className="space-y-1.5">
                {pinned.map((m) => (
                  <div key={m.id} className="rounded-lg bg-surface-raised border border-line-subtle p-2 text-xs text-ink-secondary">
                    <p className="line-clamp-2">{m.content}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={Bookmark} title={`Bookmarks (${bookmarks.length})`} empty={bookmarks.length === 0 ? "No bookmarks yet" : undefined}>
              <div className="space-y-1.5">
                {bookmarks.map((m) => (
                  <div key={m.id} className="rounded-lg bg-surface-raised border border-line-subtle p-2 text-xs text-ink-secondary">
                    <p className="line-clamp-2">{m.content}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={Paperclip} title={`Attachments (${attachments.length})`} empty={attachments.length === 0 ? "No attachments" : undefined}>
              <div className="space-y-1.5">
                {attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-lg bg-surface-raised border border-line-subtle p-2 text-xs">
                    <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-gradient-soft text-brand-indigo-300">
                      <Paperclip className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-ink-primary">{a.name}</p>
                      <p className="text-2xs text-ink-muted">{formatBytes(a.size)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={Hash} title="Stats">
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const firstAssistant = list.find((m) => m.role === "assistant" && m.streaming?.startedAt);
                  const firstUser = list.find((m) => m.role === "user");
                  const ttft = firstAssistant && firstUser
                    ? Math.max(0, (firstAssistant.streaming!.startedAt! - new Date(firstUser.createdAt).getTime()))
                    : null;
                  return (
                    <>
                      <Stat icon={Clock} label="First token" value={ttft !== null ? `${ttft}ms` : "—"} />
                      <Stat icon={Hash} label="Tokens" value={String(list.reduce((a, m) => a + (m.streaming?.tokens ?? Math.ceil(m.content.length / 4)), 0))} />
                      <Stat icon={Cpu} label="Messages" value={String(list.length)} />
                      <Stat icon={HardDrive} label="Chars" value={formatBytes(list.reduce((a, m) => a + m.content.length, 0))} />
                    </>
                  );
                })()}
              </div>
            </Section>
          </>
        )}

        {route !== "chat" && (
          <EmptyState
            size="sm"
            icon={<Info className="h-5 w-5" />}
            title="Context panel"
            description="Open a chat to see its thread info, bookmarks, and attachments here."
          />
        )}
      </div>
    </motion.aside>
  );
}

function Section({
  icon: Icon,
  title,
  children,
  empty,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
  empty?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <Icon className="h-3 w-3 text-ink-tertiary" />
        <span className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">{title}</span>
      </div>
      {empty ? <p className="px-1 text-xs text-ink-faint">{empty}</p> : children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-tertiary">{label}</span>
      <span className="truncate font-medium text-ink-secondary">{value}</span>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-raised border border-line-subtle p-2">
      <div className="flex items-center gap-1.5 text-2xs text-ink-muted mb-1">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <p className="text-sm font-semibold text-ink-primary tabular-nums">{value}</p>
    </div>
  );
}
