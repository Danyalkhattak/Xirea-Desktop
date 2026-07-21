/**
 * DownloadsView — download manager with real progress, pause/resume/retry/cancel,
 * queue reordering, and SHA-256 verification.
 *
 * Every value displayed comes from a real event:
 *   - receivedBytes / totalBytes / speedBps / etaSeconds — emitted by the
 *     Rust downloader (`download-progress` events, with the download id in
 *     the payload).
 *   - verification status (verified / corrupted) — set after the download
 *     completes, via `verify_download` (real SHA-256 + size check).
 *   - queue order — manipulated by the user via the up/down/top/bottom
 *     buttons in each row.
 *
 * No mock values, no fake progress bars.
 */
import { motion } from "framer-motion";
import {
  Download,
  Pause,
  Play,
  RotateCw,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  HardDrive,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { cn, formatBytes, formatEta, formatSpeed } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDownloadsStore, selectQueues } from "@/store/downloads";
import { useUIStore } from "@/store/ui";
import type { DownloadTask } from "@/types";

export function DownloadsView() {
  const tasks = useDownloadsStore((s) => s.tasks);
  const pause = useDownloadsStore((s) => s.pause);
  const resume = useDownloadsStore((s) => s.resume);
  const cancel = useDownloadsStore((s) => s.cancel);
  const retry = useDownloadsStore((s) => s.retry);
  const remove = useDownloadsStore((s) => s.remove);
  const clearCompleted = useDownloadsStore((s) => s.clearCompleted);
  const reorder = useDownloadsStore((s) => s.reorder);
  const setRoute = useUIStore((s) => s.setRoute);

  const { active, queued, completed, failed } = selectQueues(tasks);

  const totalReceived = tasks.reduce((acc, t) => acc + t.receivedBytes, 0);
  const totalSize = tasks.reduce((acc, t) => acc + (t.totalBytes ?? 0), 0);
  const totalSpeed = active.reduce((acc, t) => acc + (t.speedBps ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line-subtle px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-display text-ink-primary">Downloads</h1>
              {active.length > 0 && <Badge variant="success" dot>{active.length} active</Badge>}
              {queued.length > 0 && <Badge>{queued.length} queued</Badge>}
              {failed.length > 0 && <Badge variant="danger" dot>{failed.length} failed</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-tertiary">
              Track model and file downloads. Pause, resume, retry, cancel, or reorder the queue. SHA-256 verification runs automatically after each download.
            </p>
          </div>
          {completed.length + failed.length > 0 && (
            <Button variant="secondary" iconLeft={<Trash2 />} onClick={clearCompleted}>
              Clear finished
            </Button>
          )}
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryTile icon={Download} label="Active" value={String(active.length)} accent="brand" />
          <SummaryTile icon={HardDrive} label="Downloaded" value={formatBytes(totalReceived)} accent="teal" />
          <SummaryTile icon={Clock} label="Total size" value={formatBytes(totalSize)} accent="default" />
          <SummaryTile icon={RotateCw} label="Speed" value={totalSpeed > 0 ? formatSpeed(totalSpeed) : "—"} accent="indigo" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tasks.length === 0 ? (
          <EmptyState
            icon={<Download className="h-7 w-7" />}
            title="No downloads yet"
            description="Models and files you download will appear here. Browse Hugging Face to find your first model."
            action={<Button variant="primary" iconLeft={<Download />} onClick={() => setRoute("huggingface")}>Browse Hugging Face</Button>}
            size="lg"
          />
        ) : (
          <div className="space-y-3">
            {active.length > 0 && (
              <Section title="In progress" badge={<Badge variant="success" dot>{active.length}</Badge>}>
                {active.map((t, i) => (
                  <DownloadRow
                    key={t.id}
                    task={t}
                    canMoveUp={i > 0}
                    canMoveDown={i < active.length - 1}
                    onPause={() => void pause(t.id)}
                    onResume={() => void resume(t.id)}
                    onCancel={() => void cancel(t.id)}
                    onRetry={() => void retry(t.id)}
                    onRemove={() => remove(t.id)}
                    onMoveUp={() => reorder(t.id, "up")}
                    onMoveDown={() => reorder(t.id, "down")}
                    onMoveTop={() => reorder(t.id, "top")}
                    onMoveBottom={() => reorder(t.id, "bottom")}
                  />
                ))}
              </Section>
            )}
            {queued.length > 0 && (
              <Section title="Queued / paused" badge={<Badge>{queued.length}</Badge>}>
                {queued.map((t, i) => (
                  <DownloadRow
                    key={t.id}
                    task={t}
                    canMoveUp={i > 0}
                    canMoveDown={i < queued.length - 1}
                    onPause={() => void pause(t.id)}
                    onResume={() => void resume(t.id)}
                    onCancel={() => void cancel(t.id)}
                    onRetry={() => void retry(t.id)}
                    onRemove={() => remove(t.id)}
                    onMoveUp={() => reorder(t.id, "up")}
                    onMoveDown={() => reorder(t.id, "down")}
                    onMoveTop={() => reorder(t.id, "top")}
                    onMoveBottom={() => reorder(t.id, "bottom")}
                  />
                ))}
              </Section>
            )}
            {failed.length > 0 && (
              <Section title="Failed / corrupted" badge={<Badge variant="danger" dot>{failed.length}</Badge>}>
                {failed.map((t) => (
                  <DownloadRow
                    key={t.id}
                    task={t}
                    canMoveUp={false}
                    canMoveDown={false}
                    onPause={() => void pause(t.id)}
                    onResume={() => void resume(t.id)}
                    onCancel={() => void cancel(t.id)}
                    onRetry={() => void retry(t.id)}
                    onRemove={() => remove(t.id)}
                    onMoveUp={() => reorder(t.id, "up")}
                    onMoveDown={() => reorder(t.id, "down")}
                    onMoveTop={() => reorder(t.id, "top")}
                    onMoveBottom={() => reorder(t.id, "bottom")}
                  />
                ))}
              </Section>
            )}
            {completed.length > 0 && (
              <Section title="Completed" badge={<Badge variant="teal" dot>{completed.length}</Badge>}>
                {completed.map((t) => (
                  <DownloadRow
                    key={t.id}
                    task={t}
                    canMoveUp={false}
                    canMoveDown={false}
                    onPause={() => void pause(t.id)}
                    onResume={() => void resume(t.id)}
                    onCancel={() => void cancel(t.id)}
                    onRetry={() => void retry(t.id)}
                    onRemove={() => remove(t.id)}
                    onMoveUp={() => reorder(t.id, "up")}
                    onMoveDown={() => reorder(t.id, "down")}
                    onMoveTop={() => reorder(t.id, "top")}
                    onMoveBottom={() => reorder(t.id, "bottom")}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
        {badge}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DownloadRow({
  task,
  canMoveUp,
  canMoveDown,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
  onMoveUp,
  onMoveDown,
  onMoveTop,
  onMoveBottom,
}: {
  task: DownloadTask;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTop: () => void;
  onMoveBottom: () => void;
}) {
  const pct = task.totalBytes ? Math.min(100, (task.receivedBytes / task.totalBytes) * 100) : 0;
  const isDone = task.state === "completed" || task.state === "verified";
  const isFailed = task.state === "failed" || task.state === "cancelled";
  const isPaused = task.state === "paused";
  const isVerifying = task.state === "verifying";
  const isCorrupted = task.state === "corrupted";
  const isVerified = task.state === "verified";
  const isQueued = task.state === "queued";
  const isActive = task.state === "downloading" || isVerifying;

  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center gap-3 p-3.5">
          <div className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl border",
            isVerified ? "bg-status-success/10 border-status-success/20 text-status-success" :
            isCorrupted ? "bg-status-danger/10 border-status-danger/20 text-status-danger" :
            isDone ? "bg-status-success/10 border-status-success/20 text-status-success" :
            isFailed ? "bg-status-danger/10 border-status-danger/20 text-status-danger" :
            isPaused ? "bg-status-warning/10 border-status-warning/20 text-status-warning" :
            isVerifying ? "bg-brand-teal-500/10 border-brand-teal-400/20 text-brand-teal-300" :
            "bg-brand-indigo-500/10 border-brand-indigo-400/20 text-brand-indigo-300",
          )}>
            {isVerifying ? <Loader2 className="h-5 w-5 animate-spin" /> :
             isVerified ? <ShieldCheck className="h-5 w-5" /> :
             isCorrupted ? <ShieldAlert className="h-5 w-5" /> :
             isDone ? <CheckCircle2 className="h-5 w-5" /> :
             isFailed ? <AlertCircle className="h-5 w-5" /> :
             <Download className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-ink-primary">{task.name}</p>
              <StateBadge state={task.state} />
            </div>
            <p className="text-2xs text-ink-faint truncate">{task.targetPath}</p>
            {/* Verification details */}
            {isVerified && task.actualSha256 && (
              <div className="mt-1 flex items-center gap-1 text-2xs text-status-success">
                <Shield className="h-2.5 w-2.5" />
                <span>SHA-256 verified</span>
              </div>
            )}
            {isCorrupted && (
              <div className="mt-1 flex items-center gap-1 text-2xs text-status-danger">
                <ShieldAlert className="h-2.5 w-2.5" />
                <span>{task.verificationError ?? "Verification failed"}</span>
              </div>
            )}
            {task.error && isFailed && (
              <p className="mt-1 text-2xs text-status-danger/80 truncate">{task.error}</p>
            )}
          </div>
          {/* Queue controls — only shown for queued / active tasks. */}
          {(isQueued || isActive) && (
            <div className="flex items-center gap-0.5 shrink-0">
              <QueueButton label="Move to top" icon={ChevronsUp} onClick={onMoveTop} disabled={!canMoveUp} />
              <QueueButton label="Move up" icon={ChevronUp} onClick={onMoveUp} disabled={!canMoveUp} />
              <QueueButton label="Move down" icon={ChevronDown} onClick={onMoveDown} disabled={!canMoveDown} />
              <QueueButton label="Move to bottom" icon={ChevronsDown} onClick={onMoveBottom} disabled={!canMoveDown} />
            </div>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {!isDone && !isFailed && !isCorrupted && !isVerifying && (
              <>
                {isPaused || isQueued ? (
                  <IconButton label="Resume" size="sm" variant="ghost" onClick={onResume}><Play /></IconButton>
                ) : (
                  <IconButton label="Pause" size="sm" variant="ghost" onClick={onPause}><Pause /></IconButton>
                )}
                <IconButton label="Cancel" size="sm" variant="ghost" onClick={onCancel} className="hover:text-status-danger"><X /></IconButton>
              </>
            )}
            {(isFailed || isCorrupted) && <IconButton label="Retry" size="sm" variant="ghost" onClick={onRetry}><RotateCw /></IconButton>}
            {(isDone || isFailed || isCorrupted || isVerified) && (
              <IconButton label="Remove" size="sm" variant="ghost" onClick={onRemove} className="hover:text-status-danger"><Trash2 /></IconButton>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div className="px-3.5 pb-3.5">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-overlay/6">
            <motion.div
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={cn(
                "h-full rounded-full",
                isVerified ? "bg-gradient-to-r from-status-success to-brand-teal-400" :
                isCorrupted ? "bg-gradient-to-r from-status-danger to-rose-400" :
                isDone ? "bg-gradient-to-r from-status-success to-brand-teal-400" :
                isFailed ? "bg-gradient-to-r from-status-danger to-rose-400" :
                isPaused ? "bg-status-warning" :
                isVerifying ? "bg-gradient-to-r from-brand-teal-400 to-brand-indigo-400" :
                "bg-gradient-to-r from-brand-indigo-400 to-brand-indigo-500",
              )}
            />
            {isActive && !isVerifying && task.totalBytes && (
              <motion.div
                className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-overlay/4000 to-transparent"
                animate={{ x: ["-64px", "100%"] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
              />
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-muted">
            <span className="tabular-nums">
              {formatBytes(task.receivedBytes)} / {task.totalBytes ? formatBytes(task.totalBytes) : "—"}
              {task.speedBps && isActive && !isVerifying && ` · ${formatSpeed(task.speedBps)}`}
              {task.etaSeconds && isActive && !isVerifying && ` · ${formatEta(task.etaSeconds)} left`}
              {isVerifying && " · verifying…"}
            </span>
            <span className="tabular-nums font-medium">{pct.toFixed(1)}%</span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function StateBadge({ state }: { state: DownloadTask["state"] }) {
  const map: Record<DownloadTask["state"], { variant: "default" | "success" | "danger" | "warning" | "brand" | "teal"; label: string }> = {
    queued: { variant: "default", label: "queued" },
    downloading: { variant: "brand", label: "downloading" },
    paused: { variant: "warning", label: "paused" },
    verifying: { variant: "teal", label: "verifying" },
    verified: { variant: "success", label: "verified" },
    completed: { variant: "success", label: "completed" },
    failed: { variant: "danger", label: "failed" },
    cancelled: { variant: "default", label: "cancelled" },
    corrupted: { variant: "danger", label: "corrupted" },
  };
  const cfg = map[state];
  return <Badge variant={cfg.variant} dot>{cfg.label}</Badge>;
}

function QueueButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "grid h-6 w-6 place-items-center rounded text-ink-muted transition-colors",
        disabled ? "opacity-30 cursor-not-allowed" : "hover:text-ink-primary hover:bg-overlay/4 cursor-pointer",
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

function SummaryTile({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent: "brand" | "teal" | "indigo" | "default" }) {
  return (
    <div className="rounded-xl surface p-3 flex items-center gap-3">
      <div className={cn(
        "grid h-8 w-8 place-items-center rounded-lg",
        accent === "brand" && "bg-brand-indigo-500/15 text-brand-indigo-300",
        accent === "teal" && "bg-brand-teal-500/15 text-brand-teal-300",
        accent === "indigo" && "bg-brand-indigo-500/15 text-brand-indigo-300",
        accent === "default" && "bg-overlay/4 text-ink-tertiary",
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xs text-ink-muted uppercase tracking-wider">{label}</p>
        <p className="text-sm font-semibold text-ink-primary tabular-nums">{value}</p>
      </div>
    </div>
  );
}
