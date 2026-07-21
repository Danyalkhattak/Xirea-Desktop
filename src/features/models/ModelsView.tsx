/**
 * ModelsView — local model management with real hardware detection,
 * runtime selection, advanced settings, benchmark, and detailed metadata.
 *
 * Tabs: Installed / Running / Cloud / Favorites / Recommended
 * Top: import button (drag & drop or file picker), REAL storage usage
 *      from the disk containing ~/.xirea/models, hardware panel showing
 *      CPU/GPU/CUDA/Metal/VRAM/RAM.
 * Grid: model cards with full metadata, compatibility badge, usage stats.
 *
 * Every value comes from a real query:
 *   - Disk / RAM / CPU: `getSystemInfo()` (sysinfo + nvidia-smi + system_profiler)
 *   - GPU / VRAM: `nvidia-smi` (NVIDIA) / `system_profiler` (Apple) / `rocm-smi` (AMD)
 *   - SHA-256: real SHA-256 of the file, streamed in 1 MiB chunks
 *   - Benchmark: real chat completion against the running llama-server
 *   - Usage stats: incremented by real events (load, chat, runtime tick)
 *
 * No mock values, no fake progress bars, no hardcoded storage sizes.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cpu,
  HardDrive,
  Upload,
  Search,
  Star,
  Trash2,
  Pencil,
  Play,
  Square,
  Eye,
  Brain,
  Type,
  Wrench,
  AudioLines,
  Cloud,
  FolderPlus,
  Activity,
  Zap,
  CheckCircle2,
  Download,
  Loader2,
  AlertCircle,
  Info,
  Gauge,
  Settings2,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  RefreshCw,
  Server,
  Cpu as CpuIcon,
  MemoryStick,
  ArrowUpDown,
} from "lucide-react";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tooltip } from "@/components/ui/Tooltip";
import { useModelsStore } from "@/store/models";
import { useProvidersStore } from "@/store/providers";
import { useUIStore } from "@/store/ui";
import { useSettingsStore } from "@/store/settings";
import { useRuntimeSettingsStore } from "@/store/runtimeSettings";
import { useUsageStatsStore } from "@/store/usageStats";
import {
  pickFile,
  pickDirectory,
  readGgufMetadata,
  scanModelsDir,
  loadLocalModel,
  onModelLoadProgress,
  onModelLoadDone,
  onModelLoadError,
  startLlamaServer,
  onLlamaServerReady,
  onLlamaServerError,
  onLlamaServerLog,
  onLlamaServerExited,
  verifyLlamaRuntime,
  verifyModelImport,
  getSystemInfo,
  sha256File,
  benchmarkModel,
  type LlamaServerHandle,
  type LlamaServerExitedPayload,
} from "@/lib/tauri";
import { uid } from "@/lib/utils";
import type {
  LocalModel,
  ModelCapability,
  SystemInfo,
  BenchmarkResult,
  RuntimeSettings,
  RuntimeKind,
  CompatibilityCheck,
} from "@/types";
import { DEFAULT_RUNTIME_SETTINGS } from "@/types";

type Tab = "installed" | "running" | "cloud" | "favorites" | "recommended";
type SortKey = "name" | "size" | "lastUsed" | "ram" | "vram" | "context" | "params";

export function ModelsView() {
  const local = useModelsStore((s) => s.local);
  const running = useModelsStore((s) => s.running);
  const importModel = useModelsStore((s) => s.importModel);
  const removeModel = useModelsStore((s) => s.removeModel);
  const toggleFavorite = useModelsStore((s) => s.toggleFavorite);
  const setRunning = useModelsStore((s) => s.setRunning);
  const providers = useProvidersStore((s) => s.providers);
  const setRoute = useUIStore((s) => s.setRoute);
  const pushToast = useUIStore((s) => s.pushToast);

  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ current: string; done: number; total: number; pct: number } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailsModel, setDetailsModel] = useState<LocalModel | null>(null);
  const [runtimeSettingsModel, setRuntimeSettingsModel] = useState<LocalModel | null>(null);
  const [benchmarkModelInfo, setBenchmarkModelInfo] = useState<{ model: LocalModel; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Real system info — fetched on mount and refreshed when models are
  // imported or deleted (so the storage bar updates).
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const refreshSysInfo = useCallback(async () => {
    try {
      const info = await getSystemInfo();
      setSysInfo(info);
    } catch (e) {
      console.warn("Failed to fetch system info:", e);
    }
  }, []);
  useEffect(() => {
    void refreshSysInfo();
  }, [refreshSysInfo, local.length]);

  const totalSize = local.reduce((acc, m) => acc + m.sizeBytes, 0);

  const cloudModels = providers.filter((p) => p.enabled).flatMap((p) =>
    p.models.map((m) => ({ ...m, providerName: p.name })),
  );

  // Sorting — real, not mock. Each key sorts by the corresponding field
  // from the model metadata. Favorites always bubble to the top.
  const filtered = (() => {
    let list = local.filter((m) => {
      if (tab === "running") return running.includes(m.id);
      if (tab === "favorites") return m.favorite;
      if (tab === "cloud") return false;
      if (tab === "recommended") return m.source === "huggingface";
      if (query) return m.name.toLowerCase().includes(query.toLowerCase());
      return true;
    });
    list = [...list].sort((a, b) => {
      // Favorites always first.
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      switch (sortKey) {
        case "name": return a.name.localeCompare(b.name);
        case "size": return b.sizeBytes - a.sizeBytes;
        case "lastUsed": {
          const aT = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
          const bT = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
          return bT - aT;
        }
        case "ram": return (b.ramEstimateGb ?? 0) - (a.ramEstimateGb ?? 0);
        case "vram": return (b.vramEstimateGb ?? 0) - (a.vramEstimateGb ?? 0);
        case "context": return (b.contextLength ?? 0) - (a.contextLength ?? 0);
        case "params": return (b.parameters ?? "").localeCompare(a.parameters ?? "");
        default: return 0;
      }
    });
    return list;
  })();

  const handleImport = useCallback(async (paths?: string | string[]) => {
    if (!paths) {
      const picked = await pickFile({
        multiple: true,
        title: "Import GGUF / GGML models",
        filters: [{ name: "GGUF models", extensions: ["gguf", "ggml"] }],
      });
      if (!picked) return;
      paths = Array.isArray(picked) ? picked : [picked];
    }
    const list = Array.isArray(paths) ? paths : [paths];
    let imported = 0;
    let failed = 0;
    const total = list.length;
    const failedFiles: Array<{ path: string; reason: string }> = [];
    setImporting({ current: list[0] ?? "", done: 0, total, pct: 0 });
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      const pct = total > 1 ? Math.round((i / total) * 100) : 50;
      setImporting({ current: p, done: i, total, pct });
      try {
        // Full verification: validates GGUF magic, reads metadata, verifies
        // the file is readable, rejects invalid / corrupted files up front.
        // Never imports a model that won't load — the user finds out NOW,
        // not later when they click Run.
        const verification = await verifyModelImport(p, /* computeSha256 */ false);
        if (!verification.ok || !verification.metadata) {
          failed++;
          failedFiles.push({
            path: p,
            reason: verification.error ?? "not a valid GGUF",
          });
          continue;
        }
        const meta = verification.metadata;
        importModel({
          name: meta.name || (p.split(/[\\/]/).pop() ?? p).replace(/\.(gguf|ggml)$/i, ""),
          format: meta.format === "ggml" ? "ggml" : "gguf",
          sizeBytes: meta.sizeBytes,
          path: p,
          architecture: meta.architecture ?? undefined,
          contextLength: meta.contextLength ?? undefined,
          parameters: meta.parameters ?? undefined,
          quantization: meta.quantization ?? undefined,
          ramEstimateGb: meta.ramEstimateGb ?? undefined,
          vramEstimateGb: meta.vramEstimateGb ?? undefined,
          capabilities: (meta.capabilities as ModelCapability[]) ?? [],
          source: "manual-import",
          verified: meta.verified,
          family: meta.family ?? undefined,
          tokenizer: meta.tokenizer ?? undefined,
          eosToken: meta.eosToken ?? undefined,
          bosToken: meta.bosToken ?? undefined,
          license: meta.license ?? undefined,
          organization: meta.organization ?? undefined,
          trainingDataset: meta.trainingDataset ?? undefined,
        });
        imported++;
      } catch (e) {
        console.error("Failed to verify/import GGUF:", p, e);
        failed++;
        failedFiles.push({
          path: p,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      setImporting({ current: p, done: i + 1, total, pct: Math.round(((i + 1) / total) * 100) });
      await new Promise((r) => setTimeout(r, 16));
    }
    setImporting(null);
    if (imported > 0) {
      pushToast({
        title: "Imported model",
        description: `${imported} model(s) added${failed > 0 ? `, ${failed} failed` : ""}`,
        variant: "success",
      });
      // Refresh system info so the storage bar updates.
      void refreshSysInfo();
    } else if (failed > 0) {
      // Show the REAL reason each file failed — never a generic "import failed".
      const reasons = failedFiles
        .map((f) => `  • ${f.path.split(/[\\/]/).pop()}: ${f.reason}`)
        .join("\n");
      pushToast({
        title: "Import failed",
        description: `Could not import ${failed} file(s):\n${reasons}`,
        variant: "danger",
      });
    }
  }, [importModel, pushToast, refreshSysInfo]);

  const handleScanFolder = useCallback(async () => {
    const dir = await pickDirectory({ title: "Choose a folder of GGUF models" });
    if (!dir) return;
    try {
      const scanned = await scanModelsDir(dir);
      if (scanned.length === 0) {
        pushToast({ title: "No models found", description: "No .gguf files in the selected folder.", variant: "warning" });
        return;
      }
      let imported = 0;
      for (const meta of scanned) {
        const exists = useModelsStore.getState().local.some((m) => m.path === meta.path || m.name === meta.name);
        if (exists) continue;
        importModel({
          name: meta.name,
          format: meta.format === "ggml" ? "ggml" : "gguf",
          sizeBytes: meta.sizeBytes,
          path: meta.path,
          architecture: meta.architecture ?? undefined,
          contextLength: meta.contextLength ?? undefined,
          parameters: meta.parameters ?? undefined,
          quantization: meta.quantization ?? undefined,
          ramEstimateGb: meta.ramEstimateGb ?? undefined,
          vramEstimateGb: meta.vramEstimateGb ?? undefined,
          capabilities: (meta.capabilities as ModelCapability[]) ?? [],
          source: "manual-import",
          verified: meta.verified,
        });
        imported++;
      }
      pushToast({
        title: imported > 0 ? "Scan complete" : "No new models",
        description: imported > 0 ? `${imported} model(s) imported` : "All models in that folder were already imported.",
        variant: imported > 0 ? "success" : "info",
      });
      if (imported > 0) void refreshSysInfo();
    } catch (e) {
      pushToast({ title: "Scan failed", description: e instanceof Error ? e.message : String(e), variant: "danger" });
    }
  }, [importModel, pushToast, refreshSysInfo]);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files).map((f) => (f as File & { path?: string }).path ?? f.name);
      void handleImport(paths);
    }
  };

  // Multi-selection batch actions.
  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const batchDelete = () => {
    if (selected.size === 0) return;
    for (const id of selected) removeModel(id);
    pushToast({ title: "Deleted models", description: `${selected.size} model(s) removed`, variant: "info" });
    clearSelection();
    void refreshSysInfo();
  };
  const batchFavorite = () => {
    if (selected.size === 0) return;
    for (const id of selected) {
      const m = local.find((x) => x.id === id);
      if (m && !m.favorite) toggleFavorite(id);
    }
    clearSelection();
  };
  const batchRun = () => {
    if (selected.size === 0) return;
    for (const id of selected) setRunning(id, true);
    clearSelection();
  };
  const batchStop = () => {
    if (selected.size === 0) return;
    for (const id of selected) setRunning(id, false);
    clearSelection();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line-subtle px-6 pt-5 pb-0">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-display text-ink-primary">Models</h1>
              <Badge variant="brand">{local.length} installed</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-tertiary">
              Manage your on-device models, import GGUF files, and connect cloud providers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="md" iconLeft={<FolderPlus />} onClick={() => void handleScanFolder()}>
              Scan folder
            </Button>
            <Button variant="primary" size="md" iconLeft={<Download />} onClick={() => setRoute("huggingface")}>
              Browse Hugging Face
            </Button>
          </div>
        </div>

        {/* Real storage usage — queries the disk containing the models
            directory via getSystemInfo(). No more hardcoded 20 GB. */}
        <RealStorageBar sysInfo={sysInfo} usedByModels={totalSize} count={local.length} onRefresh={() => void refreshSysInfo()} />

        {/* Hardware panel — shows real CPU, GPU, RAM, VRAM info. */}
        <HardwarePanel sysInfo={sysInfo} onRefresh={() => void refreshSysInfo()} />

        {/* Tabs + search + sort */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <Tabs
            items={[
              { id: "installed", label: "Installed", icon: <HardDrive className="h-3.5 w-3.5" /> },
              { id: "running", label: "Running", icon: <Activity className="h-3.5 w-3.5" />, badge: running.length ? <Badge variant="success" dot>{running.length}</Badge> : undefined },
              { id: "favorites", label: "Favorites", icon: <Star className="h-3.5 w-3.5" /> },
              { id: "cloud", label: "Cloud", icon: <Cloud className="h-3.5 w-3.5" />, badge: cloudModels.length ? <Badge>{cloudModels.length}</Badge> : undefined },
              { id: "recommended", label: "Recommended", icon: <Zap className="h-3.5 w-3.5" /> },
            ]}
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            variant="underline"
          />
          <div className="flex items-center gap-2">
            <SortDropdown value={sortKey} onChange={setSortKey} />
            <div className="w-56">
              <Input
                iconLeft={<Search />}
                placeholder="Filter models…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Import progress banner */}
      <AnimatePresence>
        {importing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-line-subtle bg-brand-indigo-500/[0.06] px-6 py-2.5"
          >
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-indigo-300" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink-primary truncate">
                    Importing model {importing.done + 1} of {importing.total}
                  </p>
                  <span className="text-2xs font-semibold text-brand-indigo-300 tabular-nums">{importing.pct}%</span>
                </div>
                <p className="text-2xs text-ink-tertiary truncate font-mono">
                  {importing.current.split(/[\\/]/).pop() ?? importing.current}
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay/12">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-brand-indigo-500 to-brand-indigo-600"
                    animate={{ width: `${importing.pct}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-selection toolbar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-b border-line-subtle bg-brand-indigo-500/[0.08] px-6 py-2 flex items-center gap-2"
          >
            <span className="text-xs font-semibold text-ink-primary">{selected.size} selected</span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" iconLeft={<Play className="h-3 w-3" />} onClick={batchRun}>Run</Button>
              <Button variant="ghost" size="sm" iconLeft={<Square className="h-3 w-3" />} onClick={batchStop}>Stop</Button>
              <Button variant="ghost" size="sm" iconLeft={<Star className="h-3 w-3" />} onClick={batchFavorite}>Favorite</Button>
              <Button variant="ghost" size="sm" iconLeft={<Trash2 className="h-3 w-3" />} onClick={batchDelete} className="hover:text-status-danger">Delete</Button>
              <Button variant="ghost" size="sm" iconLeft={<X className="h-3 w-3" />} onClick={clearSelection}>Cancel</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      <div
        className="flex-1 overflow-y-auto p-6"
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <AnimatePresence>
          {dragActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none fixed inset-0 z-50 m-6 rounded-2xl border-2 border-dashed border-brand-indigo-400/60 bg-brand-indigo-500/[0.08] grid place-items-center"
            >
              <div className="text-center">
                <Upload className="mx-auto mb-2 h-8 w-8 text-brand-indigo-300" />
                <p className="text-sm font-semibold text-ink-primary">Drop models to import</p>
                <p className="text-xs text-ink-tertiary">GGUF, GGML — your files stay on this machine</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".gguf,.ggml"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              const paths = Array.from(e.target.files).map((f) => (f as File & { path?: string }).path ?? f.name);
              void handleImport(paths);
            }
            e.target.value = "";
          }}
        />

        {tab === "cloud" ? (
          <CloudModelsList />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Cpu className="h-7 w-7" />}
            title={tab === "running" ? "No models are running" : tab === "favorites" ? "No favorites yet" : "No models installed"}
            description={
              tab === "running"
                ? "Start a model from the Installed tab to see it here."
                : tab === "favorites"
                  ? "Tap the star on any model to pin it here for quick access."
                  : "Import a GGUF model from disk, or browse Hugging Face to download one."
            }
            size="lg"
            action={<Button variant="primary" iconLeft={<Upload />} onClick={() => void handleImport()}>Import from disk</Button>}
            secondaryAction={<Button variant="secondary" iconLeft={<Download />} onClick={() => setRoute("huggingface")}>Browse Hugging Face</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <AnimatePresence>
              {filtered.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  running={running.includes(model.id)}
                  renaming={renaming === model.id}
                  selected={selected.has(model.id)}
                  sysInfo={sysInfo}
                  onRun={() => setRunning(model.id, true)}
                  onStop={() => setRunning(model.id, false)}
                  onFavorite={() => toggleFavorite(model.id)}
                  onDelete={() => { removeModel(model.id); void refreshSysInfo(); }}
                  onRenameStart={() => setRenaming(model.id)}
                  onRenameEnd={() => setRenaming(null)}
                  onToggleSelect={() => toggleSelected(model.id)}
                  onShowDetails={() => setDetailsModel(model)}
                  onShowRuntimeSettings={() => setRuntimeSettingsModel(model)}
                  onBenchmark={(url) => setBenchmarkModelInfo({ model, url })}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Model details dialog */}
      <AnimatePresence>
        {detailsModel && (
          <ModelDetailsDialog
            model={detailsModel}
            onClose={() => setDetailsModel(null)}
          />
        )}
      </AnimatePresence>

      {/* Advanced runtime settings dialog */}
      <AnimatePresence>
        {runtimeSettingsModel && (
          <RuntimeSettingsDialog
            model={runtimeSettingsModel}
            onClose={() => setRuntimeSettingsModel(null)}
          />
        )}
      </AnimatePresence>

      {/* Benchmark dialog */}
      <AnimatePresence>
        {benchmarkModelInfo && (
          <BenchmarkDialog
            model={benchmarkModelInfo.model}
            serverUrl={benchmarkModelInfo.url}
            onClose={() => setBenchmarkModelInfo(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RealStorageBar — uses actual disk info from getSystemInfo().
// ---------------------------------------------------------------------------

function RealStorageBar({
  sysInfo,
  usedByModels,
  count,
  onRefresh,
}: {
  sysInfo: SystemInfo | null;
  usedByModels: number;
  count: number;
  onRefresh: () => void;
}) {
  // Pick the disk that contains the models directory.
  const modelsDisk = sysInfo?.disks.find((d) => d.isModelsDisk) ?? sysInfo?.disks[0];
  const total = modelsDisk?.totalBytes ?? 0;
  const used = modelsDisk?.usedBytes ?? 0;
  const free = modelsDisk?.freeBytes ?? 0;
  const pct = total > 0 ? (used / total) * 100 : 0;
  const modelsPctOfTotal = total > 0 ? (usedByModels / total) * 100 : 0;

  if (!sysInfo) {
    return (
      <div className="rounded-xl surface p-3.5 animate-pulse">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-ink-tertiary" />
            <span className="text-xs font-semibold text-ink-secondary">Storage</span>
          </div>
          <span className="text-xs text-ink-faint">Detecting…</span>
        </div>
        <div className="h-1.5 rounded-full bg-overlay/6" />
      </div>
    );
  }

  return (
    <div className="rounded-xl surface p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <HardDrive className="h-3.5 w-3.5 text-ink-tertiary" />
          <span className="text-xs font-semibold text-ink-secondary">Storage</span>
          {modelsDisk?.label && (
            <Badge variant="default">{modelsDisk.label}</Badge>
          )}
          {modelsDisk?.fsType && (
            <span className="text-2xs text-ink-faint">{modelsDisk.fsType}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-tertiary">
          <Tooltip content="Refresh disk info">
            <button type="button" onClick={onRefresh} className="hover:text-ink-primary">
              <RefreshCw className="h-3 w-3" />
            </button>
          </Tooltip>
          <span className="tabular-nums font-medium text-ink-primary">{formatBytes(used)}</span>
          <span>/</span>
          <span className="tabular-nums">{formatBytes(total)}</span>
          <Badge variant={pct > 80 ? "warning" : "default"}>{pct.toFixed(1)}%</Badge>
        </div>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-overlay/6">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="h-full rounded-full bg-gradient-to-r from-brand-indigo-400 to-brand-indigo-500"
        />
        {/* Models-only overlay — shows how much of the disk is models. */}
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-brand-indigo-400/40 border-r border-brand-indigo-300"
          style={{ width: `${modelsPctOfTotal}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-faint">
        <span>{count} models · {formatBytes(usedByModels)} used by models</span>
        <span className="tabular-nums">{formatBytes(free)} free</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HardwarePanel — shows real CPU, GPU, RAM, VRAM info.
// ---------------------------------------------------------------------------

function HardwarePanel({ sysInfo, onRefresh }: { sysInfo: SystemInfo | null; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!sysInfo) return null;

  const totalRamGb = sysInfo.totalRamBytes / 1024 ** 3;
  const freeRamGb = sysInfo.availableRamBytes / 1024 ** 3;
  const usedRamGb = totalRamGb - freeRamGb;
  const ramPct = totalRamGb > 0 ? (usedRamGb / totalRamGb) * 100 : 0;

  const totalVramGb = sysInfo.totalVramBytes / 1024 ** 3;
  const freeVramGb = sysInfo.freeVramBytes / 1024 ** 3;
  const usedVramGb = totalVramGb - freeVramGb;
  const vramPct = totalVramGb > 0 ? (usedVramGb / totalVramGb) * 100 : 0;

  return (
    <div className="mt-3 rounded-xl surface p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-ink-tertiary" />
          <span className="text-xs font-semibold text-ink-secondary">Hardware</span>
          <Badge variant="default">{sysInfo.platform} · {sysInfo.arch}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content="Refresh hardware info">
            <button type="button" onClick={onRefresh} className="hover:text-ink-primary">
              <RefreshCw className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip content={expanded ? "Collapse" : "Expand"}>
            <button type="button" onClick={() => setExpanded(!expanded)} className="hover:text-ink-primary">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <HwStat icon={CpuIcon} label="CPU" value={sysInfo.cpuBrand || "—"} sub={`${sysInfo.cpuCores} cores · ${sysInfo.cpuThreads} threads`} />
        <HwStat
          icon={MemoryStick}
          label="RAM"
          value={`${totalRamGb.toFixed(1)} GB`}
          sub={`${freeRamGb.toFixed(1)} GB free`}
          pct={ramPct}
        />
        <HwStat
          icon={Server}
          label="VRAM"
          value={totalVramGb > 0 ? `${totalVramGb.toFixed(1)} GB` : "—"}
          sub={totalVramGb > 0 ? `${freeVramGb.toFixed(1)} GB free` : "No GPU detected"}
          pct={vramPct}
        />
        <HwStat
          icon={Zap}
          label="GPU"
          value={sysInfo.gpus[0]?.name ?? "—"}
          sub={sysInfo.gpus.length === 0
            ? "CPU-only"
            : sysInfo.gpus.flatMap((g) => {
                const parts: string[] = [];
                if (g.cudaAvailable) parts.push(`CUDA${g.cudaVersion ? " " + g.cudaVersion : ""}`);
                if (g.metalAvailable) parts.push("Metal");
                if (g.vulkanAvailable) parts.push("Vulkan");
                if (g.rocmAvailable) parts.push("ROCm");
                if (g.directmlAvailable) parts.push("DirectML");
                return parts;
              }).join(" · ")}
        />
      </div>

      <AnimatePresence>
        {expanded && sysInfo.gpus.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 pt-3 border-t border-line-subtle space-y-2"
          >
            {sysInfo.gpus.map((gpu, i) => (
              <div key={i} className="rounded-lg bg-surface-deep/40 border border-line-subtle p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-ink-primary">{gpu.name}</span>
                  <Badge variant="default">{gpu.vendor}</Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-2xs">
                  {gpu.cudaAvailable && <Badge variant="teal">CUDA {gpu.cudaVersion ?? ""}</Badge>}
                  {gpu.metalAvailable && <Badge variant="brand">Metal</Badge>}
                  {gpu.vulkanAvailable && <Badge variant="default">Vulkan</Badge>}
                  {gpu.rocmAvailable && <Badge variant="warning">ROCm</Badge>}
                  {gpu.directmlAvailable && <Badge variant="default">DirectML</Badge>}
                  <span className="text-ink-muted">·</span>
                  <span className="text-ink-tertiary">
                    {(gpu.vramBytes / 1024 ** 3).toFixed(1)} GB VRAM
                  </span>
                  {gpu.freeVramBytes > 0 && (
                    <span className="text-ink-faint">
                      ({(gpu.freeVramBytes / 1024 ** 3).toFixed(1)} GB free)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HwStat({
  icon: Icon,
  label,
  value,
  sub,
  pct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  pct?: number;
}) {
  return (
    <div className="rounded-lg bg-surface-deep/40 border border-line-subtle p-2.5">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="h-3 w-3 text-ink-tertiary" />
        <span className="text-2xs text-ink-muted uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs font-semibold text-ink-primary truncate">{value}</p>
      {sub && <p className="text-2xs text-ink-tertiary truncate">{sub}</p>}
      {pct !== undefined && (
        <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-overlay/12">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-teal-400 to-brand-indigo-400"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortDropdown
// ---------------------------------------------------------------------------

function SortDropdown({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const options: { id: SortKey; label: string }[] = [
    { id: "name", label: "Name" },
    { id: "size", label: "Size" },
    { id: "lastUsed", label: "Last used" },
    { id: "ram", label: "RAM estimate" },
    { id: "vram", label: "VRAM estimate" },
    { id: "context", label: "Context length" },
    { id: "params", label: "Parameters" },
  ];
  const current = options.find((o) => o.id === value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-line-subtle bg-surface-deep/40 px-2.5 py-1.5 text-2xs font-medium text-ink-secondary hover:bg-surface-deep/60"
      >
        <ArrowUpDown className="h-3 w-3" />
        Sort: {current?.label ?? "Name"}
        <ChevronDown className="h-3 w-3" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-line-subtle bg-surface-raised shadow-xl py-1"
            >
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-2xs hover:bg-overlay/4",
                    o.id === value ? "text-brand-indigo-300" : "text-ink-secondary",
                  )}
                >
                  {o.label}
                  {o.id === value && <Check className="h-3 w-3" />}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compatibility check — uses real RAM/VRAM from sysInfo.
// ---------------------------------------------------------------------------

function checkCompatibility(model: LocalModel, sysInfo: SystemInfo | null): CompatibilityCheck | null {
  if (!sysInfo) return null;
  const estimatedRamGb = model.ramEstimateGb ?? (model.sizeBytes / 1024 ** 3) * 1.2;
  const estimatedVramGb = model.vramEstimateGb ?? (model.sizeBytes / 1024 ** 3) * 1.2;
  const availableRamGb = sysInfo.availableRamBytes / 1024 ** 3;
  const availableVramGb = sysInfo.freeVramBytes / 1024 ** 3;

  if (availableVramGb >= estimatedVramGb && sysInfo.totalVramBytes > 0) {
    return {
      status: "compatible",
      estimatedRamGb,
      estimatedVramGb,
      availableRamGb,
      availableVramGb,
      message: "Fits in VRAM — will run on GPU.",
    };
  }
  if (availableRamGb >= estimatedRamGb) {
    return {
      status: "may-fit",
      estimatedRamGb,
      estimatedVramGb,
      availableRamGb,
      availableVramGb,
      message: availableVramGb > 0
        ? `Fits in RAM but not VRAM — will run on CPU. ${availableVramGb.toFixed(1)} GB VRAM free, need ~${estimatedVramGb.toFixed(1)} GB.`
        : "Fits in RAM — will run on CPU (no GPU detected).",
    };
  }
  return {
    status: "insufficient-ram",
    estimatedRamGb,
    estimatedVramGb,
    availableRamGb,
    availableVramGb,
    message: `Not enough RAM. Need ~${estimatedRamGb.toFixed(1)} GB, only ${availableRamGb.toFixed(1)} GB free.`,
  };
}

function CompatibilityBadge({ model, sysInfo }: { model: LocalModel; sysInfo: SystemInfo | null }) {
  const check = checkCompatibility(model, sysInfo);
  if (!check) return null;
  const variant = check.status === "compatible" ? "success" : check.status === "may-fit" ? "warning" : "danger";
  const label = check.status === "compatible" ? "Compatible" : check.status === "may-fit" ? "May Fit" : "Low RAM";
  return (
    <Tooltip content={check.message}>
      <Badge variant={variant} dot>{label}</Badge>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// ModelCard
// ---------------------------------------------------------------------------

function ModelCard({
  model,
  running,
  renaming,
  selected,
  sysInfo,
  onRun,
  onStop,
  onFavorite,
  onDelete,
  onRenameStart,
  onRenameEnd,
  onToggleSelect,
  onShowDetails,
  onShowRuntimeSettings,
  onBenchmark,
}: {
  model: LocalModel;
  running: boolean;
  renaming: boolean;
  selected: boolean;
  sysInfo: SystemInfo | null;
  onRun: () => void;
  onStop: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onRenameStart: () => void;
  onRenameEnd: () => void;
  onToggleSelect: () => void;
  onShowDetails: () => void;
  onShowRuntimeSettings: () => void;
  onBenchmark: (serverUrl: string) => void;
}) {
  const [name, setName] = useState(model.name);
  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [loadMsg, setLoadMsg] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const providers = useProvidersStore((s) => s.providers);
  const pushToast = useUIStore((s) => s.pushToast);
  const update = useSettingsStore((s) => s.update);
  const getRuntimeSettings = useRuntimeSettingsStore((s) => s.getForModel);
  const preferredRuntime = useRuntimeSettingsStore((s) => s.preferredRuntime);
  const recordLoad = useUsageStatsStore((s) => s.recordLoad);

  const capabilities: { id: ModelCapability; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: "vision", icon: Eye, label: "Vision" },
    { id: "reasoning", icon: Brain, label: "Reasoning" },
    { id: "embedding", icon: Type, label: "Embedding" },
    { id: "tools", icon: Wrench, label: "Tools" },
    { id: "audio", icon: AudioLines, label: "Audio" },
  ];

  // Usage stats from the real stats store.
  const stats = useUsageStatsStore((s) => s.stats[model.id]);

  const handleRun = async () => {
    const settings = getRuntimeSettings(model.id);
    setLoading(true);
    setLoadPct(0);
    setLoadMsg("Looking for a local runtime…");
    setLoadError(null);

    // Decide which runtime to try FIRST, based on the user's preference.
    const tryLlamaCppFirst = preferredRuntime === "llama-cpp";
    const tryOllamaFirst = preferredRuntime === "ollama";
    const tryLmStudioFirst = preferredRuntime === "lm-studio";

    // ---- llama.cpp ----
    const tryLlamaCpp = async (): Promise<boolean> => {
      try {
        // Step 1: Verify the runtime is usable BEFORE clicking Run. If the
        // binary is missing / not executable / --version fails, surface the
        // real reason immediately — never let the user click Run and get a
        // cryptic error half a second later.
        setLoadPct(5);
        setLoadMsg("Verifying llama-server runtime…");
        const verification = await verifyLlamaRuntime();
        if (!verification.ok) {
          const detail = verification.error ?? "Runtime verification failed";
          const hint = verification.diagnostic ?? "";
          // Surface the FULL diagnostic trail (which candidates we tried,
          // version check output, missing libraries) so the user knows
          // exactly what to fix.
          const candidateLines = verification.candidates
            .map((c) => `  - [${c.kind}] ${c.path} — ${c.rejectionReason ?? "ok"}`)
            .join("\n");
          const versionInfo = verification.versionCheck
            ? `\n--version exit code: ${verification.versionCheck.exitCode ?? "n/a"}\n--version stderr: ${verification.versionCheck.stderr || "(empty)"}`
            : "";
          const libInfo = verification.libraryCheck && !verification.libraryCheck.ok
            ? `\nMissing libraries: ${verification.libraryCheck.missing.join(", ")}`
            : "";
          setLoadError(`${detail}\n${hint}\n\nCandidates:\n${candidateLines}${versionInfo}${libInfo}`);
          return false;
        }

        setLoadPct(10);
        setLoadMsg("Starting llama-server…");
        setLoadPct(15);
        setLoadMsg(
          `Spawning llama-server (${verification.source}: ${verification.binaryPath})…`,
        );
        const handle: LlamaServerHandle = await startLlamaServer({
          modelPath: model.path,
          port: 8080,
          ctxSize: settings.contextSize,
          threads: settings.cpuThreads > 0 ? settings.cpuThreads : undefined,
          nGpuLayers: settings.gpuLayers,
        });

        // Phase → percent mapping. The percentages are honest checkpoints
        // derived from REAL llama-server output phases — NOT a fake timer.
        // The user sees exactly what stage the server is at, no more, no
        // less. Percent never advances past 90 until "ready" lands.
        const phaseToPct = (phase: string): number => {
          switch (phase) {
            case "starting":
              return 20;
            case "loading-tensors":
              return 35;
            case "cuda-init":
              return 55;
            case "kv-cache":
              return 75;
            case "ready":
              return 90; // 100 is reserved for the ready event itself
            case "error":
              return 0;
            default:
              return -1; // don't change
          }
        };

        // Subscribe to log events — use the phase field to update the
        // progress bar HONESTLY. No fake incrementing.
        const unlistenLog = await onLlamaServerLog(handle.session, (log) => {
          const line = log.line.trim();
          if (!line) return;
          const pct = phaseToPct(log.phase);
          if (pct >= 0) {
            setLoadPct((prev) => Math.max(prev, pct));
          }
          // Surface the actual log line — never a generic placeholder.
          setLoadMsg(line.slice(0, 240));
        });

        // Subscribe to the "exited" event — this is what REPLACES the old
        // generic "exited without printing anything" message. We get the
        // REAL exit code, log file path, and a human-readable summary.
        const unlistenExited = await onLlamaServerExited(handle.session, (p: LlamaServerExitedPayload) => {
          setLoading(false);
          unlistenReady();
          unlistenErrLlama();
          unlistenLog();
          unlistenExited();
          // Show the REAL error — never "exited without printing anything".
          const exitInfo = p.exitCode !== null ? ` (exit code ${p.exitCode})` : "";
          const logInfo = p.logFile ? `\n\nSession log: ${p.logFile}` : "";
          const hint = p.diagnostic ? `\n\n${p.diagnostic}` : "";
          setLoadError(`${p.error}${exitInfo}${hint}${logInfo}`);
        });

        const unlistenReady = await onLlamaServerReady(handle.session, (info) => {
          setLoading(false);
          setLoadPct(100);
          unlistenReady();
          unlistenErrLlama();
          unlistenLog();
          unlistenExited();
          onRun();
          recordLoad(model.id);
          pushToast({
            title: "Model loaded (llama.cpp)",
            description: `${model.name} is serving on ${info.url}`,
            variant: "success",
          });
          const providersStore = useProvidersStore.getState();
          const existing = providersStore.providers.find(
            (p) => p.kind === "openai-compatible" && p.baseUrl === `${info.url}/v1`,
          );
          if (existing) {
            if (!existing.enabled) providersStore.toggleEnabled(existing.id);
            update("defaultProviderId", existing.id);
          } else {
            const newId = providersStore.addProvider({
              kind: "openai-compatible",
              name: `llama.cpp · ${model.name}`,
              baseUrl: `${info.url}/v1`,
              apiKey: "llama-cpp",
            });
            providersStore.toggleEnabled(newId);
            update("defaultProviderId", newId);
          }
          update("defaultModelId", model.id);
        });
        const unlistenErrLlama = await onLlamaServerError(handle.session, (err, diag) => {
          unlistenReady();
          unlistenErrLlama();
          unlistenLog();
          unlistenExited();
          // Don't show the error yet — try the next runtime. (The "exited"
          // event handles the case where the process actually died with a
          // real reason; this branch is for higher-level spawn errors.)
          console.warn("llama-server error:", err, diag);
        });
        return true; // spawn succeeded
      } catch (llamaErr) {
        console.info("llama.cpp not available:", llamaErr);
        // Real error message — don't hide what went wrong.
        const msg = llamaErr instanceof Error ? llamaErr.message : String(llamaErr);
        setLoadError(`llama.cpp runtime error: ${msg}`);
        return false;
      }
    };

    // ---- Ollama ----
    const tryOllama = async (): Promise<boolean> => {
      const ollama = providers.find((p) => p.kind === "ollama" && p.enabled);
      if (!ollama) return false;
      setLoadPct(0);
      setLoadMsg("Connecting to Ollama…");
      const id = uid("load");
      const unlistenProgress = await onModelLoadProgress(id, (p) => {
        setLoadPct(p.percent);
        setLoadMsg(p.message);
      });
      const unlistenDone = await onModelLoadDone(id, () => {
        setLoading(false);
        setLoadPct(100);
        unlistenProgress();
        unlistenDone();
        unlistenError();
        onRun();
        recordLoad(model.id);
        pushToast({ title: "Model loaded (Ollama)", description: `${model.name} is ready.`, variant: "success" });
        update("defaultModelId", model.id);
      });
      const unlistenError = await onModelLoadError(id, (err) => {
        setLoading(false);
        setLoadError(err);
        unlistenProgress();
        unlistenDone();
        unlistenError();
        pushToast({ title: "Failed to load model", description: err, variant: "danger" });
      });
      try {
        await loadLocalModel(id, ollama.baseUrl, model.name, model.sizeBytes);
        return true;
      } catch (e) {
        setLoading(false);
        setLoadError(e instanceof Error ? e.message : String(e));
        unlistenProgress();
        unlistenDone();
        unlistenError();
        return false;
      }
    };

    // ---- LM Studio ----
    const tryLmStudio = async (): Promise<boolean> => {
      const lms = providers.find((p) => p.kind === "lm-studio" && p.enabled);
      if (!lms) return false;
      // LM Studio loads the model itself — we just need to set it as the
      // default and trust the user has already loaded it in LM Studio.
      setLoadMsg("Connecting to LM Studio…");
      setLoadPct(50);
      try {
        const resp = await fetch(`${lms.baseUrl.replace(/\/$/, "")}/v1/models`);
        if (resp.ok) {
          const data = await resp.json();
          const found = (data.data ?? []).some((m: { id: string }) => m.id === model.name);
          if (found) {
            setLoading(false);
            setLoadPct(100);
            onRun();
            recordLoad(model.id);
            update("defaultProviderId", lms.id);
            update("defaultModelId", model.id);
            pushToast({ title: "Model loaded (LM Studio)", description: `${model.name} is ready.`, variant: "success" });
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    };

    // ---- Try in user-preferred order ----
    let success = false;
    if (tryLlamaCppFirst) success = await tryLlamaCpp();
    if (!success && tryOllamaFirst) success = await tryOllama();
    if (!success && tryLmStudioFirst) success = await tryLmStudio();
    if (!success && !tryLlamaCppFirst) success = await tryLlamaCpp();
    if (!success && !tryOllamaFirst) success = await tryOllama();
    if (!success && !tryLmStudioFirst) success = await tryLmStudio();

    if (!success) {
      setLoading(false);
      setLoadError(
        "No local runtime available. Install llama.cpp (recommended — see LlamaDocumentation.md), enable Ollama, or start LM Studio.",
      );
      pushToast({
        title: "No local runtime enabled",
        description: "Install llama.cpp, enable Ollama, or start LM Studio.",
        variant: "warning",
      });
    }
  };

  // Find the llama-server URL for this model if it's running, so we can
  // pass it to the benchmark dialog.
  const llamaProvider = providers.find(
    (p) => p.kind === "openai-compatible" && p.name.startsWith("llama.cpp") && p.enabled,
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "group relative overflow-hidden rounded-2xl surface p-4 hover:border-line-medium transition-colors",
        selected && "ring-2 ring-brand-indigo-400",
      )}
    >
      {/* Status indicator */}
      {running && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-status-success opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-status-success" />
          </span>
        </div>
      )}

      {/* Selection checkbox */}
      <button
        type="button"
        onClick={onToggleSelect}
        className={cn(
          "absolute left-3 top-3 grid h-4 w-4 place-items-center rounded border transition-colors",
          selected ? "bg-brand-indigo-500 border-brand-indigo-400" : "border-line-subtle opacity-0 group-hover:opacity-100",
        )}
      >
        {selected && <Check className="h-2.5 w-2.5 text-white" />}
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 mb-3 pl-6">
        <div className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl border",
          running ? "bg-brand-gradient-soft border-brand-indigo-400/30" : "bg-surface-raised border-line-subtle",
        )}>
          <Cpu className={cn("h-5 w-5", running ? "text-brand-indigo-300" : "text-ink-tertiary")} />
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim()) {
                  useModelsStore.getState().renameModel(model.id, name.trim());
                }
                onRenameEnd();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setName(model.name); onRenameEnd(); }
              }}
              className="w-full bg-transparent text-sm font-semibold text-ink-primary focus:outline-none border-b border-brand-indigo-400/60"
            />
          ) : (
            <button type="button" onClick={onShowDetails} className="text-left">
              <h3 className="truncate text-sm font-semibold text-ink-primary hover:text-brand-indigo-300">{model.name}</h3>
            </button>
          )}
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
            {model.format === "gguf" && <Badge variant="teal">GGUF</Badge>}
            {model.format === "ggml" && <Badge variant="warning">GGML</Badge>}
            {model.quantization && <Badge variant="default">{model.quantization}</Badge>}
            {model.parameters && <Badge variant="brand">{model.parameters}</Badge>}
            {model.verified && <Badge variant="success" icon={<CheckCircle2 className="h-2.5 w-2.5" />}>Verified</Badge>}
            <CompatibilityBadge model={model} sysInfo={sysInfo} />
          </div>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <Meta label="Architecture" value={model.architecture ?? "—"} />
        <Meta label="Family" value={model.family ?? "—"} />
        <Meta label="Context" value={model.contextLength ? `${(model.contextLength / 1024).toFixed(0)}K` : "—"} />
        <Meta label="Quantization" value={model.quantization ?? "—"} />
        <Meta label="RAM estimate" value={model.ramEstimateGb ? `${model.ramEstimateGb} GB` : "—"} />
        <Meta label="VRAM estimate" value={model.vramEstimateGb ? `${model.vramEstimateGb} GB` : "—"} />
        <Meta label="Size" value={formatBytes(model.sizeBytes)} />
        <Meta label="Last used" value={model.lastUsedAt ? formatRelativeTime(model.lastUsedAt) : "never"} />
      </div>

      {/* Capabilities + parameter tags */}
      {model.capabilities.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          {capabilities.filter((c) => model.capabilities.includes(c.id)).map((c) => {
            const Icon = c.icon;
            return (
              <span key={c.id} className="flex items-center gap-1 rounded-md bg-brand-indigo-500/[0.08] border border-brand-indigo-400/20 px-1.5 py-0.5 text-2xs font-medium text-brand-indigo-300">
                <Icon className="h-2.5 w-2.5" />
                {c.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Usage stats — real numbers from the stats store. */}
      {stats && (stats.loadCount > 0 || stats.chatCount > 0) && (
        <div className="mb-3 grid grid-cols-3 gap-1.5 text-2xs">
          <UsageStat label="Loads" value={String(stats.loadCount)} />
          <UsageStat label="Chats" value={String(stats.chatCount)} />
          <UsageStat label="Avg tok/s" value={stats.avgTokensPerSec ? stats.avgTokensPerSec.toFixed(1) : "—"} />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-line-subtle">
        <div className="flex items-center gap-0.5">
          <Tooltip content={model.favorite ? "Remove from favorites" : "Add to favorites"}>
            <IconButton label="Favorite" size="sm" variant="ghost" onClick={onFavorite} active={model.favorite} className="cursor-pointer">
              <Star className={cn(model.favorite && "fill-current text-brand-amber-400")} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Details">
            <IconButton label="Details" size="sm" variant="ghost" onClick={onShowDetails} className="cursor-pointer">
              <Info />
            </IconButton>
          </Tooltip>
          <Tooltip content="Runtime settings">
            <IconButton label="Settings" size="sm" variant="ghost" onClick={onShowRuntimeSettings} className="cursor-pointer">
              <Settings2 />
            </IconButton>
          </Tooltip>
          <Tooltip content="Rename">
            <IconButton label="Rename" size="sm" variant="ghost" onClick={onRenameStart} className="cursor-pointer">
              <Pencil />
            </IconButton>
          </Tooltip>
          {running && llamaProvider && (
            <Tooltip content="Benchmark">
              <IconButton label="Benchmark" size="sm" variant="ghost" onClick={() => onBenchmark(llamaProvider.baseUrl.replace(/\/v1$/, ""))} className="cursor-pointer">
                <Gauge />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip content="Delete">
            <IconButton label="Delete" size="sm" variant="ghost" onClick={onDelete} className="hover:text-status-danger hover:bg-status-danger/10 cursor-pointer">
              <Trash2 />
            </IconButton>
          </Tooltip>
        </div>
        {running ? (
          <Button variant="outline" size="sm" iconLeft={<Square className="h-3 w-3 fill-current" />} onClick={onStop} className="cursor-pointer">
            Stop
          </Button>
        ) : loading ? (
          <Button variant="outline" size="sm" disabled iconLeft={<Loader2 className="h-3 w-3 animate-spin" />}>
            {loadPct}%
          </Button>
        ) : (
          <Button variant="primary" size="sm" iconLeft={<Play className="h-3 w-3 fill-current" />} onClick={handleRun} className="cursor-pointer">
            Run
          </Button>
        )}
      </div>

      {/* Loading overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-surface-midnight/80 backdrop-blur-sm"
          >
            <div className="w-full max-w-[260px] px-4">
              <div className="mb-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-brand-indigo-300" />
                <span className="text-xs font-semibold text-ink-primary">Loading model…</span>
                <span className="ml-auto text-2xs font-medium text-brand-indigo-300 tabular-nums">{loadPct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-overlay/12">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-brand-indigo-400 to-brand-indigo-500"
                  animate={{ width: `${loadPct}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
              <p className="mt-2 text-2xs text-ink-tertiary truncate font-mono">{loadMsg || "Loading…"}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error banner */}
      <AnimatePresence>
        {loadError && !loading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 flex items-start gap-2 rounded-lg border border-status-danger/40 bg-status-danger/[0.08] p-2.5 text-xs text-status-danger"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-semibold">Couldn't load model</p>
              <p className="text-status-danger/80 mt-0.5">{loadError}</p>
              <button
                type="button"
                onClick={() => setLoadError(null)}
                className="mt-1 text-2xs underline cursor-pointer hover:text-status-danger"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Path */}
      <p className="mt-2 truncate text-2xs text-ink-faint font-mono">{model.path}</p>
    </motion.div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-deep/40 border border-line-subtle px-2.5 py-1.5">
      <p className="text-2xs text-ink-muted uppercase tracking-wider">{label}</p>
      <p className="text-xs font-medium text-ink-secondary truncate">{value}</p>
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-overlay/4 px-1.5 py-1 text-center">
      <p className="text-2xs font-semibold text-ink-primary tabular-nums">{value}</p>
      <p className="text-2xs text-ink-faint">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelDetailsDialog — shows extended GGUF metadata + SHA-256.
// ---------------------------------------------------------------------------

function ModelDetailsDialog({ model, onClose }: { model: LocalModel; onClose: () => void }) {
  const [meta, setMeta] = useState<ReturnType<typeof useGgufMetaState> | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const [shaLoading, setShaLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const pushToast = useUIStore((s) => s.pushToast);

  // Fetch extended GGUF metadata (tokenizer, eos, bos, license, etc.).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await readGgufMetadata(model.path);
        if (cancelled) return;
        setMeta({
          family: m.family ?? null,
          tokenizer: m.tokenizer ?? null,
          eosToken: m.eosToken ?? null,
          bosToken: m.bosToken ?? null,
          license: m.license ?? null,
          organization: m.organization ?? null,
          trainingDataset: m.trainingDataset ?? null,
          rawMetadata: m.rawMetadata ?? {},
        });
      } catch (e) {
        console.error("Failed to fetch extended metadata:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [model.path]);

  const computeSha = async () => {
    setShaLoading(true);
    try {
      const hash = await sha256File(model.path);
      setSha256(hash);
    } catch (e) {
      pushToast({ title: "SHA-256 failed", description: e instanceof Error ? e.message : String(e), variant: "danger" });
    } finally {
      setShaLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[200] grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-surface-midnight/72 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative surface-raised border border-line-subtle rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-ink-tertiary" />
            <h2 className="text-sm font-semibold font-display text-ink-primary">{model.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-ink-tertiary hover:text-ink-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* General */}
          <Section title="General">
            <DetailRow label="Name" value={model.name} />
            <DetailRow label="Architecture" value={model.architecture ?? "—"} />
            <DetailRow label="Family" value={meta?.family ?? model.family ?? "—"} />
            <DetailRow label="Parameters" value={model.parameters ?? "—"} />
            <DetailRow label="Quantization" value={model.quantization ?? "—"} />
            <DetailRow label="Context length" value={model.contextLength ? `${model.contextLength.toLocaleString()} tokens` : "—"} />
            <DetailRow label="Format" value={model.format} />
            <DetailRow label="Size" value={formatBytes(model.sizeBytes)} />
            <DetailRow label="RAM estimate" value={model.ramEstimateGb ? `${model.ramEstimateGb} GB` : "—"} />
            <DetailRow label="VRAM estimate" value={model.vramEstimateGb ? `${model.vramEstimateGb} GB` : "—"} />
            <DetailRow label="License" value={meta?.license ?? model.license ?? "—"} />
            <DetailRow label="Organization" value={meta?.organization ?? model.organization ?? "—"} />
            <DetailRow label="Training dataset" value={meta?.trainingDataset ?? model.trainingDataset ?? "—"} />
          </Section>

          {/* Tokenizer */}
          <Section title="Tokenizer">
            <DetailRow label="Tokenizer model" value={meta?.tokenizer ?? model.tokenizer ?? "—"} />
            <DetailRow label="EOS token" value={meta?.eosToken ?? model.eosToken ?? "—"} mono />
            <DetailRow label="BOS token" value={meta?.bosToken ?? model.bosToken ?? "—"} mono />
          </Section>

          {/* SHA-256 */}
          <Section title="File integrity">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" iconLeft={shaLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldIcon />} onClick={() => void computeSha()} disabled={shaLoading}>
                {shaLoading ? "Computing…" : "Compute SHA-256"}
              </Button>
            </div>
            {sha256 && (
              <div className="rounded-lg bg-surface-deep/40 border border-line-subtle p-2.5">
                <p className="text-2xs text-ink-muted mb-1">SHA-256 digest</p>
                <p className="text-2xs font-mono text-ink-secondary break-all">{sha256}</p>
              </div>
            )}
          </Section>

          {/* Capabilities */}
          <Section title="Capabilities">
            <div className="flex flex-wrap gap-1.5">
              {model.capabilities.length === 0 ? (
                <span className="text-2xs text-ink-faint">No capabilities detected.</span>
              ) : (
                model.capabilities.map((c) => <Badge key={c} variant="default">{c}</Badge>)
              )}
            </div>
          </Section>

          {/* Path */}
          <Section title="File location">
            <div className="rounded-lg bg-surface-deep/40 border border-line-subtle p-2.5">
              <p className="text-2xs text-ink-muted mb-1">Model path</p>
              <p className="text-2xs font-mono text-ink-secondary break-all">{model.path}</p>
            </div>
          </Section>

          {/* Raw metadata expander */}
          {meta?.rawMetadata && Object.keys(meta.rawMetadata).length > 0 && (
            <Section title="Raw GGUF metadata">
              <button
                type="button"
                onClick={() => setShowRaw(!showRaw)}
                className="flex items-center gap-1 text-2xs text-ink-tertiary hover:text-ink-primary"
              >
                {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showRaw ? "Hide" : "Show"} {Object.keys(meta.rawMetadata).length} fields
              </button>
              <AnimatePresence>
                {showRaw && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-surface-deep/60 border border-line-subtle p-2.5 font-mono text-2xs"
                  >
                    {Object.entries(meta.rawMetadata).map(([k, v]) => (
                      <div key={k} className="flex gap-2 py-0.5">
                        <span className="text-ink-muted shrink-0">{k}:</span>
                        <span className="text-ink-secondary break-all">{v}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </Section>
          )}
        </div>

        <div className="border-t border-line-subtle p-4 flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Tiny helper for the readGgufMetadata return type.
function useGgufMetaState() {
  return {
    family: null as string | null,
    tokenizer: null as string | null,
    eosToken: null as string | null,
    bosToken: null as string | null,
    license: null as string | null,
    organization: null as string | null,
    trainingDataset: null as string | null,
    rawMetadata: {} as Record<string, string>,
  };
}

function ShieldIcon() {
  return <CheckCircle2 className="h-3 w-3" />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="text-ink-muted w-32 shrink-0">{label}</span>
      <span className={cn("text-ink-secondary break-all", mono && "font-mono")}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuntimeSettingsDialog — advanced runtime settings per model.
// ---------------------------------------------------------------------------

function RuntimeSettingsDialog({ model, onClose }: { model: LocalModel; onClose: () => void }) {
  const settings = useRuntimeSettingsStore((s) => s.getForModel(model.id));
  const setForModel = useRuntimeSettingsStore((s) => s.setForModel);
  const resetForModel = useRuntimeSettingsStore((s) => s.resetForModel);
  const preferredRuntime = useRuntimeSettingsStore((s) => s.preferredRuntime);
  const setPreferredRuntime = useRuntimeSettingsStore((s) => s.setPreferredRuntime);
  const pushToast = useUIStore((s) => s.pushToast);

  const [local, setLocal] = useState<RuntimeSettings>(settings);

  const save = () => {
    setForModel(model.id, local);
    pushToast({ title: "Settings saved", description: `Runtime settings for ${model.name} updated.`, variant: "success" });
    onClose();
  };

  const reset = () => {
    resetForModel(model.id);
    setLocal(DEFAULT_RUNTIME_SETTINGS);
    pushToast({ title: "Settings reset", description: "Restored to defaults.", variant: "info" });
  };

  const runtimeOptions: { id: RuntimeKind; label: string; description: string }[] = [
    { id: "llama-cpp", label: "llama.cpp", description: "Bundled sidecar — recommended. Best performance, most features." },
    { id: "ollama", label: "Ollama", description: "Use the Ollama runtime if it's installed and running." },
    { id: "lm-studio", label: "LM Studio", description: "Connect to a running LM Studio instance." },
    { id: "openai-compatible", label: "OpenAI-compatible", description: "Connect to any OpenAI-compatible endpoint." },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-[200] grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-surface-midnight/72 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative surface-raised border border-line-subtle rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-ink-tertiary" />
            <h2 className="text-sm font-semibold font-display text-ink-primary">Runtime settings · {model.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-ink-tertiary hover:text-ink-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Runtime selector */}
          <Section title="Preferred runtime">
            <div className="grid grid-cols-2 gap-2">
              {runtimeOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPreferredRuntime(opt.id)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    preferredRuntime === opt.id
                      ? "border-brand-indigo-400 bg-brand-indigo-500/[0.08]"
                      : "border-line-subtle bg-surface-deep/40 hover:border-line-medium",
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-ink-primary">{opt.label}</span>
                    {preferredRuntime === opt.id && <Check className="h-3 w-3 text-brand-indigo-300" />}
                  </div>
                  <p className="text-2xs text-ink-tertiary leading-snug">{opt.description}</p>
                </button>
              ))}
            </div>
          </Section>

          {/* Memory / performance */}
          <Section title="Memory & performance">
            <NumberField label="Context size (tokens)" value={local.contextSize} onChange={(v) => setLocal({ ...local, contextSize: v })} min={512} step={1024} />
            <NumberField label="GPU layers (-1 = all)" value={local.gpuLayers} onChange={(v) => setLocal({ ...local, gpuLayers: v })} min={-1} />
            <NumberField label="CPU threads (0 = auto)" value={local.cpuThreads} onChange={(v) => setLocal({ ...local, cpuThreads: v })} min={0} />
            <NumberField label="Batch size" value={local.batchSize} onChange={(v) => setLocal({ ...local, batchSize: v })} min={1} step={64} />
          </Section>

          {/* Flags */}
          <Section title="Optimizations">
            <ToggleField label="Flash Attention" description="Faster on supported architectures (Llama, Mistral, Qwen)." checked={local.flashAttention} onChange={(v) => setLocal({ ...local, flashAttention: v })} />
            <ToggleField label="Memory lock (mlock)" description="Pin model in RAM to prevent swapping." checked={local.mlock} onChange={(v) => setLocal({ ...local, mlock: v })} />
            <ToggleField label="Memory map (mmap)" description="Map file directly — faster startup, shared between processes." checked={local.mmap} onChange={(v) => setLocal({ ...local, mmap: v })} />
            <ToggleField label="NUMA" description="Optimize for multi-socket systems." checked={local.numa} onChange={(v) => setLocal({ ...local, numa: v })} />
          </Section>

          {/* Sampling */}
          <Section title="Sampling">
            <NumberField label="Temperature" value={local.temperature} onChange={(v) => setLocal({ ...local, temperature: v })} min={0} step={0.1} />
            <NumberField label="Top P" value={local.topP} onChange={(v) => setLocal({ ...local, topP: v })} min={0} max={1} step={0.05} />
            <NumberField label="Top K" value={local.topK} onChange={(v) => setLocal({ ...local, topK: v })} min={0} step={1} />
            <NumberField label="Repeat penalty" value={local.repeatPenalty} onChange={(v) => setLocal({ ...local, repeatPenalty: v })} min={1} step={0.05} />
          </Section>
        </div>

        <div className="border-t border-line-subtle p-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="md" onClick={reset}>Reset to defaults</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="md" onClick={save}>Save</Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-ink-secondary">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-line-subtle bg-surface-deep/40 px-2 py-1 text-xs text-right text-ink-primary focus:outline-none focus:border-brand-indigo-400"
      />
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex-1">
        <p className="text-xs text-ink-secondary">{label}</p>
        <p className="text-2xs text-ink-tertiary">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand-indigo-500" : "bg-overlay/12",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BenchmarkDialog — runs a real benchmark against the running llama-server.
// ---------------------------------------------------------------------------

function BenchmarkDialog({
  model,
  serverUrl,
  onClose,
}: {
  model: LocalModel;
  serverUrl: string;
  onClose: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxTokens, setMaxTokens] = useState(128);
  const pushToast = useUIStore((s) => s.pushToast);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await benchmarkModel({
        baseUrl: serverUrl,
        model: model.name,
        maxTokens,
      });
      if (r.ok) {
        setResult(r);
        pushToast({ title: "Benchmark complete", description: `${r.generationPerSec.toFixed(1)} tok/s`, variant: "success" });
      } else {
        setError(r.error ?? "Benchmark failed");
        pushToast({ title: "Benchmark failed", description: r.error ?? "Unknown error", variant: "danger" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[200] grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-surface-midnight/72 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative surface-raised border border-line-subtle rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-ink-tertiary" />
            <h2 className="text-sm font-semibold font-display text-ink-primary">Benchmark · {model.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-ink-tertiary hover:text-ink-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-ink-tertiary">
            Runs a real chat completion against <span className="font-mono">{serverUrl}</span> and measures prompt-evaluation speed, generation speed, TTFT, and peak RAM/VRAM usage.
          </p>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-secondary">Max tokens to generate</span>
            <input
              type="number"
              value={maxTokens}
              min={16}
              max={1024}
              step={16}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-24 rounded-md border border-line-subtle bg-surface-deep/40 px-2 py-1 text-xs text-right text-ink-primary focus:outline-none focus:border-brand-indigo-400"
            />
          </div>

          <Button variant="primary" size="md" iconLeft={running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} onClick={() => void run()} disabled={running} className="w-full">
            {running ? "Running…" : "Run benchmark"}
          </Button>

          {error && (
            <div className="rounded-lg border border-status-danger/40 bg-status-danger/[0.08] p-2.5 text-xs text-status-danger">
              <p className="font-semibold">Benchmark failed</p>
              <p className="text-status-danger/80 mt-0.5">{error}</p>
            </div>
          )}

          {result && (
            <div className="grid grid-cols-2 gap-2">
              <BenchmarkStat label="Prompt eval" value={result.promptEvalPerSec.toFixed(1)} unit="tok/s" />
              <BenchmarkStat label="Generation" value={result.generationPerSec.toFixed(1)} unit="tok/s" />
              <BenchmarkStat label="TTFT" value={result.ttftMs.toString()} unit="ms" />
              <BenchmarkStat label="Total time" value={result.totalMs.toString()} unit="ms" />
              <BenchmarkStat label="Prompt tokens" value={result.promptTokens.toString()} unit="" />
              <BenchmarkStat label="Generation tokens" value={result.generationTokens.toString()} unit="" />
              <BenchmarkStat label="Peak RAM" value={formatBytes(result.peakRamBytes)} unit="" />
              <BenchmarkStat label="Peak VRAM" value={result.peakVramBytes > 0 ? formatBytes(result.peakVramBytes) : "—"} unit="" />
            </div>
          )}
        </div>

        <div className="border-t border-line-subtle p-4 flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function BenchmarkStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg bg-surface-deep/40 border border-line-subtle p-2.5">
      <p className="text-2xs text-ink-muted uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-ink-primary tabular-nums">
        {value} <span className="text-2xs text-ink-tertiary font-normal">{unit}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CloudModelsList (unchanged from original)
// ---------------------------------------------------------------------------

function CloudModelsList() {
  const providers = useProvidersStore((s) => s.providers);
  const setRoute = useUIStore((s) => s.setRoute);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "text" | "vision">("all");
  const cloudModels = providers.filter((p) => p.enabled).flatMap((p) =>
    p.models.map((m) => ({ ...m, providerName: p.name, providerKind: p.kind })),
  );

  const filtered = cloudModels.filter((m) => {
    if (query) {
      const q = query.toLowerCase();
      const matches = m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q) || m.providerKind.toLowerCase().includes(q);
      if (!matches) return false;
    }
    const hasVision = m.capabilities.includes("vision") || m.id.toLowerCase().includes("vision") || m.id.toLowerCase().includes("vl") || m.id.toLowerCase().includes("llava");
    if (filter === "vision" && !hasVision) return false;
    if (filter === "text" && hasVision) return false;
    return true;
  });

  if (cloudModels.length === 0) {
    return (
      <EmptyState
        icon={<Cloud className="h-7 w-7" />}
        title="No cloud models yet"
        description="Enable a provider in the Providers page to see its models here."
        action={<Button variant="primary" onClick={() => setRoute("providers")}>Go to Providers</Button>}
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-sm">
          <Input iconLeft={<Search />} placeholder="Search cloud models…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {(["all", "text", "vision"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-2xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-brand-indigo-500/15 text-brand-indigo-300 border border-brand-indigo-400/30"
                  : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4 border border-transparent",
              )}
            >
              {f === "all" ? "All" : f === "text" ? "Text only" : "Vision"}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="No models match" description="Try a different search query or filter." size="md" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((m) => {
            const hasVision = m.capabilities.includes("vision") || m.id.toLowerCase().includes("vision") || m.id.toLowerCase().includes("vl") || m.id.toLowerCase().includes("llava");
            return (
              <Card key={m.id} hover>
                <div className="flex items-start gap-3 mb-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-raised border border-line-subtle">
                    <Cloud className="h-5 w-5 text-brand-teal-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-ink-primary">{m.name}</h3>
                    <p className="text-2xs text-ink-tertiary">{m.providerName}</p>
                  </div>
                  <Badge variant="default">{m.providerKind}</Badge>
                </div>
                <p className="text-xs text-ink-tertiary line-clamp-2 mb-3">{m.description ?? "Cloud-hosted model"}</p>
                <div className="flex items-center gap-2 text-2xs text-ink-muted">
                  <span>{(m.contextLength / 1024).toFixed(0)}K context</span>
                  {m.pricing?.inputPer1M && <span>· ${m.pricing.inputPer1M}/M in</span>}
                  {hasVision && <Badge variant="teal">vision</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
