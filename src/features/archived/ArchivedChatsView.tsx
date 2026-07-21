/**
 * ArchivedChatsView — list of archived chat threads with restore / delete actions.
 *
 * Each archived chat can be:
 *  - Restored (moved back to the active chat list)
 *  - Permanently deleted (with confirmation)
 *  - Opened (restores + opens in the main chat window)
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  RotateCcw,
  Trash2,
  MessageSquare,
  Search,
  Inbox,
} from "lucide-react";
import { formatRelativeTime, truncate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { useChatStore } from "@/store/chat";
import { useUIStore } from "@/store/ui";
import { confirmDialog } from "@/store/dialog";

export function ArchivedChatsView() {
  const threads = useChatStore((s) => s.threads);
  const messages = useChatStore((s) => s.messages);
  const archiveThread = useChatStore((s) => s.archiveThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const setActiveThread = useUIStore((s) => s.setActiveThread);
  const setRoute = useUIStore((s) => s.setRoute);
  const pushToast = useUIStore((s) => s.pushToast);
  const [query, setQuery] = useState("");

  const archived = threads.filter((t) => t.archived);
  const filtered = archived.filter(
    (t) => t.title.toLowerCase().includes(query.toLowerCase()),
  );

  const handleRestore = (id: string, title: string) => {
    archiveThread(id, false);
    pushToast({ title: "Chat restored", description: title, variant: "success" });
  };

  const handleDelete = (id: string, title: string) => {
    void confirmDialog(
      "Permanently delete this chat?",
      `"${title}" and all its messages will be removed forever. This cannot be undone.`,
      { variant: "danger", confirmLabel: "Delete forever" },
    ).then((ok) => {
      if (!ok) return;
      deleteThread(id);
      pushToast({ title: "Chat deleted", description: title, variant: "info" });
    });
  };

  const handleOpen = (id: string) => {
    // Restore + open in chat view.
    archiveThread(id, false);
    setActiveThread(id);
    setRoute("chat");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line-subtle px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-display text-ink-primary">Archived chats</h1>
              <Badge variant="default">{archived.length}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-tertiary">
              Chats you've archived are stored here. Restore them anytime, or delete them permanently.
            </p>
          </div>
        </div>
        <div className="max-w-md">
          <Input
            iconLeft={<Search />}
            placeholder="Filter archived chats…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {archived.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title="No archived chats"
            description="When you archive a chat from the sidebar or chat window, it will appear here. Archived chats are kept on your device until you permanently delete them."
            size="lg"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title="No matches"
            description={`Nothing archived matches "${query}".`}
            size="md"
          />
        ) : (
          <div className="mx-auto max-w-3xl space-y-2">
            {filtered.map((t, i) => {
              const msgCount = messages[t.id]?.length ?? 0;
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.02 }}
                >
                  <Card hover padded={false} className="overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                      <button
                        type="button"
                        onClick={() => handleOpen(t.id)}
                        className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-surface-raised border border-line-subtle text-ink-tertiary hover:text-ink-primary transition-colors"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpen(t.id)}
                        className="flex-1 min-w-0 cursor-pointer text-left"
                      >
                        <p className="text-sm font-medium text-ink-primary truncate">
                          {truncate(t.title, 60)}
                        </p>
                        <p className="text-2xs text-ink-faint">
                          {msgCount} message{msgCount === 1 ? "" : "s"} · archived {formatRelativeTime(t.updatedAt)}
                        </p>
                      </button>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<RotateCcw />}
                          onClick={() => handleRestore(t.id, t.title)}
                          className="cursor-pointer"
                        >
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<Trash2 />}
                          onClick={() => handleDelete(t.id, t.title)}
                          className="cursor-pointer text-status-danger hover:bg-status-danger/10 hover:text-status-danger"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
