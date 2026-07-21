/**
 * Providers store — cloud model providers.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Provider, ProviderHealth, ProviderKind } from "@/types";
import { uid } from "@/lib/utils";
import { pingProvider } from "@/lib/tauri";

interface ProvidersState {
  providers: Provider[];
  addProvider: (input: Omit<Provider, "id" | "models" | "enabled" | "health">) => string;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  removeProvider: (id: string) => void;
  toggleEnabled: (id: string) => void;
  setHealth: (id: string, health: ProviderHealth) => void;
  refreshHealth: (id: string) => Promise<void>;
  setModels: (id: string, models: Provider["models"]) => void;
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: "provider_openai",
    kind: "openai",
    name: "OpenAI",
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    models: [],
    favorite: true,
  },
  {
    id: "provider_anthropic",
    kind: "anthropic",
    name: "Anthropic",
    enabled: false,
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    models: [],
    favorite: true,
  },
  {
    id: "provider_gemini",
    kind: "gemini",
    name: "Google Gemini",
    enabled: false,
    // Use v1beta — it has the newest models (gemini-2.5-flash, gemini-2.5-pro)
    // AND supports `systemInstruction` as a top-level field. The v1 endpoint
    // rejects `systemInstruction` for some 2.x models with
    // "Unknown name 'systeminstruction': Cannot find field", which is the
    // cryptic error users see when configured against v1.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "",
    models: [],
  },
  {
    id: "provider_groq",
    kind: "groq",
    name: "Groq",
    enabled: false,
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "",
    models: [],
  },
  {
    id: "provider_mistral",
    kind: "mistral",
    name: "Mistral",
    enabled: false,
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: "",
    models: [],
  },
  {
    id: "provider_openrouter",
    kind: "openrouter",
    name: "OpenRouter",
    enabled: false,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    models: [],
  },
  {
    id: "provider_azure",
    kind: "azure-openai",
    name: "Azure OpenAI",
    enabled: false,
    baseUrl: "",
    apiKey: "",
    models: [],
  },
  {
    id: "provider_ollama",
    kind: "ollama",
    name: "Ollama",
    enabled: false,
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    models: [],
  },
  {
    id: "provider_lmstudio",
    kind: "lm-studio",
    name: "LM Studio",
    enabled: false,
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "",
    models: [],
  },
];

export const useProvidersStore = create<ProvidersState>()(
  persist(
    (set, get) => ({
      providers: DEFAULT_PROVIDERS,

      addProvider: (input) => {
        const id = uid("prov");
        const provider: Provider = { id, enabled: false, models: [], ...input };
        set((s) => ({ providers: [...s.providers, provider] }));
        return id;
      },

      updateProvider: (id, patch) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),

      removeProvider: (id) =>
        set((s) => ({ providers: s.providers.filter((p) => p.id !== id) })),

      toggleEnabled: (id) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
        })),

      setHealth: (id, health) =>
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === id ? { ...p, health, latencyMs: health.latencyMs } : p,
          ),
        })),

      refreshHealth: async (id) => {
        const provider = get().providers.find((p) => p.id === id);
        if (!provider) return;
        try {
          const health = await pingProvider(provider.baseUrl, provider.apiKey);
          get().setHealth(id, health);
        } catch (e) {
          get().setHealth(id, {
            ok: false,
            status: 0,
            latencyMs: 0,
            message: e instanceof Error ? e.message : String(e),
            checkedAt: new Date().toISOString(),
          });
        }
      },

      setModels: (id, models) =>
        set((s) => ({
          providers: s.providers.map((p) => (p.id === id ? { ...p, models } : p)),
        })),
    }),
    {
      name: "xirea:providers",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const PROVIDER_KINDS: { kind: ProviderKind; label: string; description: string; docsUrl: string }[] = [
  { kind: "openai", label: "OpenAI", description: "GPT-4o, o1, o3 and the rest of the OpenAI catalog.", docsUrl: "https://platform.openai.com/docs/api-reference" },
  { kind: "anthropic", label: "Anthropic", description: "Claude 3.5 Sonnet, Haiku, Opus — tool use and vision.", docsUrl: "https://docs.anthropic.com/" },
  { kind: "gemini", label: "Google Gemini", description: "Gemini 2.0 Flash and Pro from Google AI Studio.", docsUrl: "https://ai.google.dev/gemini-api/docs" },
  { kind: "groq", label: "Groq", description: "Blazing-fast LPU inference for open models.", docsUrl: "https://console.groq.com/docs" },
  { kind: "mistral", label: "Mistral", description: "Mistral and Mixtral models, including the Codestral family.", docsUrl: "https://docs.mistral.ai/" },
  { kind: "openrouter", label: "OpenRouter", description: "One API key, every model — unified pricing & failover.", docsUrl: "https://openrouter.ai/docs" },
  { kind: "azure-openai", label: "Azure OpenAI", description: "OpenAI models deployed in your Azure subscription.", docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/" },
  { kind: "ollama", label: "Ollama", description: "Run open models locally with the Ollama runtime.", docsUrl: "https://ollama.com/" },
  { kind: "lm-studio", label: "LM Studio", description: "Local OpenAI-compatible server bundled with LM Studio.", docsUrl: "https://lmstudio.ai/docs" },
  { kind: "openai-compatible", label: "OpenAI-compatible", description: "Anything that speaks the OpenAI Chat Completions API.", docsUrl: "https://platform.openai.com/docs/api-reference/chat" },
  { kind: "custom", label: "Custom endpoint", description: "Bring your own base URL, headers, and body shape.", docsUrl: "" },
];
