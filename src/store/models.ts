/**
 * Models store — local GGUF models + cloud models aggregated from providers.
 *
 * Note on `running`:
 *   We store `running` as a sorted `string[]` rather than a `Set<string>`.
 *   Sets are not JSON-serializable, which breaks `persist`'s hydration round-trip
 *   and causes `useSyncExternalStore` to warn about uncached snapshots when the
 *   array reference changes on every state computation. By keeping `running` as
 *   a plain array (and excluding it from persistence via `partialize`), we get
 *   stable references that play nicely with React 18/19's concurrent renderer.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { LocalModel } from "@/types";
import { uid } from "@/lib/utils";

interface ModelsState {
  local: LocalModel[];
  /** Runtime-only — IDs of currently-running models. Not persisted. */
  running: string[];

  importModel: (input: Omit<LocalModel, "id" | "installedAt">) => string;
  removeModel: (id: string) => void;
  renameModel: (id: string, name: string) => void;
  toggleFavorite: (id: string) => void;
  setRunning: (id: string, running: boolean) => void;
  isRunning: (id: string) => boolean;
  updateModel: (id: string, patch: Partial<LocalModel>) => void;
}

export const useModelsStore = create<ModelsState>()(
  persist(
    (set, get) => ({
      local: [],
      running: [],

      importModel: (input) => {
        const id = uid("mdl");
        const model: LocalModel = {
          ...input,
          id,
          installedAt: new Date().toISOString(),
        };
        set((s) => ({ local: [model, ...s.local] }));
        return id;
      },

      removeModel: (id) =>
        set((s) => ({
          local: s.local.filter((m) => m.id !== id),
          running: s.running.filter((r) => r !== id),
        })),

      renameModel: (id, name) =>
        set((s) => ({ local: s.local.map((m) => (m.id === id ? { ...m, name } : m)) })),

      toggleFavorite: (id) =>
        set((s) => ({
          local: s.local.map((m) =>
            m.id === id ? { ...m, favorite: !m.favorite } : m,
          ),
        })),

      setRunning: (id, running) =>
        set((s) => {
          const next = running
            ? s.running.includes(id)
              ? s.running
              : [...s.running, id]
            : s.running.filter((r) => r !== id);
          return {
            running: next,
            local: s.local.map((m) =>
              m.id === id
                ? { ...m, running, lastUsedAt: running ? new Date().toISOString() : m.lastUsedAt }
                : m,
            ),
          };
        }),

      isRunning: (id) => get().running.includes(id),

      updateModel: (id, patch) =>
        set((s) => ({ local: s.local.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
    }),
    {
      name: "xirea:models",
      storage: createJSONStorage(() => localStorage),
      // `running` is runtime-only — never persist it.
      partialize: (s) => ({ local: s.local }),
    },
  ),
);
