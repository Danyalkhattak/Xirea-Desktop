/**
 * Downloads store — model and file downloads with real progress, pause/resume,
 * cancel, retry, queue ordering, and SHA-256 verification.
 *
 * Wires to the real Rust download backend (`download_start`, `download_pause`,
 * `download_resume`, `download_cancel`, `onDownloadProgress`,
 * `verify_download`). The store holds the canonical task state; the Rust
 * side emits progress events that we forward into the store.
 *
 * After a download completes, we automatically call `verify_download` to
 * check the file size and (if `expectedSha256` is set) the SHA-256 digest.
 * The task transitions through:
 *
 *   queued → downloading → (paused ↔ downloading)* → verifying → verified
 *                                                        ↘ corrupted
 */
import { create } from "zustand";
import type { DownloadTask, ID } from "@/types";
import { uid } from "@/lib/utils";
import {
  downloadStart,
  downloadPause,
  downloadResume,
  downloadCancel,
  onDownloadProgress,
  verifyDownload,
} from "@/lib/tauri";

interface DownloadsState {
  tasks: DownloadTask[];
  /** Max concurrent active downloads. The Rust backend supports unlimited
   *  concurrency, but for UX we limit to 3 by default so bandwidth is
   *  shared fairly. */
  maxConcurrent: number;

  enqueue: (input: Omit<DownloadTask, "id" | "createdAt" | "receivedBytes" | "state" | "queueOrder"> & { id?: string }) => string;
  start: (id: ID, sourceUrl: string, targetPath: string) => Promise<void>;
  pause: (id: ID) => Promise<void>;
  resume: (id: ID) => Promise<void>;
  cancel: (id: ID) => Promise<void>;
  retry: (id: ID) => Promise<void>;
  remove: (id: ID) => void;
  clearCompleted: () => void;
  reorder: (id: ID, direction: "up" | "down" | "top" | "bottom") => void;
  moveTo: (id: ID, newIndex: number) => void;

  progress: (id: ID, receivedBytes: number, totalBytes?: number, speedBps?: number, etaSeconds?: number) => void;
  fail: (id: ID, error: string) => void;
  complete: (id: ID) => void;
  setVerifying: (id: ID) => void;
  setVerified: (id: ID, actualSha256: string) => void;
  setCorrupted: (id: ID, error: string, actualSha256?: string) => void;
}

export const useDownloadsStore = create<DownloadsState>()((set, get) => ({
  tasks: [],
  maxConcurrent: 3,

  enqueue: (input) => {
    const id = input.id ?? uid("dl");
    const { id: _ignored, ...rest } = input;
    // Assign queue order = current max + 1, so newly-enqueued tasks go to
    // the back of the queue.
    const tasks = get().tasks;
    const maxOrder = tasks.reduce((m, t) => Math.max(m, t.queueOrder), -1);
    const task: DownloadTask = {
      id,
      createdAt: new Date().toISOString(),
      receivedBytes: 0,
      state: "queued",
      queueOrder: maxOrder + 1,
      ...rest,
    };
    set((s) => ({ tasks: [task, ...s.tasks] }));
    return id;
  },

  start: async (id, sourceUrl, targetPath) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              state: "downloading",
              startedAt: t.startedAt ?? new Date().toISOString(),
              error: undefined,
              sourceUrl,
              targetPath,
            }
          : t,
      ),
    }));

    const unlisten = await onDownloadProgress(id, (p) => {
      const state = get().tasks.find((t) => t.id === id);
      if (!state) {
        unlisten();
        return;
      }
      if (p.state === "downloading" || p.state === "paused") {
        get().progress(
          id,
          p.receivedBytes,
          p.totalBytes ?? undefined,
          p.speedBps ?? undefined,
          p.etaSeconds ?? undefined,
        );
        if (p.state === "paused") {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === id ? { ...t, state: "paused" } : t)),
          }));
        }
      } else if (p.state === "completed") {
        // Download finished — now verify.
        get().complete(id);
        unlisten();
        // Trigger verification if we have either an expected size OR an
        // expected SHA-256. If we have neither, skip verification and leave
        // the task as "completed".
        const task = get().tasks.find((t) => t.id === id);
        if (task && (task.totalBytes || task.expectedSha256)) {
          // Kick off verification asynchronously — the progress callback
          // itself can't be async (it returns void), so we spawn an
          // IIFE. Errors are caught and forwarded to the store.
          void (async () => {
            get().setVerifying(id);
            try {
              const result = await verifyDownload(
                task.targetPath,
                task.totalBytes,
                task.expectedSha256,
              );
              if (result.ok) {
                get().setVerified(id, result.actualSha256);
              } else {
                get().setCorrupted(id, result.error ?? "Verification failed", result.actualSha256);
              }
            } catch (e) {
              get().setCorrupted(id, e instanceof Error ? e.message : String(e));
            }
          })();
        }
      } else if (p.state === "failed") {
        get().fail(id, p.error ?? "Download failed");
        unlisten();
      } else if (p.state === "cancelled") {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, state: "cancelled" } : t)),
        }));
        unlisten();
      }
    });

    try {
      await downloadStart(id, sourceUrl, targetPath);
    } catch (e) {
      get().fail(id, e instanceof Error ? e.message : String(e));
      unlisten();
    }
  },

  pause: async (id) => {
    await downloadPause(id);
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id && t.state === "downloading" ? { ...t, state: "paused" } : t,
      ),
    }));
  },

  resume: async (id) => {
    await downloadResume(id);
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id && (t.state === "paused" || t.state === "failed")
          ? { ...t, state: "downloading", error: undefined }
          : t,
      ),
    }));
  },

  cancel: async (id) => {
    await downloadCancel(id);
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id && t.state !== "completed" && t.state !== "verified"
          ? { ...t, state: "cancelled" }
          : t,
      ),
    }));
  },

  retry: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    if (task.state !== "failed" && task.state !== "cancelled" && task.state !== "corrupted") return;
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, state: "queued", error: undefined, receivedBytes: 0, verificationError: undefined }
          : t,
      ),
    }));
    await get().start(id, task.sourceUrl, task.targetPath);
  },

  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  clearCompleted: () =>
    set((s) => ({
      tasks: s.tasks.filter(
        (t) => t.state !== "completed" && t.state !== "cancelled" && t.state !== "verified" && t.state !== "corrupted",
      ),
    })),

  reorder: (id, direction) =>
    set((s) => {
      const sorted = [...s.tasks].sort((a, b) => a.queueOrder - b.queueOrder);
      const idx = sorted.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      let newIdx = idx;
      if (direction === "up") newIdx = Math.max(0, idx - 1);
      else if (direction === "down") newIdx = Math.min(sorted.length - 1, idx + 1);
      else if (direction === "top") newIdx = 0;
      else if (direction === "bottom") newIdx = sorted.length - 1;
      if (newIdx === idx) return {};
      const moved = sorted.splice(idx, 1)[0];
      if (!moved) return {};
      sorted.splice(newIdx, 0, moved);
      // Reassign queueOrder 0..N-1.
      const reordered = sorted.map((t, i) => ({ ...t, queueOrder: i }));
      return { tasks: reordered };
    }),

  moveTo: (id, newIndex) =>
    set((s) => {
      const sorted = [...s.tasks].sort((a, b) => a.queueOrder - b.queueOrder);
      const idx = sorted.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const clamped = Math.max(0, Math.min(sorted.length - 1, newIndex));
      if (clamped === idx) return {};
      const moved = sorted.splice(idx, 1)[0];
      if (!moved) return {};
      sorted.splice(clamped, 0, moved);
      const reordered = sorted.map((t, i) => ({ ...t, queueOrder: i }));
      return { tasks: reordered };
    }),

  progress: (id, receivedBytes, totalBytes, speedBps, etaSeconds) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          state: "downloading" as const,
          receivedBytes,
          totalBytes: totalBytes ?? t.totalBytes,
          speedBps: speedBps ?? t.speedBps,
          etaSeconds: etaSeconds ?? t.etaSeconds,
        };
      }),
    })),

  fail: (id, error) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, state: "failed", error } : t)),
    })),

  complete: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              state: "completed",
              completedAt: new Date().toISOString(),
              receivedBytes: t.totalBytes ?? t.receivedBytes,
              speedBps: undefined,
              etaSeconds: undefined,
            }
          : t,
      ),
    })),

  setVerifying: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, state: "verifying" } : t,
      ),
    })),

  setVerified: (id, actualSha256) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, state: "verified", actualSha256, verificationError: undefined }
          : t,
      ),
    })),

  setCorrupted: (id, error, actualSha256) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, state: "corrupted", verificationError: error, actualSha256 }
          : t,
      ),
    })),
}));

/** Convenience selector: tasks grouped by lifecycle state for the queue UI. */
export function selectQueues(tasks: DownloadTask[]) {
  const sorted = [...tasks].sort((a, b) => a.queueOrder - b.queueOrder);
  return {
    active: sorted.filter((t) => t.state === "downloading" || t.state === "verifying"),
    queued: sorted.filter((t) => t.state === "queued" || t.state === "paused"),
    completed: sorted.filter((t) => t.state === "completed" || t.state === "verified"),
    failed: sorted.filter((t) => t.state === "failed" || t.state === "cancelled" || t.state === "corrupted"),
  };
}
