/**
 * LLM client — orchestrates chat streaming against the configured provider
 * or local runtime. Replaces the old `mock-llm.ts`.
 *
 * Resolves the active model + provider from the stores, builds the
 * `ChatStreamCallbacks`, and forwards events to the caller.
 */
import type { ChatMessage, Provider } from "@/types";
import { streamChatCompletion } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useProvidersStore } from "@/store/providers";
import { useModelsStore } from "@/store/models";

export interface StreamArgs {
  prompt: string;
  history: ChatMessage[];
  system?: string;
  onDelta: (delta: string, accumulated: string, tokens: number) => void;
  onReasoning?: (delta: string) => void;
  onDone: (finalText: string, tokens: number) => void;
  onError: (err: string) => void;
}

/**
 * Resolve the provider + model to use, based on:
 *   1. The settings.defaultProviderId / defaultModelId if set.
 *   2. The first enabled provider with at least one model.
 *
 * Returns null if no provider is available — the caller should surface a
 * helpful error in that case.
 */
export function resolveActiveProvider(): {
  provider: Provider;
  model: string;
} | null {
  const { providers } = useProvidersStore.getState();
  const { local } = useModelsStore.getState();
  const settings = useSettingsStore.getState().settings;

  // 1. Default provider + model from settings.
  if (settings.defaultProviderId && settings.defaultModelId) {
    const provider = providers.find((p) => p.id === settings.defaultProviderId && p.enabled);
    if (provider) {
      // Is the default model local or cloud?
      if (local.some((m) => m.id === settings.defaultModelId)) {
        const localModel = local.find((m) => m.id === settings.defaultModelId)!;
        // Local models run through Ollama or LM Studio — find an enabled one.
        const localProvider = providers.find(
          (p) => p.enabled && (p.kind === "ollama" || p.kind === "lm-studio"),
        );
        if (localProvider) {
          return { provider: localProvider, model: localModel.name };
        }
      }
      // Cloud model — check it exists in the provider's model list.
      const cloudModel = provider.models.find((m) => m.id === settings.defaultModelId);
      if (cloudModel) {
        return { provider, model: cloudModel.id };
      }
      // Even if not in the list, allow it as long as the provider is enabled.
      return { provider, model: settings.defaultModelId };
    }
  }

  // 2. First enabled provider with a model.
  for (const p of providers) {
    if (!p.enabled) continue;
    if (p.models.length > 0) {
      return { provider: p, model: p.models[0]!.id };
    }
  }

  // 3. Fall back to local model + local runtime.
  if (local.length > 0) {
    const localProvider = providers.find(
      (p) => p.enabled && (p.kind === "ollama" || p.kind === "lm-studio"),
    );
    if (localProvider) {
      return { provider: localProvider, model: local[0]!.name };
    }
  }

  return null;
}

export interface StreamHandle {
  cancel: () => Promise<void>;
}

export async function streamResponse(args: StreamArgs): Promise<StreamHandle> {
  const resolved = resolveActiveProvider();
  const settings = useSettingsStore.getState().settings;

  if (!resolved) {
    args.onError(
      "No provider is configured. Open Settings → Providers, enable a provider, and add an API key to start chatting.",
    );
    return { cancel: async () => {} };
  }

  const { provider, model } = resolved;

  // Build messages — prepend history, then the current prompt.
  const messages: Array<{ role: ChatMessage["role"]; content: string }> = [
    ...args.history
      .filter((m) => m.role !== "system" && !m.error)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: args.prompt },
  ];

  const handle = await streamChatCompletion({
    providerKind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    messages,
    system: args.system ?? settings.systemPrompt,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP,
    stream: settings.streaming,
    onDelta: args.onDelta,
    onReasoning: args.onReasoning,
    onDone: args.onDone,
    onError: args.onError,
  });

  return {
    cancel: handle.cancel,
  };
}

/**
 * Returns a friendly description of the currently selected model + provider.
 * Used by the chat composer to label the active model.
 */
export function describeActiveModel(): { label: string; isCloud: boolean; provider?: Provider; model?: string } {
  const resolved = resolveActiveProvider();
  if (!resolved) {
    return { label: "No model selected", isCloud: false };
  }
  const { provider, model } = resolved;
  const isCloud = !["ollama", "lm-studio"].includes(provider.kind);
  return {
    label: `${model} · ${provider.name}`,
    isCloud,
    provider,
    model,
  };
}
