/**
 * Model usage statistics store — tracks real per-model usage metrics.
 *
 * Every metric here is incremented by a real event:
 *   - `loadCount` — incremented every time the user clicks Run on a model.
 *   - `chatCount` — incremented every time a chat message gets a reply from
 *     this model.
 *   - `lastUsedAt` — updated on every load and every chat.
 *   - `avgTokensPerSec` — rolling average of generation speed, measured
 *     from real chat completions (tokens generated / wall-clock time).
 *   - `totalRuntimeSec` — total wall-clock time this model has been
 *     running (incremented every minute while the model is loaded).
 *
 * No mock values — every number comes from a real event.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ModelUsageStats } from "@/types";

interface UsageStatsState {
  stats: Record<string, ModelUsageStats>;
  recordLoad: (modelId: string) => void;
  recordChat: (modelId: string, tokensPerSec: number) => void;
  recordRuntime: (modelId: string, seconds: number) => void;
  getFor: (modelId: string) => ModelUsageStats | undefined;
  resetFor: (modelId: string) => void;
  clearAll: () => void;
}

const empty = (modelId: string): ModelUsageStats => ({
  modelId,
  loadCount: 0,
  chatCount: 0,
  totalRuntimeSec: 0,
});

export const useUsageStatsStore = create<UsageStatsState>()(
  persist(
    (set, get) => ({
      stats: {},

      recordLoad: (modelId) =>
        set((s) => {
          const prev = s.stats[modelId] ?? empty(modelId);
          return {
            stats: {
              ...s.stats,
              [modelId]: {
                ...prev,
                loadCount: prev.loadCount + 1,
                lastUsedAt: new Date().toISOString(),
              },
            },
          };
        }),

      recordChat: (modelId, tokensPerSec) =>
        set((s) => {
          const prev = s.stats[modelId] ?? empty(modelId);
          // Rolling average — weight new sample at 30%, old average at 70%.
          const newAvg =
            prev.avgTokensPerSec === undefined
              ? tokensPerSec
              : prev.avgTokensPerSec * 0.7 + tokensPerSec * 0.3;
          return {
            stats: {
              ...s.stats,
              [modelId]: {
                ...prev,
                chatCount: prev.chatCount + 1,
                avgTokensPerSec: newAvg,
                lastUsedAt: new Date().toISOString(),
              },
            },
          };
        }),

      recordRuntime: (modelId, seconds) =>
        set((s) => {
          const prev = s.stats[modelId] ?? empty(modelId);
          return {
            stats: {
              ...s.stats,
              [modelId]: {
                ...prev,
                totalRuntimeSec: prev.totalRuntimeSec + seconds,
              },
            },
          };
        }),

      getFor: (modelId) => get().stats[modelId],

      resetFor: (modelId) =>
        set((s) => {
          const next = { ...s.stats };
          delete next[modelId];
          return { stats: next };
        }),

      clearAll: () => set({ stats: {} }),
    }),
    {
      name: "xirea:usage-stats",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
