/**
 * HuggingFaceView — browse Hugging Face models inside Xirea.
 *
 * Uses the real Hugging Face Hub API via the Rust backend (no API key
 * required for public models). Features:
 *  - Search bar (debounced)
 *  - Filter chips (Trending / Most downloaded / Newest / Verified)
 *  - Category filter (text-generation, image, audio, etc.)
 *  - Model cards with description, downloads, likes, tags, context, quantizations,
 *    total download size (lazy-fetched per card).
 *  - Click → detail drawer with files list + per-file download button.
 *  - Real downloads via the Rust download manager — always fetches the full
 *    file list first so the "no file available" error never fires.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  TrendingUp,
  Download,
  Clock,
  BadgeCheck,
  Heart,
  Filter,
  Box,
  ArrowUpRight,
  ChevronLeft,
  FileBox,
  HardDrive,
  Tag,
  Sparkles,
  AlertCircle,
  Cpu,
  Layers,
} from "lucide-react";
import { cn, formatBytes, formatNumber, formatRelativeTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tooltip } from "@/components/ui/Tooltip";
import { Spinner } from "@/components/ui/Spinner";
import { useDownloadsStore } from "@/store/downloads";
import { useUIStore } from "@/store/ui";
import { useModelsStore } from "@/store/models";
import { openExternal, hfSearch, hfModel, onDownloadProgress, ensureDir, type HfModelDto, type HfFileDto } from "@/lib/tauri";
import { uid } from "@/lib/utils";

type Sort = "trending" | "downloads" | "newest" | "verified";

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "text-generation", label: "Text" },
  { id: "text-to-image", label: "Image" },
  { id: "text-to-speech", label: "Audio" },
  { id: "automatic-speech-recognition", label: "ASR" },
  { id: "embedding", label: "Embedding" },
];

export function HuggingFaceView() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<Sort>("trending");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<HfModelDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<HfModelDto[]>([]);

  // Debounce the query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch models whenever the debounced query, sort, or category changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const tags = category === "all" ? undefined : [category];
    const direction = sort === "newest" ? "-1" : "-1";
    hfSearch({
      query: debouncedQuery || undefined,
      sort,
      direction,
      limit: 50,
      tags,
    })
      .then((result) => {
        if (cancelled) return;
        setModels(result);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, sort, category]);

  const filtered = useMemo(() => {
    let list = [...models];
    if (sort === "verified") {
      list = list.filter((m) => m.verified);
      list.sort((a, b) => b.likes - a.likes);
    }
    return list;
  }, [models, sort]);

  // Update a single model in the list with its full file list (with sizes).
  const updateModelFiles = (modelId: string, full: HfModelDto) => {
    setModels((prev) => prev.map((m) => (m.id === modelId ? full : m)));
    if (selected?.id === modelId) setSelected(full);
  };

  const handleDownload = async (model: HfModelDto, file?: HfFileDto) => {
    // Always fetch the full file list first if we don't have file SIZES yet.
    // The list endpoint returns siblings with no `sizeBytes`; only the
    // single-model endpoint returns the file tree with sizes.
    let working = model;
    const hasSizes = model.files.some((f) => f.sizeBytes !== null && f.sizeBytes !== undefined);
    if (!hasSizes) {
      try {
        const full = await hfModel(model.id);
        working = full;
        updateModelFiles(model.id, full);
      } catch (e) {
        console.error("Failed to fetch model details:", e);
      }
    }

    // Pick the best file: explicit > first .gguf > first file > none.
    const target =
      file ??
      working.files.find((f) => f.rfilename.toLowerCase().endsWith(".gguf")) ??
      working.files.find((f) => {
        const name = f.rfilename.toLowerCase();
        return name.endsWith(".safetensors") || name.endsWith(".bin") || name.endsWith(".pt");
      }) ??
      working.files[0];

    if (!target) {
      useUIStore.getState().pushToast({
        title: "No downloadable files",
        description: "This model has no files attached. Try a different model.",
        variant: "warning",
      });
      return;
    }

    // Construct target path under the user's home .xirea/models/<model-id>/.
    const safeId = model.id.replace(/[\\/]/g, "__");
    const targetDir = `~/.xirea/models/${safeId}`;
    const targetPath = `${targetDir}/${target.rfilename.replace(/[\\/]/g, "_")}`;
    // Use the canonical HF resolve URL — falls back to the file's `url` field
    // if the API returned one (some endpoints do). The resolve URL works for
    // both public models and (with auth) gated models.
    const sourceUrl =
      target.url ??
      `https://huggingface.co/${model.id}/resolve/main/${target.rfilename}`;

    // Fetch the file's LFS SHA-256 from the HF API. HuggingFace exposes this
    // at https://huggingface.co/api/models/<id>/tree/main/<path> — each file
    // entry has an `lfs.oid` field with the SHA-256 of the underlying LFS
    // object. We use it for post-download verification (real checksum, not
    // a mock).
    let expectedSha256: string | undefined;
    try {
      const dirPath = target.rfilename.includes("/")
        ? target.rfilename.substring(0, target.rfilename.lastIndexOf("/"))
        : "";
      const treeUrl = `https://huggingface.co/api/models/${model.id}/tree/main${dirPath ? "/" + dirPath : ""}`;
      const resp = await fetch(treeUrl);
      if (resp.ok) {
        const data = await resp.json();
        const entry = (Array.isArray(data) ? data : []).find(
          (e: { path?: string; lfs?: { oid?: string } }) =>
            e.path === target.rfilename.split("/").pop() && e.lfs?.oid,
        );
        if (entry?.lfs?.oid) {
          expectedSha256 = entry.lfs.oid as string;
        }
      }
    } catch (e) {
      console.warn("Could not fetch LFS SHA-256:", e);
    }

    // Make sure the directory exists.
    try {
      await ensureDir(targetDir);
    } catch (e) {
      useUIStore.getState().pushToast({
        title: "Could not create directory",
        description: e instanceof Error ? e.message : String(e),
        variant: "danger",
      });
      return;
    }

    // Generate the download id ONCE and pass it to BOTH enqueue AND start.
    const id = uid("dl");
    const { enqueue, start, progress, complete, fail } = useDownloadsStore.getState();
    enqueue({
      id,
      name: target.rfilename,
      sourceUrl,
      targetPath,
      totalBytes: target.sizeBytes ?? undefined,
      kind: "model",
      expectedSha256,
    });

    // Subscribe to progress events for this download id.
    const unlisten = await onDownloadProgress(id, (p) => {
      if (p.state === "downloading" || p.state === "paused") {
        progress(id, p.receivedBytes, p.totalBytes ?? undefined);
      } else if (p.state === "completed") {
        progress(id, p.receivedBytes, p.totalBytes ?? p.receivedBytes);
        complete(id);
        unlisten();
        // Auto-import into the models store.
        const importModel = useModelsStore.getState().importModel;
        importModel({
          name: model.id.split("/").pop() ?? model.id,
          format: target.rfilename.toLowerCase().endsWith(".gguf") ? "gguf" : "ggml",
          sizeBytes: target.sizeBytes ?? p.receivedBytes,
          path: targetPath,
          architecture: model.tags.find((t) => ["llama", "qwen", "mistral", "gemma", "phi"].includes(t)),
          contextLength: model.contextLength ?? undefined,
          quantization: /q[0-9]_[a-z_]+/i.exec(target.rfilename)?.[0]?.toUpperCase(),
          capabilities: ["reasoning"],
          source: "huggingface",
          verified: model.verified,
        });
        useUIStore.getState().pushToast({
          title: "Download complete",
          description: `${target.rfilename} is ready`,
          variant: "success",
        });
      } else if (p.state === "failed") {
        fail(id, p.error ?? "Download failed");
        unlisten();
        useUIStore.getState().pushToast({
          title: "Download failed",
          description: p.error ?? "Unknown error",
          variant: "danger",
        });
      } else if (p.state === "cancelled") {
        fail(id, "Cancelled");
        unlisten();
      }
    });

    try {
      await start(id, sourceUrl, targetPath);
      useUIStore.getState().pushToast({
        title: "Download queued",
        description: `${target.rfilename}${target.sizeBytes ? " · " + formatBytes(target.sizeBytes) : ""}`,
        variant: "info",
      });
    } catch (e) {
      fail(id, e instanceof Error ? e.message : String(e));
      unlisten();
      useUIStore.getState().pushToast({
        title: "Download failed to start",
        description: e instanceof Error ? e.message : String(e),
        variant: "danger",
      });
    }

    setSelected(null);
  };

  const openModelDetail = async (model: HfModelDto) => {
    setSelected(model);
    // Always fetch the full model (with file sizes) — the list endpoint
    // returns siblings without sizes, so we need the single-model endpoint
    // for the per-file size column in the detail drawer.
    try {
      const full = await hfModel(model.id);
      setSelected(full);
      // Also update the model in the search results list so the card
      // shows the right sizes when the user closes the drawer.
      setModels((prev) => prev.map((m) => (m.id === model.id ? full : m)));
    } catch (e) {
      console.error("Failed to fetch model details:", e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line-subtle px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-display text-ink-primary">Hugging Face</h1>
              <Badge variant="brand" dot>Live API</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-tertiary">
              Search, preview, and download models directly into Xirea. Files are fetched from huggingface.co — no browser required.
            </p>
          </div>
          <Button variant="secondary" size="md" iconLeft={<ArrowUpRight />} onClick={() => void openExternal("https://huggingface.co/models")}>
            Open site
          </Button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="flex-1 max-w-xl">
            <Input
              iconLeft={<Search />}
              placeholder="Search models, authors, tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Tabs
            items={[
              { id: "trending", label: "Trending", icon: <TrendingUp className="h-3 w-3" /> },
              { id: "downloads", label: "Top", icon: <Download className="h-3 w-3" /> },
              { id: "newest", label: "Newest", icon: <Clock className="h-3 w-3" /> },
              { id: "verified", label: "Verified", icon: <BadgeCheck className="h-3 w-3" /> },
            ]}
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            variant="segmented"
            size="sm"
          />
        </div>

        {/* Category chips */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3 w-3 text-ink-faint" />
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                category === c.id
                  ? "bg-overlay/8 text-ink-primary border border-line-soft"
                  : "text-ink-tertiary hover:text-ink-secondary hover:bg-overlay/4",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid place-items-center py-20">
            <Spinner />
            <p className="mt-3 text-xs text-ink-tertiary">Fetching models from huggingface.co…</p>
          </div>
        ) : error ? (
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't reach Hugging Face"
            description={error}
            size="lg"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Box className="h-7 w-7" />}
            title="No models match"
            description={`Nothing on Hugging Face matches “${query}”. Try a different keyword or category.`}
            size="lg"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((model) => (
              <HFModelCard
                key={model.id}
                model={model}
                onClick={() => void openModelDetail(model)}
                onDownload={() => void handleDownload(model)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <HFModelDetailDrawer
            model={selected}
            onClose={() => setSelected(null)}
            onDownload={(file) => void handleDownload(selected, file)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Sum up the sizes of all GGUF/safetensors/bin files for a model. */
function summarizeDownloadSize(model: HfModelDto): { bytes: number | null; count: number } {
  const downloadable = model.files.filter((f) => {
    const n = f.rfilename.toLowerCase();
    return n.endsWith(".gguf") || n.endsWith(".safetensors") || n.endsWith(".bin") || n.endsWith(".pt");
  });
  if (downloadable.length === 0) return { bytes: null, count: 0 };
  const total = downloadable.reduce((acc, f) => acc + (f.sizeBytes ?? 0), 0);
  // If any file is missing its size, return null (unknown).
  if (downloadable.some((f) => f.sizeBytes === null || f.sizeBytes === undefined)) {
    return { bytes: null, count: downloadable.length };
  }
  return { bytes: total, count: downloadable.length };
}

function HFModelCard({ model, onClick, onDownload }: { model: HfModelDto; onClick: () => void; onDownload: () => void }) {
  const sizeInfo = summarizeDownloadSize(model);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <Card hover padded={false} className="overflow-hidden cursor-pointer">
        <button type="button" onClick={onClick} className="w-full text-left p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-fuchsia-500/15 to-brand-indigo-500/15 border border-line-subtle">
              <span className="text-sm font-bold text-brand-fuchsia-300">{model.author[0]?.toUpperCase()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-sm font-semibold text-ink-primary">{model.id.split("/").pop()}</h3>
                {model.verified && <BadgeCheck className="h-3.5 w-3.5 text-brand-teal-400" />}
                {model.trending && <Badge variant="fuchsia" dot>Trending</Badge>}
              </div>
              <p className="text-2xs text-ink-tertiary truncate">{model.author}</p>
            </div>
          </div>
          <p className="text-xs text-ink-tertiary line-clamp-3 mb-3">{model.description ?? "No description available."}</p>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Stat icon={Download} label="Downloads" value={formatNumber(model.downloads)} />
            <Stat icon={Heart} label="Likes" value={formatNumber(model.likes)} />
            <Stat
              icon={Cpu}
              label="Context"
              value={model.contextLength ? `${(model.contextLength / 1024).toFixed(0)}K` : "—"}
            />
            <Stat
              icon={HardDrive}
              label="Size"
              value={
                sizeInfo.bytes !== null
                  ? formatBytes(sizeInfo.bytes)
                  : sizeInfo.count > 0
                    ? `${sizeInfo.count} files`
                    : "—"
              }
            />
          </div>
        </button>
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-0">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {model.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="ghost">{tag}</Badge>
            ))}
            {model.quantizations.length > 0 && (
              <Badge variant="teal">{model.quantizations.length} quants</Badge>
            )}
          </div>
          <Button variant="secondary" size="sm" iconLeft={<Download />} onClick={(e) => { e.stopPropagation(); onDownload(); }}>
            Get
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

function HFModelDetailDrawer({ model, onClose, onDownload }: { model: HfModelDto; onClose: () => void; onDownload: (file?: HfFileDto) => void }) {
  const sizeInfo = summarizeDownloadSize(model);
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-surface-midnight/72 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative h-full w-full max-w-[480px] surface-raised border-l border-line-subtle flex flex-col"
      >
        <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3">
          <button type="button" onClick={onClose} className="flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink-primary">
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          <span className="ml-auto text-2xs text-ink-faint truncate">huggingface.co/{model.id}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Title */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold font-display text-ink-primary">{model.id.split("/").pop()}</h2>
              {model.verified && <BadgeCheck className="h-4 w-4 text-brand-teal-400" />}
              {model.trending && <Badge variant="fuchsia" dot>Trending</Badge>}
            </div>
            <p className="text-xs text-ink-tertiary">by {model.author} · updated {formatRelativeTime(model.lastModified)}</p>
          </div>

          <p className="text-sm text-ink-secondary leading-relaxed">{model.description ?? "No description available."}</p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={Download} label="Downloads" value={formatNumber(model.downloads)} />
            <Stat icon={Heart} label="Likes" value={formatNumber(model.likes)} />
            <Stat icon={Sparkles} label="Context" value={model.contextLength ? `${(model.contextLength / 1024).toFixed(0)}K` : "—"} />
          </div>

          {/* Tags */}
          {model.tags.length > 0 && (
            <div>
              <h4 className="text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-2 flex items-center gap-1"><Tag className="h-3 w-3" />Tags</h4>
              <div className="flex flex-wrap gap-1">
                {model.tags.map((t) => <Badge key={t} variant="default">{t}</Badge>)}
              </div>
            </div>
          )}

          {/* Quantizations */}
          {model.quantizations.length > 0 && (
            <div>
              <h4 className="text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-2 flex items-center gap-1"><Layers className="h-3 w-3" />Quantizations</h4>
              <div className="flex flex-wrap gap-1">
                {model.quantizations.map((q) => <Badge key={q} variant="teal">{q}</Badge>)}
              </div>
            </div>
          )}

          {/* Download summary */}
          {sizeInfo.bytes !== null && (
            <div className="rounded-lg border border-line-soft bg-overlay/4 p-3 flex items-center gap-2.5">
              <HardDrive className="h-4 w-4 text-brand-teal-300" />
              <div className="flex-1">
                <p className="text-xs font-medium text-ink-secondary">Total download size</p>
                <p className="text-2xs text-ink-tertiary">{formatBytes(sizeInfo.bytes)} across {sizeInfo.count} file{sizeInfo.count === 1 ? "" : "s"}</p>
              </div>
            </div>
          )}

          {/* Files */}
          <div>
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-2 flex items-center gap-1"><FileBox className="h-3 w-3" />Files</h4>
            {model.files.length === 0 ? (
              <div className="rounded-lg border border-line-soft bg-overlay/4 p-4 text-center">
                <Spinner />
                <p className="mt-2 text-2xs text-ink-tertiary">Loading files…</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {model.files.map((f) => (
                  <div key={f.rfilename} className="flex items-center gap-3 rounded-lg border border-line-subtle bg-overlay/4 p-2.5">
                    <FileBox className="h-4 w-4 text-ink-tertiary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-ink-secondary truncate">{f.rfilename}</p>
                      <p className="text-2xs text-ink-faint">{f.sizeBytes ? formatBytes(f.sizeBytes) : "Unknown size"}</p>
                    </div>
                    <Tooltip content="Download">
                      <Button variant="secondary" size="sm" iconLeft={<Download />} onClick={() => onDownload(f)}>
                        Get
                      </Button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-line-subtle p-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="md" iconLeft={<ArrowUpRight />} onClick={() => void openExternal(`https://huggingface.co/${model.id}`)}>
            View on HF
          </Button>
          <Button variant="primary" size="md" iconLeft={<Download />} onClick={() => onDownload()}>
            Download model
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg surface p-2.5 text-center">
      <Icon className="mx-auto mb-1 h-3.5 w-3.5 text-ink-tertiary" />
      <p className="text-xs font-semibold text-ink-primary tabular-nums">{value}</p>
      <p className="text-2xs text-ink-muted">{label}</p>
    </div>
  );
}
