/**
 * Runtime settings store — per-model advanced runtime configuration.
 *
 * Each model can have its own:
 *   - context size
 *   - GPU layers
 *   - CPU threads
 *   - batch size
 *   - flash attention
 *   - mlock / mmap / NUMA
 *   - temperature / top-p / top-k / repeat penalty
 *
 * These settings are persisted in localStorage and passed to the llama-server
 * spawn command (or Ollama / LM Studio API) when the user clicks Run.
 *
 * Separately, this store also tracks the user's preferred runtime kind
 * (llama.cpp / Ollama / LM Studio / OpenAI-compatible). The UI uses this to
 * decide which runtime to try FIRST when the user clicks Run, instead of
 * always trying llama.cpp first.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RuntimeSettings, RuntimeKind } from "@/types";
import { DEFAULT_RUNTIME_SETTINGS } from "@/types";

interface RuntimeSettingsState {
  /** Per-model overrides. Falls back to `DEFAULT_RUNTIME_SETTINGS` if absent. */
  byModel: Record<string, RuntimeSettings>;
  /** User's preferred runtime kind. Defaults to `llama-cpp`. */
  preferredRuntime: RuntimeKind;
  /** Whether to show the advanced settings dialog before each Run. */
  promptBeforeRun: boolean;

  getForModel: (modelId: string) => RuntimeSettings;
  setForModel: (modelId: string, settings: Partial<RuntimeSettings>) => void;
  resetForModel: (modelId: string) => void;
  setPreferredRuntime: (kind: RuntimeKind) => void;
  setPromptBeforeRun: (v: boolean) => void;
}

export const useRuntimeSettingsStore = create<RuntimeSettingsState>()(
  persist(
    (set, get) => ({
      byModel: {},
      preferredRuntime: "llama-cpp",
      promptBeforeRun: false,

      getForModel: (modelId) => ({
        ...DEFAULT_RUNTIME_SETTINGS,
        ...get().byModel[modelId],
      }),

      setForModel: (modelId, patch) =>
        set((s) => ({
          byModel: {
            ...s.byModel,
            [modelId]: {
              ...DEFAULT_RUNTIME_SETTINGS,
              ...s.byModel[modelId],
              ...patch,
            },
          },
        })),

      resetForModel: (modelId) =>
        set((s) => {
          const next = { ...s.byModel };
          delete next[modelId];
          return { byModel: next };
        }),

      setPreferredRuntime: (kind) => set({ preferredRuntime: kind }),
      setPromptBeforeRun: (v) => set({ promptBeforeRun: v }),
    }),
    {
      name: "xirea:runtime-settings",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
