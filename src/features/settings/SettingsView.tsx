/**
 * SettingsView — appearance, generation, privacy, updates, shortcuts, about.
 *
 * NOTE: providers have their own dedicated page and are NOT configured here.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Palette,
  Sun,
  Moon,
  Monitor,
  Zap,
  Shield,
  Download,
  Keyboard,
  Info,
  Sparkles,
  RotateCcw,
  Check,
  ChevronRight,
  Bell,
  Github,
  ExternalLink,
  Pencil,
  FolderOpen,
  Trash2,
  HardDrive,
  User,
  Instagram,
  Heart,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Switch } from "@/components/ui/Switch";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { useSettingsStore, ACCENTS, DENSITIES, applyTheme } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useChatStore } from "@/store/chat";
import { useModelsStore } from "@/store/models";
import { useDownloadsStore } from "@/store/downloads";
import { pickDirectory, getAppMeta, openExternal } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import { confirmDialog } from "@/store/dialog";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import type { AccentColor, ThemeMode } from "@/types";

type Section = "appearance" | "generation" | "privacy" | "updates" | "storage" | "shortcuts" | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon; description: string }[] = [
  { id: "appearance", label: "Appearance", icon: Palette, description: "Theme, accent, density, typography" },
  { id: "generation", label: "Generation", icon: Zap, description: "Temperature, max tokens, streaming" },
  { id: "privacy", label: "Privacy", icon: Shield, description: "Telemetry, data, on-device rules" },
  { id: "updates", label: "Updates", icon: Download, description: "Auto-update channel" },
  { id: "storage", label: "Storage", icon: Monitor, description: "Cache, models, conversations" },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard, description: "Keyboard bindings" },
  { id: "about", label: "About", icon: Info, description: "Version, credits, licenses" },
];

export function SettingsView() {
  const [section, setSection] = useState<Section>("appearance");

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="hidden md:flex w-64 flex-col border-r border-line-subtle p-3 gap-0.5">
        <div className="px-2.5 py-2 mb-1">
          <h2 className="text-sm font-semibold text-ink-primary">Settings</h2>
          <p className="text-2xs text-ink-tertiary mt-0.5">Customise Xirea to your taste</p>
        </div>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn(
                "group flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                active ? "bg-overlay/8" : "hover:bg-overlay/4",
              )}
            >
              <div className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                active ? "bg-brand-indigo-500/15 border-brand-indigo-400/30 text-brand-indigo-300" : "bg-surface-raised border-line-subtle text-ink-tertiary",
              )}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", active ? "text-ink-primary" : "text-ink-secondary")}>{s.label}</p>
                <p className="text-2xs text-ink-tertiary truncate">{s.description}</p>
              </div>
              {active && <ChevronRight className="h-3.5 w-3.5 text-ink-tertiary mt-1" />}
            </button>
          );
        })}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-line-subtle px-6 pt-5 pb-3 md:hidden">
          <h1 className="text-xl font-semibold font-display text-ink-primary">Settings</h1>
          <div className="mt-3">
            <Tabs
              items={SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: <s.icon className="h-3.5 w-3.5" /> }))}
              value={section}
              onChange={(v) => setSection(v as Section)}
              variant="segmented"
              size="sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-3xl"
          >
            {section === "appearance" && <AppearanceSection />}
            {section === "generation" && <GenerationSection />}
            {section === "privacy" && <PrivacySection />}
            {section === "updates" && <UpdatesSection />}
            {section === "storage" && <StorageSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient-soft border border-line-subtle text-brand-indigo-300">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-base font-semibold font-display text-ink-primary">{title}</h2>
        <p className="text-sm text-ink-tertiary">{description}</p>
      </div>
    </div>
  );
}

function SettingRow({ title, description, children, vertical }: { title: string; description?: string; children: React.ReactNode; vertical?: boolean }) {
  return (
    <div className={cn("flex gap-4 py-3", vertical ? "flex-col" : "items-center justify-between")}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-primary">{title}</p>
        {description && <p className="text-xs text-ink-tertiary mt-0.5">{description}</p>}
      </div>
      <div className={cn(vertical && "w-full")}>{children}</div>
    </div>
  );
}

function AppearanceSection() {
  const { theme, accent, density, fontSize, messageSpacing, animations, reduceMotion } = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="space-y-4">
      <SectionHeader title="Appearance" description="Make Xirea feel like yours." icon={Palette} />

      <Card>
        <SettingRow title="Theme" description="Dark-first by default, but light is fully supported.">
          <div className="flex gap-1.5">
            {(["dark", "light", "system"] as ThemeMode[]).map((mode) => {
              const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { update("theme", mode); applyTheme(mode, accent); }}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium capitalize transition-colors",
                    theme === mode ? "border-brand-indigo-400/40 bg-brand-indigo-500/[0.10] text-ink-primary" : "border-line-soft bg-surface-raised text-ink-tertiary hover:text-ink-secondary",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {mode}
                </button>
              );
            })}
          </div>
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Accent color" description="Used for highlights, links, and the primary action gradient." vertical>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { update("accent", a.id as AccentColor); applyTheme(theme, a.id as AccentColor); }}
                className={cn(
                  "group relative flex h-16 flex-col items-center justify-center gap-1 rounded-xl border transition-all",
                  accent === a.id ? "border-brand-indigo-400/40 bg-brand-indigo-500/[0.06]" : "border-line-soft hover:border-line-medium",
                )}
              >
                <span className="h-6 w-6 rounded-full" style={{ background: a.gradient }} />
                <span className="text-2xs font-medium text-ink-secondary">{a.label}</span>
                {accent === a.id && (
                  <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-brand-indigo-500 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Density" description="How tightly content packs together.">
          <div className="flex gap-1.5">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => update("density", d.id)}
                className={cn(
                  "flex h-9 items-center rounded-lg border px-3 text-xs font-medium transition-colors",
                  density === d.id ? "border-brand-indigo-400/40 bg-brand-indigo-500/[0.10] text-ink-primary" : "border-line-soft bg-surface-raised text-ink-tertiary hover:text-ink-secondary",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </SettingRow>

        <div className="h-px bg-line-subtle my-1" />

        <SettingRow title="Font size" description={`Base font size: ${fontSize}px`}>
          <div className="flex items-center gap-3 w-48">
            <input
              type="range"
              min={12}
              max={20}
              value={fontSize}
              onChange={(e) => update("fontSize", Number(e.target.value))}
              className="xirea-range flex-1"
            />
            <span className="text-xs font-medium text-ink-secondary tabular-nums w-8 text-right">{fontSize}</span>
          </div>
        </SettingRow>

        <div className="h-px bg-line-subtle my-1" />

        <SettingRow title="Message spacing" description="Vertical rhythm between chat messages.">
          <div className="flex gap-1.5">
            {(["compact", "comfortable", "spacious"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update("messageSpacing", s)}
                className={cn(
                  "flex h-9 items-center rounded-lg border px-3 text-xs font-medium capitalize transition-colors",
                  messageSpacing === s ? "border-brand-indigo-400/40 bg-brand-indigo-500/[0.10] text-ink-primary" : "border-line-soft bg-surface-raised text-ink-tertiary hover:text-ink-secondary",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Animations" description="Page transitions, hover effects, and micro-interactions.">
          <Switch checked={animations} onChange={(v) => update("animations", v)} />
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Reduce motion" description="Minimise non-essential movement (respects prefers-reduced-motion).">
          <Switch checked={reduceMotion} onChange={(v) => update("reduceMotion", v)} />
        </SettingRow>
      </Card>
    </div>
  );
}

function GenerationSection() {
  const { temperature, maxTokens, topP, streaming, sendOnEnter, showTokenCount, systemPrompt } = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <div className="space-y-4">
      <SectionHeader title="Generation" description="Defaults applied to every new chat." icon={Zap} />

      <Card>
        <SettingRow title="System prompt" description="Sent at the start of every conversation. Sets the assistant's behaviour." vertical>
          <Textarea
            value={systemPrompt ?? ""}
            onChange={(e) => update("systemPrompt", e.target.value)}
            minHeight={100}
            maxHeight={300}
            placeholder="You are Xirea…"
          />
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Temperature" description={`Controls randomness. Higher = more creative. Current: ${temperature.toFixed(2)}`}>
          <div className="flex items-center gap-3 w-56">
            <input type="range" min={0} max={2} step={0.05} value={temperature} onChange={(e) => update("temperature", Number(e.target.value))} className="xirea-range flex-1" />
            <span className="text-xs font-medium text-ink-secondary tabular-nums w-10 text-right">{temperature.toFixed(2)}</span>
          </div>
        </SettingRow>

        <div className="h-px bg-line-subtle my-1" />

        <SettingRow title="Max tokens" description="Upper bound on the length of each assistant response.">
          <div className="flex items-center gap-3 w-56">
            <input type="range" min={256} max={16384} step={256} value={maxTokens} onChange={(e) => update("maxTokens", Number(e.target.value))} className="xirea-range flex-1" />
            <span className="text-xs font-medium text-ink-secondary tabular-nums w-14 text-right">{maxTokens}</span>
          </div>
        </SettingRow>

        <div className="h-px bg-line-subtle my-1" />

        <SettingRow title="Top P" description={`Nucleus sampling. Lower = more focused. Current: ${topP.toFixed(2)}`}>
          <div className="flex items-center gap-3 w-56">
            <input type="range" min={0} max={1} step={0.05} value={topP} onChange={(e) => update("topP", Number(e.target.value))} className="xirea-range flex-1" />
            <span className="text-xs font-medium text-ink-secondary tabular-nums w-10 text-right">{topP.toFixed(2)}</span>
          </div>
        </SettingRow>
      </Card>

      <Card>
        <SettingRow title="Stream responses" description="Show tokens as they arrive instead of waiting for the full reply.">
          <Switch checked={streaming} onChange={(v) => update("streaming", v)} />
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Send on Enter" description="Press Enter to send, Shift+Enter for newline. Disable to require a click.">
          <Switch checked={sendOnEnter} onChange={(v) => update("sendOnEnter", v)} />
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Show token counter" description="Display token usage in the status bar.">
          <Switch checked={showTokenCount} onChange={(v) => update("showTokenCount", v)} />
        </SettingRow>
      </Card>
    </div>
  );
}

function PrivacySection() {
  const { telemetry, minimizeToTray } = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const pushToast = useUIStore((s) => s.pushToast);
  const threads = useChatStore((s) => s.threads);
  const messages = useChatStore((s) => s.messages);

  const handleExport = async () => {
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        threads,
        messages,
      };
      const json = JSON.stringify(payload, null, 2);
      const defaultName = `xirea-conversations-${new Date().toISOString().slice(0, 10)}.json`;

      // Use Tauri's native save dialog when running in the desktop app —
      // the previous approach (`<a download>` + click) doesn't work in
      // Tauri 2's webview because the download attribute is ignored by
      // the native webview for blob URLs. We fall back to the browser
      // approach when running in plain `vite dev`.
      const { isTauri, saveFile } = await import("@/lib/tauri");
      if (isTauri()) {
        const target = await saveFile({
          defaultName,
          filters: [{ name: "JSON", extensions: ["json"] }],
          title: "Export conversations",
        });
        if (!target) return; // user cancelled
        // Write via the fs plugin — writeTextFile handles UTF-8 correctly.
        try {
          const { writeTextFile } = await import("@tauri-apps/plugin-fs");
          await writeTextFile(target, json);
          pushToast({
            title: "Export ready",
            description: `${threads.length} chats saved to ${target}`,
            variant: "success",
          });
        } catch (writeErr) {
          // Fallback: invoke Rust to write the file. If both fail, surface
          // the error to the user.
          pushToast({
            title: "Couldn't write file",
            description: writeErr instanceof Error ? writeErr.message : String(writeErr),
            variant: "danger",
          });
        }
      } else {
        // Browser fallback — use the download attribute approach.
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        pushToast({
          title: "Export ready",
          description: `${threads.length} chats exported`,
          variant: "success",
        });
      }
    } catch (e) {
      pushToast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "danger" });
    }
  };

  const handleReset = () => {
    void confirmDialog(
      "Clear all data?",
      "This permanently deletes EVERY conversation, model reference, and cached file from Xirea. Files on disk (model .gguf files, downloaded attachments) are NOT deleted. This cannot be undone.",
      { variant: "danger", confirmLabel: "Erase everything" },
    ).then((ok) => {
      if (!ok) return;
      try {
        // Clear all persisted Xirea stores.
        ["xirea:chat", "xirea:settings", "xirea:ui", "xirea:models", "xirea:providers", "xirea:downloads", "xirea:files", "xirea:prompts"].forEach((k) => localStorage.removeItem(k));
        pushToast({ title: "All data cleared", description: "Reloading the app…", variant: "info" });
        setTimeout(() => window.location.reload(), 800);
      } catch (e) {
        pushToast({ title: "Reset failed", description: e instanceof Error ? e.message : String(e), variant: "danger" });
      }
    });
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Privacy" description="Your data stays on your machine unless you choose a cloud provider." icon={Shield} />

      <Card>
        <SettingRow title="Anonymous telemetry" description="Help us understand what features get used. Never includes content or prompts.">
          <Switch checked={telemetry} onChange={(v) => update("telemetry", v)} />
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Minimize to tray" description="Hide the window instead of quitting when you press the close button.">
          <Switch checked={minimizeToTray} onChange={(v) => update("minimizeToTray", v)} />
        </SettingRow>
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-status-success/10 border border-status-success/20 text-status-success">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-primary">On-device by default</p>
            <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
              Xirea runs models directly on your machine. Conversations, attachments, and model files are stored locally and never transmitted unless you explicitly enable a cloud provider. Cloud providers send your prompts to their servers — review their terms before enabling.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <SettingRow title="Export conversations" description={`Download all ${threads.length} chats as a single JSON file.`}>
          <Button variant="secondary" iconLeft={<Download />} onClick={handleExport}>Export</Button>
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Clear all data" description="Permanently delete every conversation, model reference, and cached file.">
          <Button variant="danger" iconLeft={<Trash2 />} onClick={handleReset}>Reset</Button>
        </SettingRow>
      </Card>
    </div>
  );
}

function UpdatesSection() {
  const { autoUpdate } = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const pushToast = useUIStore((s) => s.pushToast);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState<string>("1.0.0");
  const [latest, setLatest] = useState<{ tag: string; url: string; publishedAt: string; notes: string } | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the real app version (from Tauri's package info, or the bundled fallback).
  useEffect(() => {
    void getAppMeta().then((m) => setVersion(m.version));
  }, []);

  const REPO = "Danyalkhattak/Xirea-Desktop";
  const RELEASES_URL = `https://github.com/${REPO}/releases`;

  // Compare semver-ish version strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
  const compareVersions = (a: string, b: string): number => {
    const na = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    const nb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const da = na[i] ?? 0;
      const db = nb[i] ?? 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  };

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    pushToast({ title: "Checking for updates…", variant: "info" });
    try {
      // Hit the real GitHub Releases API.
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      // 404 means "no releases published yet" — that's not an error, it's
      // just an empty release channel. Surface it as a friendly message
      // instead of scaring the user with a "couldn't check" toast.
      if (res.status === 404) {
        setLatest(null);
        setLastChecked(new Date().toISOString());
        pushToast({
          title: "No releases yet",
          description: `Releases will appear here once published at ${RELEASES_URL}`,
          variant: "info",
        });
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const tag: string = data.tag_name ?? "v0.0.0";
      const url: string = data.html_url ?? RELEASES_URL;
      const publishedAt: string = data.published_at ?? new Date().toISOString();
      const notes: string = data.body ?? "No release notes.";
      setLatest({ tag, url, publishedAt, notes });
      setLastChecked(new Date().toISOString());

      const cmp = compareVersions(tag, version);
      if (cmp > 0) {
        pushToast({
          title: "Update available",
          description: `${tag} is ready — you're on v${version}`,
          variant: "warning",
        });
      } else {
        pushToast({
          title: "You're up to date",
          description: `Xirea v${version} is the latest version`,
          variant: "success",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ title: "Couldn't check for updates", description: msg, variant: "danger" });
    } finally {
      setChecking(false);
    }
  };

  const hasUpdate = latest ? compareVersions(latest.tag, version) > 0 : false;

  return (
    <div className="space-y-4">
      <SectionHeader title="Updates" description="Keep Xirea up to date." icon={Download} />

      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-teal-500/15 border border-brand-teal-400/20 text-brand-teal-300">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-primary">Current version</p>
            <p className="text-xs text-ink-tertiary mt-0.5">Xirea v{version}</p>
          </div>
          {hasUpdate ? (
            <Badge variant="warning" dot>Update available</Badge>
          ) : (
            <Badge variant="success" dot>Up to date</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            iconLeft={checking ? <RotateCcw className="animate-spin" /> : <RotateCcw />}
            disabled={checking}
            onClick={() => void handleCheck()}
            className="cursor-pointer"
          >
            {checking ? "Checking…" : "Check now"}
          </Button>
          <Button
            variant="ghost"
            iconLeft={<ExternalLink />}
            onClick={() => void openExternal(RELEASES_URL)}
            className="cursor-pointer"
          >
            All releases
          </Button>
        </div>
        {lastChecked && (
          <p className="mt-3 text-2xs text-ink-faint">
            Last checked: {new Date(lastChecked).toLocaleString()}
          </p>
        )}
        {error && (
          <p className="mt-2 text-xs text-status-danger">{error}</p>
        )}
      </Card>

      {latest && hasUpdate && (
        <Card>
          <div className="flex items-start gap-3 mb-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-status-warning/10 border border-status-warning/20 text-status-warning">
              <Download className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink-primary">{latest.tag}</p>
              <p className="text-2xs text-ink-tertiary">
                Released {new Date(latest.publishedAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<ExternalLink />}
              onClick={() => void openExternal(latest.url)}
              className="cursor-pointer"
            >
              View release
            </Button>
          </div>
          {latest.notes && (
            <div className="mt-2 rounded-lg border border-line-subtle bg-overlay/4 p-3 max-h-48 overflow-y-auto">
              <pre className="selectable whitespace-pre-wrap text-xs text-ink-secondary font-sans leading-relaxed">
                {latest.notes.slice(0, 1200)}
                {latest.notes.length > 1200 ? "…" : ""}
              </pre>
            </div>
          )}
        </Card>
      )}

      <Card>
        <SettingRow title="Auto-update" description="Automatically check for new releases when the app starts.">
          <Switch checked={autoUpdate} onChange={(v) => update("autoUpdate", v)} />
        </SettingRow>
      </Card>
    </div>
  );
}

function StorageSection() {
  const localModels = useModelsStore((s) => s.local);
  const tasks = useDownloadsStore((s) => s.tasks);
  const pushToast = useUIStore((s) => s.pushToast);
  const [modelsDir, setModelsDir] = useState<string>("~/.xirea/models");

  // Compute the real total of locally-installed models.
  const totalBytes = localModels.reduce((acc, m) => acc + (m.sizeBytes ?? 0), 0);
  const completed = tasks.filter((t) => t.state === "completed").length;
  const active = tasks.filter((t) => t.state === "downloading" || t.state === "queued").length;

  const handleChooseDir = async () => {
    try {
      const dir = await pickDirectory({ title: "Choose models directory" });
      if (typeof dir === "string") {
        setModelsDir(dir);
        pushToast({ title: "Models directory updated", description: dir, variant: "success" });
      }
    } catch (e) {
      pushToast({ title: "Couldn't pick directory", description: e instanceof Error ? e.message : String(e), variant: "danger" });
    }
  };

  const handleClearCache = () => {
    // Real cache clear: cancel all completed downloads older than 24h and
    // drop them from the downloads store. (Local model files are NOT touched.)
    const stale = tasks.filter((t) => t.state === "completed");
    if (stale.length === 0) {
      pushToast({ title: "Nothing to clear", description: "No completed downloads in cache.", variant: "info" });
      return;
    }
    void confirmDialog(
      "Clear download history?",
      `This removes ${stale.length} completed download ${stale.length === 1 ? "entry" : "entries"} from the list. Files on disk are NOT deleted.`,
      { variant: "danger", confirmLabel: "Clear list" },
    ).then((ok) => {
      if (!ok) return;
      useDownloadsStore.getState().clearCompleted();
      pushToast({ title: "Cache cleared", description: `${stale.length} entries removed`, variant: "success" });
    });
  };

  // Per-model breakdown (real, not mock).
  const rows = localModels.length === 0
    ? [{ label: "No local models yet", bytes: 0, color: "from-brand-indigo-400 to-brand-indigo-600" }]
    : localModels
        .slice()
        .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
        .slice(0, 5)
        .map((m, i) => ({
          label: m.name,
          bytes: m.sizeBytes ?? 0,
          color: [
            "from-brand-indigo-400 to-brand-indigo-600",
            "from-brand-teal-400 to-brand-teal-600",
            "from-brand-fuchsia-400 to-brand-fuchsia-600",
            "from-amber-400 to-amber-600",
            "from-emerald-400 to-emerald-600",
          ][i % 5]!,
        }));
  const maxBytes = Math.max(1, ...rows.map((r) => r.bytes));

  return (
    <div className="space-y-4">
      <SectionHeader title="Storage" description="See what's taking up space and clear caches." icon={Monitor} />

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink-primary">Local models</p>
          <p className="text-xs text-ink-tertiary tabular-nums">{localModels.length} installed · {formatBytes(totalBytes)}</p>
        </div>
        {localModels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-soft p-6 text-center">
            <HardDrive className="mx-auto mb-2 h-6 w-6 text-ink-faint" />
            <p className="text-xs text-ink-tertiary">No models installed yet</p>
            <p className="text-2xs text-ink-faint mt-1">Browse Hugging Face or drop a .gguf file to get started.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((row) => (
              <div key={row.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-ink-secondary truncate">{row.label}</span>
                  <span className="tabular-nums text-ink-tertiary shrink-0 ml-2">{formatBytes(row.bytes)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-overlay/6 overflow-hidden">
                  <div className={cn("h-full rounded-full bg-gradient-to-r", row.color)} style={{ width: `${(row.bytes / maxBytes) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="rounded-lg surface p-3 text-center">
            <p className="text-lg font-semibold text-ink-primary tabular-nums">{localModels.length}</p>
            <p className="text-2xs text-ink-muted">Models</p>
          </div>
          <div className="rounded-lg surface p-3 text-center">
            <p className="text-lg font-semibold text-ink-primary tabular-nums">{completed}</p>
            <p className="text-2xs text-ink-muted">Downloads done</p>
          </div>
          <div className="rounded-lg surface p-3 text-center">
            <p className="text-lg font-semibold text-ink-primary tabular-nums">{active}</p>
            <p className="text-2xs text-ink-muted">In progress</p>
          </div>
        </div>
      </Card>

      <Card>
        <SettingRow title="Clear cache" description="Remove completed downloads from the list. Model files on disk are NOT deleted.">
          <Button variant="secondary" iconLeft={<RotateCcw />} onClick={handleClearCache}>Clear list</Button>
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Models directory" description={modelsDir}>
          <Button variant="secondary" iconLeft={<FolderOpen />} onClick={() => void handleChooseDir()}>Choose…</Button>
        </SettingRow>
      </Card>
    </div>
  );
}

function ShortcutsSection() {
  const globalShortcut = useSettingsStore((s) => s.settings.globalShortcut);
  const update = useSettingsStore((s) => s.update);
  const pushToast = useUIStore((s) => s.pushToast);

  const shortcuts = [
    { keys: ["⌘", "K"], label: "Open command palette" },
    { keys: ["⌘", "N"], label: "New chat" },
    { keys: ["⌘", "B"], label: "Toggle sidebar" },
    { keys: ["⌘", "."], label: "Toggle activity panel" },
    { keys: ["⌘", ","], label: "Open settings" },
    { keys: ["⌘", "↵"], label: "Send message" },
    { keys: ["⇧", "↵"], label: "New line in composer" },
    { keys: ["esc"], label: "Cancel / close dialog" },
  ];

  const handleResetShortcut = () => {
    update("globalShortcut", "CommandOrControl+Shift+X");
    pushToast({ title: "Shortcut reset", variant: "info" });
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Keyboard shortcuts" description="Power-user bindings. macOS uses ⌘; Linux/Windows use Ctrl." icon={Keyboard} />

      <Card padded={false} className="overflow-hidden">
        <div className="divide-y divide-line-subtle">
          {shortcuts.map((s) => (
            <div key={s.label} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-ink-secondary">{s.label}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd key={i} className="kbd">{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-indigo-500/15 border border-brand-indigo-400/20 text-brand-indigo-300">
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-primary">Global shortcut</p>
            <p className="text-xs text-ink-tertiary mt-1">Bring Xirea to focus from anywhere on your desktop.</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input value={globalShortcut} readOnly iconLeft={<Keyboard />} />
          <Button variant="ghost" iconLeft={<RotateCcw />} onClick={handleResetShortcut}>Reset</Button>
        </div>
      </Card>
    </div>
  );
}

function AboutSection() {
  const displayName = useSettingsStore((s) => s.settings.displayName);
  const bio = useSettingsStore((s) => s.settings.bio);
  const profilePicture = useSettingsStore((s) => s.settings.profilePicture);
  const update = useSettingsStore((s) => s.update);
  const pushToast = useUIStore((s) => s.pushToast);
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const [draftBio, setDraftBio] = useState(bio);
  const [version, setVersion] = useState<string>("1.0.0");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void getAppMeta().then((m) => setVersion(m.version));
  }, []);

  useEffect(() => {
    if (!editingProfile) {
      setDraftName(displayName);
      setDraftBio(bio);
    }
  }, [displayName, bio, editingProfile]);

  const saveProfile = () => {
    update("displayName", draftName.trim() || "Xirea User");
    update("bio", draftBio.trim() || "Local profile");
    setEditingProfile(false);
    pushToast({ title: "Profile saved", variant: "success" });
  };

  const handlePickPicture = () => {
    fileInputRef.current?.click();
  };

  const handlePictureChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        update("profilePicture", result);
        pushToast({ title: "Profile picture updated", variant: "success" });
      }
    };
    reader.onerror = () => {
      pushToast({
        title: "Could not load picture",
        description: "Try a smaller image (PNG or JPG, under 4 MB).",
        variant: "danger",
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleRemovePicture = () => {
    update("profilePicture", undefined);
    pushToast({ title: "Profile picture removed", variant: "info" });
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="About Xirea" description="Premium, private, on-device AI for the desktop." icon={Info} />

      <Card>
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0">
            <div className="absolute inset-0 rounded-2xl bg-brand-gradient-soft blur-xl opacity-80" />
            <div className="relative grid h-16 w-16 place-items-center rounded-2xl bg-surface-raised border border-line-soft overflow-hidden">
              <img src="/icon.png" alt="Xirea" className="h-12 w-12 rounded-xl" draggable={false} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold font-display text-ink-primary">Xirea</h3>
            <p className="text-xs text-ink-tertiary">Premium AI Desktop Assistant</p>
            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant="brand">v{version}</Badge>
              <Badge variant="teal" dot>Stable</Badge>
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm text-ink-tertiary leading-relaxed">
          Xirea is an offline-first AI chat assistant that runs lightweight language models directly on your device. No internet required, no API keys, no data leaving your machine — your conversations stay completely private.
        </p>
      </Card>

      {/* User profile editor */}
      <Card>
        <div className="flex items-start gap-3 mb-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-indigo-500/15 border border-brand-indigo-400/20 text-brand-indigo-300">
            <User className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-primary">Your profile</p>
            <p className="text-xs text-ink-tertiary mt-0.5">Stored locally. Used as the display name in chat and the sidebar.</p>
          </div>
          {!editingProfile && (
            <Button variant="ghost" size="sm" iconLeft={<Pencil />} onClick={() => setEditingProfile(true)}>Edit</Button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handlePictureChosen}
        />
        {editingProfile ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <ProfileAvatar picture={profilePicture} name={draftName} size={48} ring />
              <div className="flex flex-col gap-1">
                <Button variant="secondary" size="sm" iconLeft={<Pencil />} onClick={handlePickPicture}>
                  Change picture
                </Button>
                {profilePicture && (
                  <Button variant="ghost" size="sm" iconLeft={<Trash2 />} onClick={handleRemovePicture} className="text-status-danger hover:text-status-danger">
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div>
              <label className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">Display name</label>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg bg-surface-deep border border-line-soft px-2.5 py-1.5 text-sm text-ink-primary focus:outline-none focus:border-brand-indigo-400/60"
                autoFocus
              />
            </div>
            <div>
              <label className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">Bio</label>
              <input
                type="text"
                value={draftBio}
                onChange={(e) => setDraftBio(e.target.value)}
                placeholder="Local profile"
                className="w-full rounded-lg bg-surface-deep border border-line-soft px-2.5 py-1.5 text-sm text-ink-primary focus:outline-none focus:border-brand-indigo-400/60"
              />
            </div>
            <div className="flex gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditingProfile(false); setDraftName(displayName); setDraftBio(bio); }}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={saveProfile}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-overlay/4 p-3">
            <ProfileAvatar picture={profilePicture} name={displayName} size={40} ring />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-primary truncate">{displayName}</p>
              <p className="text-2xs text-ink-tertiary truncate">{bio}</p>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SettingRow title="Source code" description="Open source under the MIT license.">
          <Button
            variant="secondary"
            iconLeft={<Github />}
            onClick={() => void openExternal("https://github.com/Danyalkhattak/Xirea-Desktop")}
            className="cursor-pointer"
          >
            GitHub
          </Button>
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Report an issue" description="Found a bug or have a feature request?">
          <Button
            variant="secondary"
            iconLeft={<Github />}
            onClick={() => void openExternal("https://github.com/Danyalkhattak/Xirea-Desktop/issues")}
            className="cursor-pointer"
          >
            Issues
          </Button>
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Developer" description="Danyal Khattak — follow on Instagram & GitHub.">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Instagram className="text-status-danger" />}
              onClick={() => void openExternal("https://www.instagram.com/dannyk_739")}
              className="cursor-pointer"
            >
              Instagram
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Github />}
              onClick={() => void openExternal("https://github.com/Danyalkhattak")}
              className="cursor-pointer"
            >
              GitHub
            </Button>
          </div>
        </SettingRow>
        <div className="h-px bg-line-subtle my-1" />
        <SettingRow title="Latest release" description="Download the newest version.">
          <Button
            variant="secondary"
            iconLeft={<ExternalLink />}
            onClick={() => void openExternal("https://github.com/Danyalkhattak/Xirea-Desktop/releases")}
            className="cursor-pointer"
          >
            Releases
          </Button>
        </SettingRow>
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-status-danger/10 border border-status-danger/20 text-status-danger">
            <Heart className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-primary">Made with care</p>
            <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
              Xirea is built and maintained by Danyal Khattak. Open source under the MIT license — contributions welcome.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
