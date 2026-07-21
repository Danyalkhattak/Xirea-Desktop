/**
 * ProvidersView — cloud model provider management.
 *
 * Each provider card has:
 *  - Logo / icon, name, kind, base URL
 *  - Enable toggle, health-check button with latency badge
 *  - "Fetch models" button that lists available models
 *  - API key field (masked)
 *  - Test connection result
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Cloud,
  Plus,
  Key,
  RefreshCw,
  Activity,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ExternalLink,
  Zap,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { useProvidersStore, PROVIDER_KINDS } from "@/store/providers";
import { useUIStore } from "@/store/ui";
import { openExternal, fetchProviderModels } from "@/lib/tauri";
import type { Provider, ProviderKind } from "@/types";

const KIND_ICONS: Record<ProviderKind, LucideIcon> = {
  openai: Cloud,
  anthropic: Cloud,
  gemini: Cloud,
  groq: Zap,
  mistral: Cloud,
  openrouter: Cloud,
  "azure-openai": Cloud,
  ollama: Cloud,
  "lm-studio": Cloud,
  "openai-compatible": Cloud,
  custom: Cloud,
};

const KIND_COLORS: Record<ProviderKind, string> = {
  openai: "from-emerald-500/15 to-emerald-500/5 text-emerald-300",
  anthropic: "from-amber-500/15 to-amber-500/5 text-amber-300",
  gemini: "from-blue-500/15 to-blue-500/5 text-blue-300",
  groq: "from-rose-500/15 to-rose-500/5 text-rose-300",
  mistral: "from-orange-500/15 to-orange-500/5 text-orange-300",
  openrouter: "from-purple-500/15 to-purple-500/5 text-purple-300",
  "azure-openai": "from-sky-500/15 to-sky-500/5 text-sky-300",
  ollama: "from-teal-500/15 to-teal-500/5 text-teal-300",
  "lm-studio": "from-indigo-500/15 to-indigo-500/5 text-indigo-300",
  "openai-compatible": "from-slate-500/15 to-slate-500/5 text-slate-300",
  custom: "from-fuchsia-500/15 to-fuchsia-500/5 text-fuchsia-300",
};

export function ProvidersView() {
  const providers = useProvidersStore((s) => s.providers);
  const addProvider = useProvidersStore((s) => s.addProvider);
  const updateProvider = useProvidersStore((s) => s.updateProvider);
  const removeProvider = useProvidersStore((s) => s.removeProvider);
  const toggleEnabled = useProvidersStore((s) => s.toggleEnabled);
  const refreshHealth = useProvidersStore((s) => s.refreshHealth);
  const setModels = useProvidersStore((s) => s.setModels);
  const pushToast = useUIStore((s) => s.pushToast);

  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const enabledCount = providers.filter((p) => p.enabled).length;
  const healthyCount = providers.filter((p) => p.health?.ok).length;

  const handleCheck = async (id: string) => {
    setChecking(id);
    await refreshHealth(id);
    setChecking(null);
    const provider = useProvidersStore.getState().providers.find((p) => p.id === id);
    if (provider?.health?.ok) {
      pushToast({ title: `${provider.name} is reachable`, description: `Latency ${provider.health.latencyMs}ms`, variant: "success" });
    } else if (provider?.health) {
      pushToast({ title: `${provider.name} unreachable`, description: provider.health.message, variant: "danger" });
    }
  };

  const handleFetch = async (id: string) => {
    setFetching(id);
    const provider = useProvidersStore.getState().providers.find((p) => p.id === id);
    if (!provider) {
      setFetching(null);
      return;
    }
    try {
      const models = await fetchProviderModels(provider.kind, provider.baseUrl, provider.apiKey);
      // Re-tag the models with the actual provider id so they're addressable.
      setModels(id, models.map((m) => ({ ...m, providerId: id })));
      if (models.length === 0) {
        pushToast({
          title: "No models returned",
          description: `${provider.name} responded with an empty list. Check the API key.`,
          variant: "warning",
        });
      } else {
        pushToast({
          title: `Fetched ${models.length} models`,
          description: provider.name,
          variant: "success",
        });
      }
    } catch (e) {
      pushToast({
        title: "Failed to fetch models",
        description: e instanceof Error ? e.message : String(e),
        variant: "danger",
      });
    } finally {
      setFetching(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line-subtle px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold font-display text-ink-primary">Providers</h1>
              <Badge variant="brand">{enabledCount} enabled</Badge>
              <Badge variant="success" dot>{healthyCount} healthy</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-tertiary">
              Connect cloud providers and local OpenAI-compatible servers. Keys are stored locally, never synced.
            </p>
          </div>
          <Button variant="primary" iconLeft={<Plus />} onClick={() => setAdding(true)}>
            Add provider
          </Button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <StatTile label="Total" value={String(providers.length)} icon={Cloud} />
          <StatTile label="Enabled" value={String(enabledCount)} icon={CheckCircle2} accent="success" />
          <StatTile label="Healthy" value={String(healthyCount)} icon={Activity} accent="teal" />
          <StatTile label="Avg latency" value={`${Math.round(providers.filter((p) => p.health?.ok).reduce((a, p) => a + (p.health?.latencyMs ?? 0), 0) / Math.max(1, healthyCount))}ms`} icon={Zap} accent="indigo" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {adding && (
          <Card className="mb-4" raised>
            <CardHeader title="Add a new provider" description="Pick a kind to pre-fill the base URL and headers." icon={<Plus />} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PROVIDER_KINDS.map((k) => {
                const Icon = KIND_ICONS[k.kind];
                return (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => {
                      addProvider({
                        kind: k.kind,
                        name: k.label,
                        baseUrl: getDefaultBaseUrl(k.kind),
                        apiKey: "",
                        favorite: false,
                      });
                      setAdding(false);
                      pushToast({ title: "Provider added", description: k.label, variant: "success" });
                    }}
                    className="group flex flex-col gap-2 rounded-xl border border-line-soft bg-surface-raised/60 p-3 text-left hover:border-brand-indigo-400/40 hover:bg-brand-indigo-500/[0.04] transition-colors"
                  >
                    <div className={cn("grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br", KIND_COLORS[k.kind])}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-ink-primary">{k.label}</p>
                      <p className="text-2xs text-ink-tertiary line-clamp-2 mt-0.5">{k.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              checking={checking === provider.id}
              fetching={fetching === provider.id}
              expanded={expandedId === provider.id}
              onToggleExpand={() => setExpandedId((v) => (v === provider.id ? null : provider.id))}
              onToggleEnabled={() => toggleEnabled(provider.id)}
              onCheck={() => void handleCheck(provider.id)}
              onFetch={() => void handleFetch(provider.id)}
              onUpdate={(patch) => updateProvider(provider.id, patch)}
              onRemove={() => removeProvider(provider.id)}
            />
          ))}
        </div>

        {providers.length === 0 && (
          <EmptyState
            icon={<Cloud className="h-7 w-7" />}
            title="No providers yet"
            description="Add your first cloud or local provider to start using cloud models."
            action={<Button variant="primary" iconLeft={<Plus />} onClick={() => setAdding(true)}>Add provider</Button>}
            size="lg"
          />
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  checking,
  fetching,
  expanded,
  onToggleExpand,
  onToggleEnabled,
  onCheck,
  onFetch,
  onUpdate,
  onRemove,
}: {
  provider: Provider;
  checking: boolean;
  fetching: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onCheck: () => void;
  onFetch: () => void;
  onUpdate: (patch: Partial<Provider>) => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICONS[provider.kind];
  const kindInfo = PROVIDER_KINDS.find((k) => k.kind === provider.kind);
  const health = provider.health;
  const [showKey, setShowKey] = useState(false);

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card hover padded={false} className="overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 p-4">
          <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br border border-line-subtle", KIND_COLORS[provider.kind])}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink-primary truncate">{provider.name}</h3>
              {provider.favorite && <Badge variant="fuchsia" dot>Favorite</Badge>}
            </div>
            <p className="text-2xs text-ink-tertiary truncate">{provider.baseUrl || "No base URL"}</p>
            <div className="mt-1 flex items-center gap-1.5">
              {health?.ok ? (
                <Badge variant="success" dot>Healthy · {health.latencyMs}ms</Badge>
              ) : health ? (
                <Badge variant="danger" dot>Unreachable</Badge>
              ) : (
                <Badge variant="default">Not checked</Badge>
              )}
              {provider.models.length > 0 && <Badge variant="teal">{provider.models.length} models</Badge>}
            </div>
          </div>
          <Switch checked={provider.enabled} onChange={onToggleEnabled} />
        </div>

        {/* Action row */}
        <div className="flex items-center gap-1.5 px-4 pb-3">
          <Button variant="secondary" size="sm" iconLeft={checking ? <Spinner size={12} /> : <RefreshCw />} onClick={onCheck} disabled={checking}>
            {checking ? "Checking…" : "Test"}
          </Button>
          <Button variant="ghost" size="sm" iconLeft={fetching ? <Spinner size={12} /> : <Cloud />} onClick={onFetch} disabled={fetching}>
            {fetching ? "Fetching…" : "Fetch models"}
          </Button>
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip content="Documentation">
              <IconButton
                label="Docs"
                size="sm"
                variant="ghost"
                onClick={() => kindInfo?.docsUrl && void openExternal(kindInfo.docsUrl)}
                disabled={!kindInfo?.docsUrl}
              >
                <ExternalLink />
              </IconButton>
            </Tooltip>
            <Tooltip content="Remove">
              <IconButton label="Remove" size="sm" variant="ghost" onClick={onRemove} className="hover:text-status-danger hover:bg-status-danger/10">
                <Trash2 />
              </IconButton>
            </Tooltip>
            <Tooltip content={expanded ? "Hide details" : "Show details"}>
              <IconButton label="Details" size="sm" variant="ghost" onClick={onToggleExpand}>
                <ChevronRight className={cn("transition-transform", expanded && "rotate-90")} />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-line-subtle p-4 space-y-3"
          >
            <div>
              <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Base URL</label>
              <Input
                value={provider.baseUrl}
                onChange={(e) => onUpdate({ baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div>
              <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">API key</label>
              <Input
                type={showKey ? "text" : "password"}
                value={provider.apiKey ?? ""}
                onChange={(e) => onUpdate({ apiKey: e.target.value })}
                placeholder="sk-…"
                iconLeft={<Key />}
                iconRight={
                  <button type="button" onClick={() => setShowKey((v) => !v)} className="text-2xs text-ink-tertiary hover:text-ink-primary">
                    {showKey ? "Hide" : "Show"}
                  </button>
                }
              />
            </div>
            {health && (
              <div className="rounded-lg border border-line-subtle bg-surface-deep/40 p-2.5">
                <div className="flex items-center justify-between text-2xs text-ink-muted mb-1">
                  <span>Last health check</span>
                  <span>{formatRelativeTime(health.checkedAt)}</span>
                </div>
                <p className={cn("text-xs font-medium flex items-center gap-1.5", health.ok ? "text-status-success" : "text-status-danger")}>
                  {health.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {health.message}
                </p>
              </div>
            )}
            {provider.models.length > 0 && (
              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Available models</label>
                <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-line-subtle p-1.5">
                  {provider.models.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-overlay/4">
                      <span className="text-ink-secondary truncate">{m.name}</span>
                      <span className="text-2xs text-ink-faint shrink-0 ml-2">{(m.contextLength / 1024).toFixed(0)}K</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </Card>
    </motion.div>
  );
}

function StatTile({ label, value, icon: Icon, accent }: { label: string; value: string; icon: LucideIcon; accent?: "success" | "teal" | "indigo" }) {
  return (
    <div className="rounded-xl surface p-3 flex items-center gap-3">
      <div className={cn(
        "grid h-8 w-8 place-items-center rounded-lg",
        accent === "success" && "bg-status-success/15 text-status-success",
        accent === "teal" && "bg-brand-teal-500/15 text-brand-teal-300",
        accent === "indigo" && "bg-brand-indigo-500/15 text-brand-indigo-300",
        !accent && "bg-overlay/4 text-ink-tertiary",
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

function getDefaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "openai": return "https://api.openai.com/v1";
    case "anthropic": return "https://api.anthropic.com/v1";
    case "gemini": return "https://generativelanguage.googleapis.com/v1";
    case "groq": return "https://api.groq.com/openai/v1";
    case "mistral": return "https://api.mistral.ai/v1";
    case "openrouter": return "https://openrouter.ai/api/v1";
    case "azure-openai": return "";
    case "ollama": return "http://127.0.0.1:11434/v1";
    case "lm-studio": return "http://127.0.0.1:1234/v1";
    case "openai-compatible": return "http://localhost:8080/v1";
    case "custom": return "";
  }
}

