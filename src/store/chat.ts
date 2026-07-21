/**
 * Chat store — threads, folders, messages.
 *
 * Persisted via the local store. For a real backend, swap the persistence
 * adapter; the public API stays stable.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChatFolder, ChatMessage, ChatThread, ID } from "@/types";
import { uid } from "@/lib/utils";

interface ChatState {
  threads: ChatThread[];
  folders: ChatFolder[];
  messages: Record<ID, ChatMessage[]>;

  /* Thread ops */
  createThread: (input?: Partial<ChatThread>) => ID;
  renameThread: (id: ID, title: string) => void;
  deleteThread: (id: ID) => void;
  togglePinThread: (id: ID) => void;
  archiveThread: (id: ID, archived: boolean) => void;
  moveThreadToFolder: (id: ID, folderId: ID | undefined) => void;

  /* Folder ops */
  createFolder: (name: string, color?: string) => ID;
  renameFolder: (id: ID, name: string) => void;
  deleteFolder: (id: ID) => void;
  toggleFolderCollapsed: (id: ID) => void;

  /* Message ops */
  appendMessage: (threadId: ID, message: ChatMessage) => void;
  updateMessage: (threadId: ID, messageId: ID, patch: Partial<ChatMessage>) => void;
  deleteMessage: (threadId: ID, messageId: ID) => void;
  toggleMessagePinned: (threadId: ID, messageId: ID) => void;
  toggleMessageBookmarked: (threadId: ID, messageId: ID) => void;
  clearMessages: (threadId: ID) => void;
}

const FOLDER_COLORS = ["#818CF8", "#2DD4BF", "#E879F9", "#FBBF24", "#34D399", "#FB7185"];

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: [],
      folders: [],
      messages: {},

      createThread: (input) => {
        const id = input?.id ?? uid("th");
        const now = new Date().toISOString();
        const thread: ChatThread = {
          id,
          title: input?.title ?? "New chat",
          createdAt: now,
          updatedAt: now,
          pinned: false,
          messageCount: 0,
          ...input,
        };
        set((s) => ({ threads: [thread, ...s.threads], messages: { ...s.messages, [id]: [] } }));
        return id;
      },

      renameThread: (id, title) =>
        set((s) => ({
          threads: s.threads.map((t) => (t.id === id ? { ...t, title, updatedAt: new Date().toISOString() } : t)),
        })),

      deleteThread: (id) =>
        set((s) => {
          const messages = { ...s.messages };
          delete messages[id];
          return {
            threads: s.threads.filter((t) => t.id !== id),
            messages,
          };
        }),

      togglePinThread: (id) =>
        set((s) => ({
          threads: s.threads.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
        })),

      archiveThread: (id, archived) =>
        set((s) => ({
          threads: s.threads.map((t) => (t.id === id ? { ...t, archived } : t)),
        })),

      moveThreadToFolder: (id, folderId) =>
        set((s) => ({
          threads: s.threads.map((t) => (t.id === id ? { ...t, folderId } : t)),
        })),

      createFolder: (name, color) => {
        const id = uid("fld");
        const folder: ChatFolder = {
          id,
          name,
          color: color ?? FOLDER_COLORS[get().folders.length % FOLDER_COLORS.length]!,
          collapsed: false,
        };
        set((s) => ({ folders: [...s.folders, folder] }));
        return id;
      },

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          threads: s.threads.map((t) => (t.folderId === id ? { ...t, folderId: undefined } : t)),
        })),

      toggleFolderCollapsed: (id) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)),
        })),

      appendMessage: (threadId, message) =>
        set((s) => {
          const existing = s.messages[threadId] ?? [];
          const messages = { ...s.messages, [threadId]: [...existing, message] };
          const threads = s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  updatedAt: new Date().toISOString(),
                  messageCount: existing.length + 1,
                  lastPreview:
                    message.role === "user"
                      ? message.content.slice(0, 120)
                      : t.lastPreview,
                  title:
                    t.title === "New chat" && message.role === "user"
                      ? message.content.slice(0, 48)
                      : t.title,
                }
              : t,
          );
          return { messages, threads };
        }),

      updateMessage: (threadId, messageId, patch) =>
        set((s) => {
          const list = s.messages[threadId] ?? [];
          return {
            messages: {
              ...s.messages,
              [threadId]: list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
            },
          };
        }),

      deleteMessage: (threadId, messageId) =>
        set((s) => {
          const list = s.messages[threadId] ?? [];
          return {
            messages: { ...s.messages, [threadId]: list.filter((m) => m.id !== messageId) },
          };
        }),

      toggleMessagePinned: (threadId, messageId) =>
        set((s) => {
          const list = s.messages[threadId] ?? [];
          return {
            messages: {
              ...s.messages,
              [threadId]: list.map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m)),
            },
          };
        }),

      toggleMessageBookmarked: (threadId, messageId) =>
        set((s) => {
          const list = s.messages[threadId] ?? [];
          return {
            messages: {
              ...s.messages,
              [threadId]: list.map((m) => (m.id === messageId ? { ...m, bookmarked: !m.bookmarked } : m)),
            },
          };
        }),

      clearMessages: (threadId) =>
        set((s) => ({
          messages: { ...s.messages, [threadId]: [] },
          threads: s.threads.map((t) =>
            t.id === threadId ? { ...t, messageCount: 0, lastPreview: undefined } : t,
          ),
        })),
    }),
    {
      name: "xirea:chat",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
