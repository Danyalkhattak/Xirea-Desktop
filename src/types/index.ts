/**
 * Xirea — Shared domain types.
 *
 * The frontend owns its own model of the world. Anything that crosses the
 * Rust boundary is mirrored in `lib/tauri.ts`.
 */

export type ID = string;
export type ISODate = string; // ISO 8601 timestamp

/* ----------------------------------------------------------------------------
 * Theme
 * ------------------------------------------------------------------------- */
export type ThemeMode = "dark" | "light" | "system";
export type AccentColor = "indigo" | "teal" | "fuchsia" | "rose" | "amber" | "emerald";

export interface Density {
  id: "compact" | "comfortable" | "spacious";
  label: string;
  scale: number;
}

/* ----------------------------------------------------------------------------
 * App meta — mirrored from Rust `AppMeta`
 * ------------------------------------------------------------------------- */
export interface AppMeta {
  name: string;
  version: string;
  platform: string;
  arch: string;
  hostname: string;
  cpuCount: number;
  totalMemoryGb: number;
  freeMemoryGb: number;
  locale: string;
}

/* ----------------------------------------------------------------------------
 * Chat
 * ------------------------------------------------------------------------- */
export type Role = "user" | "assistant" | "system" | "tool";

export interface Attachment {
  id: ID;
  kind: "image" | "file" | "audio" | "video";
  name: string;
  mimeType: string;
  size: number;
  /** Path on disk for local files, or a data: URL for pasted images. */
  source: string;
  /** For images — a small preview URL. */
  previewUrl?: string;
}

export interface ChatMessage {
  id: ID;
  role: Role;
  content: string;
  /** Reasoning/thinking trace, shown in a collapsible above the content. */
  reasoning?: string;
  createdAt: ISODate;
  updatedAt?: ISODate;
  modelId?: string;
  attachments?: Attachment[];
  pinned?: boolean;
  bookmarked?: boolean;
  /** Streaming state — present while a message is being generated. */
  streaming?: {
    state: "thinking" | "streaming" | "done" | "cancelled" | "error";
    /** Tokens seen so far, used by the token counter. */
    tokens?: number;
    /** Time the first token arrived, for measuring TTFT. */
    startedAt?: number;
  };
  error?: string;
}

export interface ChatThread {
  id: ID;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  pinned: boolean;
  folderId?: ID;
  modelId?: string;
  providerId?: string;
  messageCount: number;
  lastPreview?: string;
  archived?: boolean;
}

export interface ChatFolder {
  id: ID;
  name: string;
  color: string;
  collapsed?: boolean;
}

/* ----------------------------------------------------------------------------
 * Models
 * ------------------------------------------------------------------------- */
export type ModelRuntime = "local" | "cloud";
export type ModelFormat = "gguf" | "ggml" | "api";
export type ModelCapability = "vision" | "reasoning" | "embedding" | "tools" | "audio";

export interface LocalModel {
  id: ID;
  name: string;
  format: ModelFormat;
  sizeBytes: number;
  path: string;
  architecture?: string;
  contextLength?: number;
  parameters?: string; // e.g. "7B", "13B"
  quantization?: string; // e.g. "Q4_K_M"
  ramEstimateGb?: number;
  vramEstimateGb?: number;
  capabilities: ModelCapability[];
  favorite?: boolean;
  lastUsedAt?: ISODate;
  installedAt: ISODate;
  running?: boolean;
  verified?: boolean;
  source?: "huggingface" | "manual-import" | "drag-drop";
  /** Extended GGUF metadata — populated when the user opens the model
   *  details dialog (lazy-fetched via `readGgufMetadata`). */
  family?: string;
  tokenizer?: string;
  eosToken?: string;
  bosToken?: string;
  license?: string;
  organization?: string;
  trainingDataset?: string;
  /** SHA-256 digest of the model file (lazy-computed). */
  sha256?: string;
  /** When the model was last verified after a download. */
  verifiedAt?: ISODate;
}

/** Usage statistics tracked per-model. Persisted in localStorage so the
 *  numbers survive app restarts. Numbers are real — every load / chat
 *  increments the corresponding counter via the models store. */
export interface ModelUsageStats {
  modelId: ID;
  loadCount: number;
  chatCount: number;
  lastUsedAt?: ISODate;
  /** Average response speed (tokens/sec), measured from real chats.
   *  Updated incrementally as new chats complete. */
  avgTokensPerSec?: number;
  /** Total wall-clock time this model has been running, in seconds. */
  totalRuntimeSec: number;
}

/** Real system hardware info — mirrors Rust `SystemInfo`. Every field
 *  comes from a real query (sysinfo, nvidia-smi, system_profiler, etc.),
 *  never hardcoded. */
export interface SystemInfo {
  platform: string;
  arch: string;
  cpuVendor: string;
  cpuBrand: string;
  cpuCores: number;
  cpuThreads: number;
  totalRamBytes: number;
  availableRamBytes: number;
  disks: DiskInfo[];
  gpus: GpuInfo[];
  totalVramBytes: number;
  freeVramBytes: number;
}

export interface DiskInfo {
  mountPoint: string;
  label: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  isModelsDisk: boolean;
}

export interface GpuInfo {
  vendor: string;
  name: string;
  vramBytes: number;
  freeVramBytes: number;
  cudaAvailable: boolean;
  cudaVersion?: string;
  metalAvailable: boolean;
  vulkanAvailable: boolean;
  rocmAvailable: boolean;
  directmlAvailable: boolean;
}

/** Result of a real benchmark run against an OpenAI-compatible model
 *  server. Every metric is measured from an actual HTTP request — no
 *  mock values. */
export interface BenchmarkResult {
  promptTokens: number;
  generationTokens: number;
  ttftMs: number;
  totalMs: number;
  promptEvalPerSec: number;
  generationPerSec: number;
  peakRamBytes: number;
  peakVramBytes: number;
  ok: boolean;
  error?: string;
}

/** Result of verifying a downloaded file against expected size + SHA-256. */
export interface VerificationResult {
  path: string;
  actualSizeBytes: number;
  expectedSizeBytes?: number;
  sizeMatches: boolean;
  actualSha256: string;
  expectedSha256?: string;
  sha256Matches: boolean;
  ok: boolean;
  error?: string;
}

/** User-configurable runtime settings for a model. Persisted per-model
 *  so the user's preferences survive restarts. All values are passed
 *  through to the llama-server spawn command (or Ollama / LM Studio API). */
export interface RuntimeSettings {
  contextSize: number;
  gpuLayers: number; // -1 = all
  cpuThreads: number;
  batchSize: number;
  flashAttention: boolean;
  mlock: boolean;
  mmap: boolean;
  numa: boolean;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
}

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  contextSize: 8192,
  gpuLayers: 0,
  cpuThreads: 0, // 0 = auto-detect
  batchSize: 512,
  flashAttention: true,
  mlock: false,
  mmap: true,
  numa: false,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
};

/** Which local runtime Xirea should use to run GGUF models. */
export type RuntimeKind = "llama-cpp" | "ollama" | "lm-studio" | "openai-compatible";

export interface CompatibilityCheck {
  status: "compatible" | "may-fit" | "insufficient-ram" | "insufficient-vram";
  estimatedRamGb: number;
  estimatedVramGb: number;
  availableRamGb: number;
  availableVramGb: number;
  message: string;
}

export interface CloudModel {
  id: ID;
  name: string;
  providerId: ID;
  contextLength: number;
  capabilities: ModelCapability[];
  description?: string;
  pricing?: {
    inputPer1M?: number;
    outputPer1M?: number;
  };
  favorite?: boolean;
  available: boolean;
}

/* ----------------------------------------------------------------------------
 * Providers
 * ------------------------------------------------------------------------- */
export type ProviderKind =
  | "openai"
  | "openrouter"
  | "anthropic"
  | "gemini"
  | "groq"
  | "mistral"
  | "azure-openai"
  | "ollama"
  | "lm-studio"
  | "openai-compatible"
  | "custom";

export interface Provider {
  id: ID;
  kind: ProviderKind;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  /** Models fetched from the provider's /models endpoint. */
  models: CloudModel[];
  /** Health-check result, refreshed on demand. */
  health?: ProviderHealth;
  latencyMs?: number;
  /** Whether the user has explicitly marked the provider as favorite. */
  favorite?: boolean;
}

export interface ProviderHealth {
  ok: boolean;
  status: number;
  latencyMs: number;
  message: string;
  checkedAt: ISODate;
}

/* ----------------------------------------------------------------------------
 * Files
 * ------------------------------------------------------------------------- */
export interface FileEntry {
  id: ID;
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "pdf" | "document" | "spreadsheet" | "archive" | "audio" | "video" | "code" | "text" | "other";
  pinned?: boolean;
  addedAt: ISODate;
  lastOpenedAt?: ISODate;
}

/* ----------------------------------------------------------------------------
 * Downloads
 * ------------------------------------------------------------------------- */
export type DownloadState = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled" | "verifying" | "verified" | "corrupted";

export interface DownloadTask {
  id: ID;
  name: string;
  sourceUrl: string;
  targetPath: string;
  totalBytes?: number;
  receivedBytes: number;
  state: DownloadState;
  speedBps?: number;
  etaSeconds?: number;
  error?: string;
  createdAt: ISODate;
  startedAt?: ISODate;
  completedAt?: ISODate;
  kind: "model" | "file" | "attachment";
  /** Expected SHA-256, if known (e.g. from HuggingFace's LFS metadata).
   *  When present, the download manager will verify the file against this
   *  digest after the bytes finish transferring. */
  expectedSha256?: string;
  /** Actual SHA-256 computed after download. */
  actualSha256?: string;
  /** Verification result — populated after the verify step completes. */
  verificationError?: string;
  /** Order in the download queue (0 = top). Lower numbers run first. */
  queueOrder: number;
}

/* ----------------------------------------------------------------------------
 * Prompts
 * ------------------------------------------------------------------------- */
export interface PromptTemplate {
  id: ID;
  title: string;
  body: string;
  category: string;
  description?: string;
  variables: PromptVariable[];
  favorite?: boolean;
  uses?: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Origin — built-in, custom, or imported from the community library. */
  origin: "builtin" | "custom" | "community";
  author?: string;
}

export interface PromptVariable {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}

/* ----------------------------------------------------------------------------
 * Hugging Face
 * ------------------------------------------------------------------------- */
export interface HFModel {
  id: string; // e.g. "meta-llama/Llama-3.1-8B-Instruct"
  author: string;
  sha?: string;
  lastModified: ISODate;
  library?: string;
  tags: string[];
  pipelineTag?: string;
  downloads: number;
  likes: number;
  trending?: boolean;
  verified?: boolean;
  description?: string;
  contextLength?: number;
  quantizations?: string[];
  files?: HFModelFile[];
}

export interface HFModelFile {
  rfilename: string;
  sizeBytes?: number;
  url?: string;
}

/* ----------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------- */
export interface AppSettings {
  theme: ThemeMode;
  accent: AccentColor;
  density: Density["id"];
  language: string;
  animations: boolean;
  reduceMotion: boolean;
  sendOnEnter: boolean;
  showTokenCount: boolean;
  defaultModelId?: string;
  defaultProviderId?: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  streaming: boolean;
  telemetry: boolean;
  autoUpdate: boolean;
  minimizeToTray: boolean;
  globalShortcut: string;
  fontSize: number;
  messageSpacing: "compact" | "comfortable" | "spacious";
  /** User profile — editable from the sidebar user profile and Settings → About. */
  displayName: string;
  bio: string;
  /** Optional profile picture — stored as a data: URL (from a file the user
   *  picks) so it persists in localStorage without touching the filesystem. */
  profilePicture?: string;
}

/* ----------------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------------- */
export type RouteId =
  | "chat"
  | "models"
  | "providers"
  | "huggingface"
  | "files"
  | "downloads"
  | "prompts"
  | "settings"
  | "about"
  | "archived";
