/**
 * FilesView — file library with grid/list view, pinned, recent.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  FileArchive,
  FileAudio,
  FileVideo,
  File as FileIcon,
  Pin,
  Trash2,
  Search,
  Grid3x3,
  List as ListIcon,
  Plus,
  Clock,
  Star,
  FileCode,
  FileType2,
  ExternalLink,
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
import { useFilesStore } from "@/store/files";
import { useUIStore } from "@/store/ui";
import { pickFile, fileMetadata, revealInFinder } from "@/lib/tauri";
import type { FileEntry } from "@/types";

type View = "grid" | "list";
type Tab = "all" | "pinned" | "recent";

const KIND_ICON: Record<FileEntry["kind"], React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  pdf: FileText,
  document: FileType2,
  spreadsheet: FileSpreadsheet,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  code: FileCode,
  text: FileText,
  other: FileIcon,
};

const KIND_COLOR: Record<FileEntry["kind"], string> = {
  image: "from-brand-fuchsia-500/15 to-brand-fuchsia-500/5 text-brand-fuchsia-300",
  pdf: "from-status-danger/15 to-status-danger/5 text-status-danger",
  document: "from-brand-indigo-500/15 to-brand-indigo-500/5 text-brand-indigo-300",
  spreadsheet: "from-status-success/15 to-status-success/5 text-status-success",
  archive: "from-amber-500/15 to-amber-500/5 text-amber-300",
  audio: "from-brand-teal-500/15 to-brand-teal-500/5 text-brand-teal-300",
  video: "from-purple-500/15 to-purple-500/5 text-purple-300",
  code: "from-sky-500/15 to-sky-500/5 text-sky-300",
  text: "from-slate-500/15 to-slate-500/5 text-slate-300",
  other: "from-slate-500/15 to-slate-500/5 text-slate-300",
};

export function FilesView() {
  const files = useFilesStore((s) => s.files);
  const add = useFilesStore((s) => s.add);
  const remove = useFilesStore((s) => s.remove);
  const togglePin = useFilesStore((s) => s.togglePin);
  const markOpened = useFilesStore((s) => s.markOpened);
  const pushToast = useUIStore((s) => s.pushToast);

  const [view, setView] = useState<View>("grid");
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let list = [...files];
    if (tab === "pinned") list = list.filter((f) => f.pinned);
    if (tab === "recent") list = list.filter((f) => f.lastOpenedAt).sort((a, b) => new Date(b.lastOpenedAt!).getTime() - new Date(a.lastOpenedAt!).getTime());
    if (query) list = list.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
    return list;
  }, [files, tab, query]);

  const handlePick = async () => {
    const picked = await pickFile({
      multiple: true,
      title: "Add files to library",
      filters: [
        { name: "All supported", extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "csv", "zip", "mp3", "mp4", "md", "txt", "json", "ts", "tsx", "py"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    let added = 0;
    for (const p of paths) {
      try {
        const meta = await fileMetadata(p);
        if (!meta.exists) continue;
        add({
          name: meta.name,
          path: p,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          kind: meta.kind as FileEntry["kind"],
        });
        added++;
      } catch (e) {
        console.error("Failed to read file metadata:", p, e);
      }
    }
    if (added > 0) {
      pushToast({ title: `Added ${added} file(s)`, variant: "success" });
    } else {
      pushToast({ title: "No files added", description: "Could not read the selected files.", variant: "warning" });
    }
  };

  const totalSize = files.reduce((acc, f) => acc + f.sizeBytes, 0);
  const pinnedCount = files.filter((f) => f.pinned).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line-subtle px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-display text-ink-primary">Files</h1>
              <Badge variant="brand">{files.length}</Badge>
              <Badge variant="default">{formatBytes(totalSize)}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-tertiary">
              Your local file library. Attach files to chats, preview them inline, and pin the ones you reach for often.
            </p>
          </div>
          <Button variant="primary" iconLeft={<Plus />} onClick={() => void handlePick()}>
            Add files
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Tabs
            items={[
              { id: "all", label: "All", icon: <FileIcon className="h-3.5 w-3.5" /> },
              { id: "pinned", label: "Pinned", icon: <Pin className="h-3.5 w-3.5" />, badge: pinnedCount ? <Badge variant="fuchsia">{pinnedCount}</Badge> : undefined },
              { id: "recent", label: "Recent", icon: <Clock className="h-3.5 w-3.5" /> },
            ]}
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            variant="underline"
          />
          <div className="flex items-center gap-2">
            <div className="w-56">
              <Input iconLeft={<Search />} placeholder="Filter files…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Tabs
              items={[
                { id: "grid", label: "", icon: <Grid3x3 className="h-3.5 w-3.5" /> },
                { id: "list", label: "", icon: <ListIcon className="h-3.5 w-3.5" /> },
              ]}
              value={view}
              onChange={(v) => setView(v as View)}
              variant="segmented"
              size="sm"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title={files.length === 0 ? "Your library is empty" : "Nothing matches"}
            description={files.length === 0 ? "Add files from disk to attach them to chats, preview them inline, and pin the ones you use often." : `No files match “${query}”. Try a different filter.`}
            action={<Button variant="primary" iconLeft={<Plus />} onClick={() => void handlePick()}>Add files</Button>}
            size="lg"
          />
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((f) => (
              <FileGridCard
                key={f.id}
                file={f}
                onOpen={() => markOpened(f.id)}
                onPin={() => togglePin(f.id)}
                onRemove={() => remove(f.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((f) => (
              <FileListRow
                key={f.id}
                file={f}
                onOpen={() => markOpened(f.id)}
                onPin={() => togglePin(f.id)}
                onRemove={() => remove(f.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileGridCard({ file, onOpen, onPin, onRemove }: { file: FileEntry; onOpen: () => void; onPin: () => void; onRemove: () => void }) {
  const Icon = KIND_ICON[file.kind];
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
      <Card hover padded={false} className="overflow-hidden group">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <div className={cn("relative aspect-[4/3] grid place-items-center bg-gradient-to-br", KIND_COLOR[file.kind])}>
            <Icon className="h-9 w-9 opacity-80" />
            {file.pinned && (
              <span className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-md bg-status-danger/15 backdrop-blur-sm">
                <Star className="h-3 w-3 text-brand-fuchsia-300 fill-current" />
              </span>
            )}
          </div>
          <div className="p-2.5">
            <p className="truncate text-xs font-semibold text-ink-primary">{file.name}</p>
            <div className="mt-0.5 flex items-center justify-between text-2xs text-ink-faint">
              <span>{formatBytes(file.sizeBytes)}</span>
              <span>{file.lastOpenedAt ? formatRelativeTime(file.lastOpenedAt) : formatRelativeTime(file.addedAt)}</span>
            </div>
          </div>
        </button>
        <div className="absolute top-2 left-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton label={file.pinned ? "Unpin" : "Pin"} size="xs" variant="subtle" onClick={onPin} active={file.pinned}>
            <Pin className={cn(file.pinned && "fill-current text-brand-fuchsia-300")} />
          </IconButton>
          <IconButton label="Delete" size="xs" variant="subtle" onClick={onRemove} className="hover:text-status-danger">
            <Trash2 />
          </IconButton>
        </div>
      </Card>
    </motion.div>
  );
}

function FileListRow({ file, onOpen, onPin, onRemove }: { file: FileEntry; onOpen: () => void; onPin: () => void; onRemove: () => void }) {
  const Icon = KIND_ICON[file.kind];
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      <div className="group flex items-center gap-3 rounded-xl border border-line-subtle bg-surface-raised/40 p-2.5 hover:border-line-soft hover:bg-surface-hover transition-colors">
        <button type="button" onClick={onOpen} className="flex flex-1 items-center gap-3 min-w-0 text-left">
          <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br", KIND_COLOR[file.kind])}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-primary">{file.name}</p>
            <p className="text-2xs text-ink-faint truncate">{file.path}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 text-2xs text-ink-muted shrink-0">
            <span className="tabular-nums">{formatBytes(file.sizeBytes)}</span>
            <span>{file.lastOpenedAt ? `opened ${formatRelativeTime(file.lastOpenedAt)}` : formatRelativeTime(file.addedAt)}</span>
          </div>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip content="Reveal in file manager">
            <IconButton label="Reveal" size="xs" variant="ghost" onClick={() => void revealInFinder(file.path)}>
              <ExternalLink />
            </IconButton>
          </Tooltip>
          <IconButton label={file.pinned ? "Unpin" : "Pin"} size="xs" variant="ghost" onClick={onPin} active={file.pinned}>
            <Pin className={cn(file.pinned && "fill-current text-brand-fuchsia-300")} />
          </IconButton>
          <IconButton label="Delete" size="xs" variant="ghost" onClick={onRemove} className="hover:text-status-danger">
            <Trash2 />
          </IconButton>
        </div>
      </div>
    </motion.div>
  );
}

