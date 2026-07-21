/**
 * StatusBar — bottom-of-window status strip.
 *
 * Shows: connection status, active model + provider, current token usage,
 * memory pressure, and quick toggles (streaming, theme).
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Cpu,
  Gauge,
  Wifi,
  WifiOff,
  Zap,
  ZapOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { useModelsStore } from "@/store/models";
import { useProvidersStore } from "@/store/providers";
import { useChatStore } from "@/store/chat";
import { useUIStore } from "@/store/ui";
import { getAppMeta, isTauri } from "@/lib/tauri";
import type { AppMeta } from "@/types";

export function StatusBar() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const localModels = useModelsStore((s) => s.local);
  const running = useModelsStore((s) => s.running);
  const providers = useProvidersStore((s) => s.providers);
  const activeThreadId = useUIStore((s) => s.activeThreadId);
  const messages = useChatStore((s) => s.messages);
  const route = useUIStore((s) => s.route);

  const [meta, setMeta] = useState<AppMeta | null>(null);

  useEffect(() => {
    void getAppMeta().then(setMeta);
  }, []);

  const activeProvider = providers.find((p) => p.enabled && p.health?.ok);
  const runningModel = localModels.find((m) => running.includes(m.id));
  const activeMessages = activeThreadId ? messages[activeThreadId] ?? [] : [];
  const tokenCount = activeMessages.reduce((acc, m) => acc + (m.streaming?.tokens ?? Math.ceil(m.content.length / 4)), 0);

  return (
    <footer
      className={cn(
        "relative z-20 flex h-7 items-center gap-3 px-3",
        "glass border-t border-line-subtle",
        "text-2xs text-ink-tertiary",
      )}
    >
      {/* Left — connection status */}
      <div className="flex items-center gap-1.5">
        <span className={cn("relative flex h-1.5 w-1.5")}>
          <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", activeProvider || runningModel ? "bg-status-success animate-ping" : "bg-ink-muted")} />
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", activeProvider || runningModel ? "bg-status-success" : "bg-ink-muted")} />
        </span>
        <span className="font-medium">
          {runningModel ? `Running ${runningModel.name}` : activeProvider ? `${activeProvider.name} ready` : "Idle"}
        </span>
      </div>

      <Divider />

      {/* Active model */}
      <div className="flex items-center gap-1.5">
        <Cpu className="h-3 w-3" />
        <span className="font-medium">
          {runningModel?.name ?? settings.defaultModelId ?? "No model selected"}
        </span>
      </div>

      <Divider />

      {/* Token usage */}
      {route === "chat" && activeMessages.length > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <Gauge className="h-3 w-3" />
            <span className="font-medium tabular-nums">{tokenCount.toLocaleString()} tok</span>
          </div>
          <Divider />
        </>
      )}

      {/* Right-aligned */}
      <div className="ml-auto flex items-center gap-3">
        {meta && (
          <>
            {typeof meta.freeMemoryGb === "number" && (
              <>
                <div className="hidden md:flex items-center gap-1.5">
                  <Activity className="h-3 w-3" />
                  <span className="font-medium tabular-nums">{meta.freeMemoryGb.toFixed(1)} GB free</span>
                </div>
                <Divider />
              </>
            )}
            {typeof meta.cpuCount === "number" && (
              <>
                <div className="hidden lg:flex items-center gap-1.5">
                  <Gauge className="h-3 w-3" />
                  <span className="font-medium tabular-nums">{meta.cpuCount} cores</span>
                </div>
                <Divider />
              </>
            )}
          </>
        )}

        {/* Streaming toggle */}
        <button
          type="button"
          onClick={() => update("streaming", !settings.streaming)}
          className="flex cursor-pointer items-center gap-1.5 hover:text-ink-secondary transition-colors"
          title={settings.streaming ? "Streaming on" : "Streaming off"}
        >
          {settings.streaming ? <Zap className="h-3 w-3 text-brand-teal-300" /> : <ZapOff className="h-3 w-3" />}
          <span className="hidden md:inline">Streaming</span>
        </button>

        <Divider />

        {/* Connection */}
        <div className="flex items-center gap-1.5">
          {isTauri() ? <Wifi className="h-3 w-3 text-status-success" /> : <WifiOff className="h-3 w-3 text-ink-faint" />}
          <span className="hidden md:inline">{isTauri() ? "Native" : "Browser"}</span>
        </div>

        <Divider />

        <span className="hidden lg:inline font-medium">v{meta?.version ?? "1.0.0"}</span>
      </div>
    </footer>
  );
}

function Divider() {
  return <motion.span initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} className="h-3 w-px bg-line-subtle" />;
}
