/**
 * AppShell — the outermost chrome of Xirea.
 *
 * Composes: TopBar, Resizable(Sidebar | Workspace), optional ActivityPanel,
 * StatusBar, plus the overlay layers (CommandPalette, ContextMenu, Toast).
 */
import { Suspense } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Resizable } from "./Resizable";
import { ActivityPanel } from "./ActivityPanel";
import { CommandPalette } from "./CommandPalette";
import { ContextMenuLayer } from "@/components/ui/ContextMenu";
import { ToastLayer } from "@/components/ui/Toast";
import { DialogLayer } from "@/components/ui/DialogLayer";
import { useUIStore } from "@/store/ui";
import { useSettingsStore, applyTheme, applyAppearance, watchSystemTheme } from "@/store/settings";
import { useEffect } from "react";
import { WorkspaceRouter } from "@/app/WorkspaceRouter";
import { Spinner } from "@/components/ui/Spinner";

export function AppShell() {
  const activityPanelOpen = useUIStore((s) => s.activityPanelOpen);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  // Use stable primitive selectors — returning a new object literal from a
  // Zustand selector breaks useSyncExternalStore's caching invariant.
  const theme = useSettingsStore((s) => s.settings.theme);
  const accent = useSettingsStore((s) => s.settings.accent);
  const density = useSettingsStore((s) => s.settings.density);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const messageSpacing = useSettingsStore((s) => s.settings.messageSpacing);
  const reduceMotion = useSettingsStore((s) => s.settings.reduceMotion);
  const animations = useSettingsStore((s) => s.settings.animations);

  useEffect(() => {
    applyTheme(theme, accent);
    const unsub = watchSystemTheme(() => {
      if (theme === "system") applyTheme("system", accent);
    });
    return unsub;
  }, [theme, accent]);

  // Apply appearance-related settings whenever any of them changes.
  useEffect(() => {
    applyAppearance({ density, fontSize, messageSpacing, reduceMotion, animations });
  }, [density, fontSize, messageSpacing, reduceMotion, animations]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-midnight text-ink-primary">
      {/* Ambient brand glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-aurora opacity-70" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-noise opacity-[0.025]" />

      <TopBar />

      <div className="flex min-h-0 flex-1">
        <Resizable
          storageKey="sidebar"
          defaultSize={280}
          min={220}
          max={420}
          collapsed={sidebarCollapsed}
          collapsedSize={56}
          className="flex-1 min-w-0"
        >
          <Sidebar />
          <Suspense fallback={<WorkspaceSkeleton />}>
            <WorkspaceRouter />
          </Suspense>
        </Resizable>

        {activityPanelOpen && <ActivityPanel />}
      </div>

      <StatusBar />

      {/* Overlay layers */}
      <CommandPalette />
      <ContextMenuLayer />
      <DialogLayer />
      <ToastLayer />
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Spinner />
    </div>
  );
}
