/**
 * Files store — the user's local file library.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { FileEntry } from "@/types";
import { uid } from "@/lib/utils";

interface FilesState {
  files: FileEntry[];
  add: (input: Omit<FileEntry, "id" | "addedAt">) => string;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  markOpened: (id: string) => void;
  rename: (id: string, name: string) => void;
}

export const useFilesStore = create<FilesState>()(
  persist(
    (set) => ({
      files: [],
      add: (input) => {
        const id = uid("file");
        const entry: FileEntry = { id, addedAt: new Date().toISOString(), ...input };
        set((s) => ({ files: [entry, ...s.files] }));
        return id;
      },
      remove: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
      togglePin: (id) =>
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, pinned: !f.pinned } : f)) })),
      markOpened: (id) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, lastOpenedAt: new Date().toISOString() } : f)),
        })),
      rename: (id, name) =>
        set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, name } : f)) })),
    }),
    {
      name: "xirea:files",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
