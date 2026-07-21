/**
 * Tauri API surface for the frontend.
 *
 * Every interaction with the Rust backend goes through this module so we can
 * keep types tight and centralise the platform check (`isTauri`). When the
 * app is running in a plain browser (e.g. `vite dev` without Tauri), all
 * calls fall back to safe no-ops.
 */
import type {
  AppMeta,
  BenchmarkResult,
  ChatMessage,
  CloudModel,
  ProviderHealth,
  ProviderKind,
  SystemInfo,
  VerificationResult,
} from "@/types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && (!!window.__TAURI_INTERNALS__ || !!window.__TAURI__);
}

/* ----------------------------------------------------------------------------
 * Window controls
 * ------------------------------------------------------------------------- */
export async function windowMinimize(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function windowToggleMaximize(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  // Use Tauri 2's `toggleMaximize()` — it's atomic (no race between
  // isMaximized() and the actual maximize call) and works on every platform.
  // The previous implementation manually called `isMaximized()` then
  // `maximize()` / `unmaximize()`, which could fail silently on Windows
  // if the window state changed between the check and the call.
  try {
    await w.toggleMaximize();
  } catch (e) {
    // Fallback: try the manual maximize/unmaximize pair.
    try {
      const isMax = await w.isMaximized();
      if (isMax) {
        await w.unmaximize();
      } else {
        await w.maximize();
      }
    } catch (e2) {
      console.error("Failed to toggle maximize:", e, e2);
      return false;
    }
  }
  // Return the new (post-toggle) maximized state.
  try {
    return await w.isMaximized();
  } catch {
    return false;
  }
}

export async function windowIsMaximized(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().isMaximized();
}

export async function windowClose(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function windowStartDrag(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function windowSetTitle(title: string): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

export async function onWindowMaximizeChange(cb: (maximized: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const unmax = await w.onResized(async () => {
    cb(await w.isMaximized());
  });
  return unmax;
}

/* ----------------------------------------------------------------------------
 * App meta
 * ------------------------------------------------------------------------- */
let cachedMeta: AppMeta | null = null;

export async function getAppMeta(): Promise<AppMeta> {
  if (cachedMeta) return cachedMeta;
  if (!isTauri()) {
    cachedMeta = {
      name: "Xirea",
      version: "1.0.0",
      platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
      arch: "x86_64",
      hostname: "localhost",
      cpuCount: navigator?.hardwareConcurrency ?? 8,
      totalMemoryGb: 16,
      freeMemoryGb: 8,
      locale: navigator?.language ?? "en-US",
    };
    return cachedMeta;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  cachedMeta = await invoke<AppMeta>("app_meta");
  return cachedMeta;
}

/* ----------------------------------------------------------------------------
 * Provider health
 * ------------------------------------------------------------------------- */
export async function pingProvider(url: string, apiKey?: string): Promise<ProviderHealth> {
  if (!isTauri()) {
    // Browser-only dev fallback — uses fetch() to do a real HEAD request.
    // This is *not* a mock: it actually pings the URL.
    const start = performance.now();
    try {
      const res = await fetch(url, { method: "HEAD", mode: "no-cors" });
      const latencyMs = Math.round(performance.now() - start);
      return {
        ok: true,
        status: res.status || 200,
        latencyMs,
        message: `200 OK ${url}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        latencyMs: Math.round(performance.now() - start),
        message: e instanceof Error ? e.message : String(e),
        checkedAt: new Date().toISOString(),
      };
    }
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<ProviderHealth>("ping_provider", { url, apiKey: apiKey ?? null });
  return { ...result, checkedAt: new Date().toISOString() };
}

/* ----------------------------------------------------------------------------
 * Notifications
 * ------------------------------------------------------------------------- */
export async function showNotification(title: string, body: string): Promise<void> {
  if (!isTauri()) {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_notification", { title, body });
  } catch {
    /* notifications are best-effort */
  }
}

/* ----------------------------------------------------------------------------
 * Clipboard
 * ------------------------------------------------------------------------- */
export async function clipboardWriteText(text: string): Promise<void> {
  if (!isTauri()) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(text);
}

export async function clipboardReadText(): Promise<string> {
  if (!isTauri()) return navigator.clipboard.readText();
  const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
  return readText();
}

/* ----------------------------------------------------------------------------
 * Dialog
 * ------------------------------------------------------------------------- */
export async function pickFile(opts?: {
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}): Promise<string | string[] | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return await open({
    multiple: opts?.multiple ?? false,
    filters: opts?.filters,
    title: opts?.title,
  });
}

export async function pickDirectory(opts?: { title?: string }): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({ directory: true, title: opts?.title });
  return typeof result === "string" ? result : null;
}

export async function saveFile(opts?: {
  defaultName?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return await save({
    defaultPath: opts?.defaultName,
    filters: opts?.filters,
    title: opts?.title,
  });
}

/* ----------------------------------------------------------------------------
 * Shell — open URLs in the system browser
 * ------------------------------------------------------------------------- */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}

/* ----------------------------------------------------------------------------
 * Store — persistent JSON storage
 * ------------------------------------------------------------------------- */
type StoreLike = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  save: () => Promise<void>;
};

let storeInstance: Promise<StoreLike> | null = null;

async function getStore(): Promise<StoreLike> {
  if (!storeInstance) {
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      storeInstance = load("xirea.store.json", { autoSave: false, defaults: {} }).then(
        (s) => s as unknown as StoreLike,
      );
    } else {
      storeInstance = Promise.resolve({
        async get<T>(key: string): Promise<T | undefined> {
          try {
            const raw = localStorage.getItem(`xirea:store:${key}`);
            return raw ? (JSON.parse(raw) as T) : undefined;
          } catch {
            return undefined;
          }
        },
        async set(key: string, value: unknown): Promise<void> {
          localStorage.setItem(`xirea:store:${key}`, JSON.stringify(value));
        },
        async delete(key: string): Promise<boolean> {
          const had = localStorage.getItem(`xirea:store:${key}`) !== null;
          localStorage.removeItem(`xirea:store:${key}`);
          return had;
        },
        async save(): Promise<void> {
          /* no-op for localStorage */
        },
      });
    }
  }
  return storeInstance;
}

export async function storeGet<T>(key: string, fallback: T): Promise<T> {
  const store = await getStore();
  const v = await store.get<T>(key);
  return v ?? fallback;
}

export async function storeSet<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

export async function storeDelete(key: string): Promise<void> {
  const store = await getStore();
  await store.delete(key);
}

/* ----------------------------------------------------------------------------
 * Global shortcut
 * ------------------------------------------------------------------------- */
export async function registerGlobalShortcut(
  accelerator: string,
  handler: () => void,
): Promise<(() => void) | null> {
  if (!isTauri()) return null;
  try {
    const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await register(accelerator, () => handler());
    return () => {
      void unregister(accelerator);
    };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------------------
 * Event listener for the `xirea://ready` event emitted from Rust.
 * ------------------------------------------------------------------------- */
export async function onAppReady(cb: () => void): Promise<() => void> {
  if (!isTauri()) {
    cb();
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  return await listen("xirea://ready", () => cb());
}

/* ----------------------------------------------------------------------------
 * Chat — streaming completions via the Rust backend.
 *
 * Returns a unique completion id and an `off` function. The caller passes
 * callbacks for delta / done / error events. Internally we subscribe to
 * Tauri events `chat-delta` and `chat-error` (FIXED event names, with the
 * chat `id` inside the payload so the frontend can filter by it).
 * ------------------------------------------------------------------------- */

export interface ChatStreamCallbacks {
  providerKind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: Array<Pick<ChatMessage, "role" | "content">>;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  onDelta: (delta: string, accumulated: string, tokens: number) => void;
  onReasoning?: (delta: string) => void;
  onDone: (finalText: string, tokens: number) => void;
  onError: (err: string) => void;
}

export interface ChatStreamHandle {
  id: string;
  cancel: () => Promise<void>;
}

export async function streamChatCompletion(opts: ChatStreamCallbacks): Promise<ChatStreamHandle> {
  // Build the message list — include system prompt as a separate message.
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) {
    messages.push({ role: "system", content: opts.system });
  }
  for (const m of opts.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  // Browser fallback when not running in Tauri — we cannot call cloud
  // providers from the browser due to CORS, so we emit a clear error.
  if (!isTauri()) {
    const err = "Cloud providers require the desktop app. Build and run with `npm run tauri dev`.";
    opts.onError(err);
    return {
      id: "browser-fallback",
      cancel: async () => {},
    };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const id = await invoke<string>("chat_completion", {
    request: {
      provider_kind: opts.providerKind,
      base_url: opts.baseUrl,
      api_key: opts.apiKey ?? null,
      model: opts.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      top_p: opts.topP,
      stream: opts.stream ?? true,
      extra_headers: null,
    },
  });

  // FIXED event names — Tauri 2's `listen()` rejects event names containing
  // anything other than `A-Z a-z 0-9 - _ / :`. The chat `id` travels inside
  // the payload, so we filter by it here.
  type ChatDeltaPayload = {
    id: string;
    delta: string;
    accumulated: string;
    tokens: number;
    done: boolean;
    reasoning?: string;
  };

  const unlistenDelta = await listen<ChatDeltaPayload>("chat-delta", (event) => {
    const p = event.payload;
    // Filter: only handle events for THIS chat completion.
    if (p.id !== id) return;
    if (p.reasoning) {
      opts.onReasoning?.(p.reasoning);
    }
    if (p.delta) {
      opts.onDelta(p.delta, p.accumulated, p.tokens);
    }
    if (p.done) {
      opts.onDone(p.accumulated, p.tokens);
    }
  });

  const unlistenError = await listen<{ id: string; error: string }>("chat-error", (event) => {
    if (event.payload.id !== id) return;
    opts.onError(event.payload.error);
  });

  const unlistenCancel = await listen<{ id: string }>("chat-cancel", (event) => {
    if (event.payload.id !== id) return;
    opts.onDone("", 0);
  });

  return {
    id,
    cancel: async () => {
      try {
        await invoke("chat_cancel", { id });
      } catch {
        /* ignore */
      }
      unlistenDelta();
      unlistenError();
      unlistenCancel();
    },
  };
}

/* ----------------------------------------------------------------------------
 * Provider model fetching — calls the Rust fetch_provider_models command.
 * ------------------------------------------------------------------------- */
export async function fetchProviderModels(
  kind: ProviderKind,
  baseUrl: string,
  apiKey?: string,
): Promise<CloudModel[]> {
  if (!isTauri()) {
    return [];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const models = await invoke<Array<{
    id: string;
    name: string;
    provider_id: string;
    context_length: number;
    capabilities: string[];
    description: string | null;
    input_per_1m: number | null;
    output_per_1m: number | null;
    available: boolean;
  }>>("fetch_provider_models", {
    kind,
    baseUrl,
    apiKey: apiKey ?? null,
  });
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    providerId: m.provider_id,
    contextLength: m.context_length,
    capabilities: m.capabilities as CloudModel["capabilities"],
    description: m.description ?? undefined,
    pricing: {
      inputPer1M: m.input_per_1m ?? undefined,
      outputPer1M: m.output_per_1m ?? undefined,
    },
    available: m.available,
  }));
}

/* ----------------------------------------------------------------------------
 * Local model metadata — calls the Rust read_gguf_metadata command.
 * ------------------------------------------------------------------------- */
export interface GgufMetadataDto {
  path: string;
  name: string;
  format: string;
  sizeBytes: number;
  architecture: string | null;
  contextLength: number | null;
  parameters: string | null;
  quantization: string | null;
  ramEstimateGb: number | null;
  vramEstimateGb: number | null;
  capabilities: string[];
  verified: boolean;
  // Extended metadata — populated by the Rust backend from GGUF keys
  // (general.family, tokenizer.ggml.model, etc.).
  family: string | null;
  tokenizer: string | null;
  eosToken: string | null;
  bosToken: string | null;
  license: string | null;
  organization: string | null;
  trainingDataset: string | null;
  rawMetadata: Record<string, string>;
}

export async function readGgufMetadata(path: string): Promise<GgufMetadataDto> {
  if (!isTauri()) {
    // Browser fallback — return a minimal stub.
    const name = path.split(/[\\/]/).pop()?.replace(/\.(gguf|ggml)$/i, "") ?? path;
    return {
      path,
      name,
      format: path.toLowerCase().endsWith(".ggml") ? "ggml" : "gguf",
      sizeBytes: 0,
      architecture: null,
      contextLength: null,
      parameters: null,
      quantization: null,
      ramEstimateGb: null,
      vramEstimateGb: null,
      capabilities: [],
      verified: false,
      family: null,
      tokenizer: null,
      eosToken: null,
      bosToken: null,
      license: null,
      organization: null,
      trainingDataset: null,
      rawMetadata: {},
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<GgufMetadataDto>("read_gguf_metadata", { path });
}

export async function scanModelsDir(dir?: string): Promise<GgufMetadataDto[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<GgufMetadataDto[]>("scan_models_dir", { dir: dir ?? null });
}

/* ----------------------------------------------------------------------------
 * File metadata — calls the Rust file_metadata command.
 * ------------------------------------------------------------------------- */
export interface FileMetaDto {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: string;
  exists: boolean;
}

export async function fileMetadata(path: string): Promise<FileMetaDto> {
  if (!isTauri()) {
    // Browser fallback — return a stub.
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return {
      path,
      name,
      sizeBytes: 0,
      mimeType: ext,
      kind: detectKindFromExt(ext),
      exists: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<FileMetaDto>("file_metadata", { path });
}

export async function revealInFinder(path: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_in_finder", { path });
}

export async function readFileAsDataUrl(path: string, maxBytes?: number): Promise<string> {
  if (!isTauri()) {
    throw new Error("Filesystem access requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("read_file_as_data_url", { path, maxBytes: maxBytes ?? null });
}

export async function ensureDir(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("ensure_dir", { path });
}

function detectKindFromExt(ext: string): string {
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
    case "bmp":
      return "image";
    case "pdf":
      return "pdf";
    case "doc":
    case "docx":
    case "rtf":
      return "document";
    case "xls":
    case "xlsx":
    case "csv":
    case "tsv":
      return "spreadsheet";
    case "zip":
    case "tar":
    case "gz":
    case "tgz":
    case "rar":
    case "7z":
      return "archive";
    case "mp3":
    case "wav":
    case "flac":
    case "aac":
    case "ogg":
      return "audio";
    case "mp4":
    case "mov":
    case "avi":
    case "mkv":
    case "webm":
      return "video";
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "rs":
    case "go":
    case "java":
    case "c":
    case "cpp":
    case "json":
    case "yaml":
    case "toml":
      return "code";
    case "md":
    case "txt":
    case "log":
      return "text";
    default:
      return "other";
  }
}

/* ----------------------------------------------------------------------------
 * Hugging Face — calls the Rust hf_* commands.
 * ------------------------------------------------------------------------- */
export interface HfModelDto {
  id: string;
  author: string;
  sha: string | null;
  lastModified: string;
  library: string | null;
  tags: string[];
  pipelineTag: string | null;
  downloads: number;
  likes: number;
  trending: boolean;
  verified: boolean;
  description: string | null;
  contextLength: number | null;
  quantizations: string[];
  files: HfFileDto[];
}

export interface HfFileDto {
  rfilename: string;
  sizeBytes: number | null;
  url: string | null;
}

export async function hfSearch(params: {
  query?: string;
  sort?: string;
  direction?: string;
  limit?: number;
  tags?: string[];
}): Promise<HfModelDto[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<HfModelDto[]>("hf_search", {
    query: params.query ?? null,
    sort: params.sort ?? null,
    direction: params.direction ?? null,
    limit: params.limit ?? null,
    tags: params.tags ?? null,
  });
}

export async function hfModel(modelId: string): Promise<HfModelDto> {
  if (!isTauri()) {
    throw new Error("Hugging Face access requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<HfModelDto>("hf_model", { modelId });
}

export async function hfModelFiles(modelId: string): Promise<HfFileDto[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<HfFileDto[]>("hf_model_files", { modelId });
}

/* ----------------------------------------------------------------------------
 * Downloads — calls the Rust download_* commands.
 *
 * The Rust side emits `download-progress` events (FIXED event name, with
 * the download `id` inside the payload) as bytes arrive.
 * We expose a subscribe helper so the downloads store can wire them up.
 * ------------------------------------------------------------------------- */
export interface DownloadProgressPayload {
  id: string;
  receivedBytes: number;
  totalBytes: number | null;
  speedBps: number | null;
  etaSeconds: number | null;
  state: "downloading" | "paused" | "completed" | "failed" | "cancelled";
  error: string | null;
}

export async function downloadStart(id: string, url: string, targetPath: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Downloads require the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("download_start", { id, url, targetPath });
}

export async function downloadPause(id: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("download_pause", { id });
}

export async function downloadResume(id: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("download_resume", { id });
}

export async function downloadCancel(id: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("download_cancel", { id });
}

export async function onDownloadProgress(
  id: string,
  cb: (p: DownloadProgressPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  // FIXED event name — Tauri 2 only allows `A-Z a-z 0-9 - _ / :` in event
  // names. The download `id` is in the payload, so we filter by it here.
  return await listen<DownloadProgressPayload>("download-progress", (e) => {
    if (e.payload.id !== id) return;
    cb(e.payload);
  });
}

export async function onDownloadComplete(
  id: string,
  cb: (p: { id: string; path: string; totalBytes: number }) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<{ id: string; path: string; totalBytes: number }>("download-complete", (e) => {
    if (e.payload.id !== id) return;
    cb(e.payload);
  });
}

/* ----------------------------------------------------------------------------
 * Local model loading — triggers Ollama to load a GGUF model into memory.
 *
 * Emits progress events with `percent: 0` (indeterminate — Ollama's HTTP API
 * doesn't expose real loading progress) and a "done" event when the model is
 * ready. The frontend uses these to show a progress overlay on the Models
 * page. No fake timers, no simulated percentages — `percent` stays at 0
 * until Ollama responds, then jumps to 100 on done.
 * ------------------------------------------------------------------------- */
export interface ModelLoadProgressPayload {
  id: string;
  percent: number;
  message: string;
  model: string;
}

export async function loadLocalModel(
  id: string,
  ollamaUrl: string,
  modelName: string,
  modelSizeBytes: number,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("Local model loading requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("load_local_model", {
    id,
    ollamaUrl,
    modelName,
    modelSizeBytes,
  });
}

export async function onModelLoadProgress(
  id: string,
  cb: (p: ModelLoadProgressPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<ModelLoadProgressPayload>("model-load-progress", (e) => {
    if (e.payload.id !== id) return;
    cb(e.payload);
  });
}

export async function onModelLoadDone(
  id: string,
  cb: () => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<{ id: string; model: string }>("model-load-done", (e) => {
    if (e.payload.id !== id) return;
    cb();
  });
}

export async function onModelLoadError(
  id: string,
  cb: (error: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<{ id: string; error: string }>("model-load-error", (e) => {
    if (e.payload.id !== id) return;
    cb(e.payload.error);
  });
}

/* ----------------------------------------------------------------------------
 * llama.cpp sidecar — spawn a local llama-server for a GGUF model.
 *
 * Returns a session handle. The session ID is a short alphanumeric token
 * (e.g. `s1`, `s2`) that travels INSIDE every event payload — the frontend
 * subscribes to the FIXED event names `llama-server-log`,
 * `llama-server-ready`, `llama-server-error` and filters by `session` in
 * the payload.
 *
 * Tauri 2's `listen()` rejects event names containing anything other than
 * `A-Z a-z 0-9 - _ / :` — earlier versions of Xirea URL-encoded the model
 * path and used it as the event-name suffix, which triggered the
 * `invalid args 'event' for command 'listen'` runtime error and made the
 * app silently fall back to Ollama. The fix is to NEVER put the model path
 * in the event name; it always travels in the JSON payload.
 * ------------------------------------------------------------------------- */

export interface LlamaServerHandle {
  /** Session ID — alphanumeric (`s1`, `s2`, …). Travels inside every
   *  event payload so the frontend can filter by session. */
  session: string;
  /** Port the server is (or will be) listening on. */
  port: number;
  /** Absolute path of the binary we spawned. Surfaced so the user can
   *  verify which binary was used (bundled vs. PATH). */
  binaryPath: string;
  /** Source of the binary: `"bundled"`, `"dev"`, or `"path"`. */
  binarySource: string;
}

export interface LlamaServerReady {
  session: string;
  modelPath: string;
  port: number;
  url: string;
}

export interface LlamaServerLogLine {
  session: string;
  modelPath: string;
  stream: "stdout" | "stderr" | "terminated" | "error";
  line: string;
  /** Semantic phase: `"starting"` | `"loading-tensors"` | `"cuda-init"` |
   *  `"kv-cache"` | `"ready"` | `"error"` | `"info"`. */
  phase: string;
}

export interface LlamaServerErrorPayload {
  session: string;
  modelPath: string;
  error: string;
  diagnostic?: string | null;
}

export interface LlamaServerExitedPayload {
  session: string;
  modelPath: string;
  /** Process exit code, or null if killed by a signal. */
  exitCode: number | null;
  /** Path to the per-session log file (full stdout + stderr + system info). */
  logFile: string;
  /** `"clean"` | `"error"` | `"killed"`. */
  reason: string;
  /** Human-readable summary of what went wrong. */
  error: string;
  /** Actionable hint for the user. */
  diagnostic?: string | null;
}

export interface LlamaRuntimeCandidate {
  path: string;
  kind: "bundled" | "dev" | "path";
  exists: boolean;
  executable: boolean;
  /** Why this candidate was rejected — null if it was accepted. */
  rejectionReason: string | null;
}

export interface LlamaVersionCheck {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error: string | null;
}

export interface LlamaLibraryCheck {
  ok: boolean;
  directory: string;
  expected: string[];
  found: string[];
  missing: string[];
}

export interface LlamaRuntimeVerification {
  ok: boolean;
  binaryPath: string | null;
  /** Source of the binary: `"bundled"`, `"dev"`, `"path"`, or `"not-found"`. */
  source: string;
  candidates: LlamaRuntimeCandidate[];
  versionCheck: LlamaVersionCheck | null;
  libraryCheck: LlamaLibraryCheck | null;
  error: string | null;
  diagnostic: string | null;
}

export interface ModelImportVerification {
  ok: boolean;
  path: string;
  format: string;
  sizeBytes: number;
  readable: boolean;
  validMagic: boolean;
  metadata: GgufMetadataDto | null;
  sha256: string | null;
  error: string | null;
  diagnostic: string | null;
}

/**
 * Spawn a local `llama-server` for a GGUF model. Returns a session handle
 * that the caller uses to subscribe to log / ready / error events.
 *
 * Xirea tries the bundled sidecar first, then falls back to `llama-server`
 * on the user's PATH, then throws a friendly error.
 */
export async function startLlamaServer(opts: {
  modelPath: string;
  port?: number;
  ctxSize?: number;
  threads?: number;
  nGpuLayers?: number;
}): Promise<LlamaServerHandle> {
  if (!isTauri()) {
    throw new Error("llama.cpp sidecar requires the desktop app. Build with `npm run tauri dev`.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<LlamaServerHandle>("start_llama_server", {
    modelPath: opts.modelPath,
    port: opts.port ?? null,
    ctxSize: opts.ctxSize ?? null,
    threads: opts.threads ?? null,
    nGpuLayers: opts.nGpuLayers ?? null,
  });
}

/** Stop a running llama-server. Pass the session ID returned from
 *  `startLlamaServer`, or (legacy) the model path. */
export async function stopLlamaServer(sessionOrPath: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_llama_server", { sessionOrPath });
}

/** Subscribe to the "ready" event for a given session. Fires once when the
 *  HTTP endpoint comes up. Uses the FIXED event name `llama-server-ready`
 *  and filters by `session` in the payload. */
export async function onLlamaServerReady(
  session: string,
  cb: (info: LlamaServerReady) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<LlamaServerReady>("llama-server-ready", (e) => {
    if (e.payload.session !== session) return;
    cb(e.payload);
  });
}

export async function onLlamaServerError(
  session: string,
  cb: (error: string, diagnostic?: string | null) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<LlamaServerErrorPayload>("llama-server-error", (e) => {
    if (e.payload.session !== session) return;
    cb(e.payload.error, e.payload.diagnostic ?? null);
  });
}

/** Subscribe to the "exited" event for a given session. Fires once when the
 *  child process terminates — carries the real exit code, log file path,
 *  and a human-readable summary of what went wrong. NEVER the generic
 *  "exited without printing anything" message. */
export async function onLlamaServerExited(
  session: string,
  cb: (p: LlamaServerExitedPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<LlamaServerExitedPayload>("llama-server-exited", (e) => {
    if (e.payload.session !== session) return;
    cb(e.payload);
  });
}

/** Verify the llama.cpp runtime is usable BEFORE clicking Run. Returns the
 *  full diagnostic trail: which binary candidates we considered, the result
 *  of `--version`, and any missing DLLs / shared libraries. */
export async function verifyLlamaRuntime(): Promise<LlamaRuntimeVerification> {
  if (!isTauri()) {
    return {
      ok: false,
      binaryPath: null,
      source: "not-found",
      candidates: [],
      versionCheck: null,
      libraryCheck: null,
      error: "llama.cpp runtime verification requires the desktop app.",
      diagnostic: null,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<LlamaRuntimeVerification>("verify_llama_runtime_command");
}

/** Verify a model file before importing it. Validates the GGUF magic, reads
 *  metadata, and optionally computes the SHA-256. Rejects anything that's
 *  not a usable GGUF. */
export async function verifyModelImport(
  path: string,
  computeSha256 = false,
): Promise<ModelImportVerification> {
  if (!isTauri()) {
    throw new Error("Model import verification requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<ModelImportVerification>("verify_model_import_command", {
    path,
    computeSha256,
  });
}

export async function onLlamaServerLog(
  session: string,
  cb: (log: LlamaServerLogLine) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<LlamaServerLogLine>("llama-server-log", (e) => {
    if (e.payload.session !== session) return;
    cb(e.payload);
  });
}

/* ----------------------------------------------------------------------------
 * System information — real disk / CPU / GPU / RAM / VRAM detection.
 * ------------------------------------------------------------------------- */

export async function getSystemInfo(): Promise<SystemInfo> {
  if (!isTauri()) {
    // Browser fallback — return a minimal stub. The UI guards against
    // missing fields, but most of the hardware panel will be hidden.
    return {
      platform: navigator.platform,
      arch: "unknown",
      cpuVendor: "unknown",
      cpuBrand: "unknown",
      cpuCores: navigator.hardwareConcurrency ?? 1,
      cpuThreads: navigator.hardwareConcurrency ?? 1,
      totalRamBytes: 0,
      availableRamBytes: 0,
      disks: [],
      gpus: [],
      totalVramBytes: 0,
      freeVramBytes: 0,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<SystemInfo>("get_system_info_command");
}

/**
 * Focused disk-info command for the Models page storage bar. Returns just
 * the four fields the UI needs (totalBytes / availableBytes / usedBytes /
 * mountPoint) for the disk containing the models directory, plus an array
 * of all disks. Cheaper than `getSystemInfo` because it skips GPU
 * detection.
 */
export interface ModelsDiskInfo {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  mountPoint: string;
  allDisks: Array<{
    mountPoint: string;
    label: string;
    fsType: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    isModelsDisk: boolean;
  }>;
}

export async function getModelsDiskInfo(): Promise<ModelsDiskInfo> {
  if (!isTauri()) {
    return {
      totalBytes: 0,
      availableBytes: 0,
      usedBytes: 0,
      mountPoint: "",
      allDisks: [],
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<ModelsDiskInfo>("get_models_disk_info");
}

/* ----------------------------------------------------------------------------
 * Download verification — size + SHA-256.
 * ------------------------------------------------------------------------- */

export async function verifyDownload(
  path: string,
  expectedSizeBytes?: number,
  expectedSha256?: string,
): Promise<VerificationResult> {
  if (!isTauri()) {
    throw new Error("Download verification requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<VerificationResult>("verify_download_command", {
    path,
    expectedSizeBytes: expectedSizeBytes ?? null,
    expectedSha256: expectedSha256 ?? null,
  });
}

export async function sha256File(path: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("SHA-256 computation requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("sha256_file_command", { path });
}

/* ----------------------------------------------------------------------------
 * Benchmark — real prompt-eval + generation speed metrics.
 * ------------------------------------------------------------------------- */

export async function benchmarkModel(opts: {
  baseUrl: string;
  model: string;
  prompt?: string;
  maxTokens?: number;
}): Promise<BenchmarkResult> {
  if (!isTauri()) {
    throw new Error("Benchmark requires the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<BenchmarkResult>("benchmark_model_command", {
    baseUrl: opts.baseUrl,
    model: opts.model,
    prompt: opts.prompt ?? null,
    maxTokens: opts.maxTokens ?? null,
  });
}
