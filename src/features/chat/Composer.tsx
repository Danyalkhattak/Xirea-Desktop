/**
 * Composer — the bottom-of-chat input area.
 *
 * Features:
 *  - Auto-growing textarea (Textarea component)
 *  - Attachment bar (images, files, drag & drop)
 *  - Model picker inline (click to open picker)
 *  - Send / stop / voice buttons
 *  - Keyboard: Enter to send (configurable), Shift+Enter for newline
 *  - Paste image from clipboard
 *  - Drag & drop files into the composer
 */
import { useCallback, useRef, useState, type DragEvent, type ClipboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Square,
  Paperclip,
  Image as ImageIcon,
  Mic,
  X,
  ChevronDown,
  Sparkles,
  Brain,
  Settings2,
  Search,
} from "lucide-react";
import { cn, formatBytes, uid } from "@/lib/utils";
import { Textarea } from "@/components/ui/Textarea";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { useChatStore } from "@/store/chat";
import { useModelsStore } from "@/store/models";
import { useProvidersStore } from "@/store/providers";
import { useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { pickFile, clipboardReadText, fileMetadata, readFileAsDataUrl } from "@/lib/tauri";
import type { Attachment } from "@/types";

interface ComposerProps {
  threadId: string;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  streaming: boolean;
}

const SUGGESTIONS = [
  { label: "Summarize", prompt: "Summarize this in 5 bullet points:\n\n" },
  { label: "Code review", prompt: "Review this code for bugs and readability:\n\n```\n\n```" },
  { label: "Brainstorm", prompt: "Brainstorm 10 variations of: " },
  { label: "Explain", prompt: "Explain like I'm new to this: " },
];

export function Composer({ threadId, onSend, onStop, streaming }: ComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const localModels = useModelsStore((s) => s.local);
  const providers = useProvidersStore((s) => s.providers);
  const activeThreadId = useUIStore((s) => s.activeThreadId);
  const messages = useChatStore((s) => s.messages);

  const enabledModels = [
    ...localModels.map((m) => ({ id: m.id, name: m.name, source: "local" as const, providerId: "local" })),
    ...providers.filter((p) => p.enabled).flatMap((p) => p.models.map((m) => ({ id: m.id, name: m.name, source: "cloud" as const, providerId: p.id }))),
  ];

  const selectedModel = settings.defaultModelId ?? enabledModels[0]?.id ?? "xirea-default";
  const selectedModelName = enabledModels.find((m) => m.id === selectedModel)?.name ?? "Select a model";

  /**
   * When the user picks a model from the inline picker, we MUST update both
   * `defaultModelId` AND `defaultProviderId` together. The LLM resolver
   * (`resolveActiveProvider` in lib/llm.ts) looks up the provider by
   * `defaultProviderId` first; if it still points at the *previous* provider,
   * the resolver would use the new model ID with the old provider — silently
   * sending gpt-4o requests to Anthropic, etc. This was the root cause of
   * "model selection doesn't update the active model after the first message".
   */
  const handleSelectModel = useCallback((modelId: string) => {
    const entry = enabledModels.find((m) => m.id === modelId);
    if (!entry) return;
    if (entry.source === "local") {
      // For local models, point the provider at whichever enabled local
      // runtime (Ollama / LM Studio) is available — `resolveActiveProvider`
      // does the same fallback at request time, but storing it here keeps
      // the UI label honest.
      const localProvider = providers.find((p) => p.enabled && (p.kind === "ollama" || p.kind === "lm-studio"));
      update("defaultModelId", modelId);
      if (localProvider) update("defaultProviderId", localProvider.id);
    } else {
      // Cloud model — entry.providerId is the cloud provider's id.
      update("defaultModelId", modelId);
      update("defaultProviderId", entry.providerId);
    }
  }, [enabledModels, providers, update]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
  }, [text, attachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && settings.sendOnEnter && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (streaming) return;
      handleSend();
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      const att: Attachment = {
        id: uid("att"),
        kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "file",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        source: URL.createObjectURL(file),
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      };
      newAttachments.push(att);
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleFilePick = async () => {
    const result = await pickFile({
      multiple: true,
      title: "Attach files",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
        { name: "Documents", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "md", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    const newAttachments: Attachment[] = [];
    for (const p of paths) {
      try {
        const meta = await fileMetadata(p);
        const isImage = meta.kind === "image";
        let previewUrl: string | undefined;
        if (isImage) {
          try {
            previewUrl = await readFileAsDataUrl(p, 8 * 1024 * 1024);
          } catch {
            /* image too large — skip preview */
          }
        }
        newAttachments.push({
          id: uid("att"),
          kind: isImage ? "image" : meta.kind === "audio" ? "audio" : meta.kind === "video" ? "video" : "file",
          name: meta.name,
          mimeType: meta.mimeType,
          size: meta.sizeBytes,
          source: p, // real filesystem path
          previewUrl,
        });
      } catch (e) {
        console.error("Failed to read file:", p, e);
      }
    }
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addFiles(files);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      void addFiles(e.dataTransfer.files);
    }
  };

  // Use the suggestions to pre-fill the composer
  const applySuggestion = (prompt: string) => {
    setText(prompt);
  };

  // Voice input — uses the browser's Web Speech API (SpeechRecognition).
  // Falls back gracefully if not supported (most desktop webviews support it
  // via the OS speech engine).
  //
  // IMPORTANT: We capture the text that was already in the composer BEFORE
  // voice starts, then on every `onresult` event we REPLACE the voice
  // portion (interim + final) with the latest transcript. This is what
  // prevents the "hello can you  hello can you write  hello can you write a
  // code…" duplication bug — the interim transcript from each event is
  // treated as a REPLACEMENT of the previous interim, not an append.
  //
  // We also handle `no-speech` and `aborted` errors silently so the user
  // doesn't see a scary warning when they pause briefly or click the mic
  // button by accident.
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const voiceBaseRef = useRef<string>("");

  const handleVoice = () => {
    if (recording) {
      // Stop recording.
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setRecording(false);
      return;
    }
    const SpeechRecognition =
      (typeof window !== "undefined" && (window as any).SpeechRecognition) ||
      (typeof window !== "undefined" && (window as any).webkitSpeechRecognition);
    if (!SpeechRecognition) {
      // Fallback: try clipboard paste (so the button isn't dead).
      void clipboardReadText().then((clipText) => {
        if (clipText) setText((prev) => prev + clipText);
        else {
          window.alert?.(
            "Voice input requires the Web Speech API, which isn't available in this browser. Try running Xirea as a desktop app.",
          );
        }
      });
      return;
    }
    // Snapshot the text that was in the composer before voice input started.
    // On every recognition event we'll rebuild the composer text as:
    //   baseText + separator + (final + interim)
    // so the interim transcript is REPLACED, not appended, on every tick.
    voiceBaseRef.current = text;
    const baseText = text;
    const separator = baseText && !baseText.endsWith(" ") ? " " : "";

    try {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event: any) => {
        // Iterate through ALL results (NOT from `event.resultIndex`) so we
        // always have the complete final + interim text. Using `resultIndex`
        // here was the root cause of the duplication bug — each event
        // appended the latest interim to the previous interim.
        let finalText = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i++) {
          const transcript = event.results[i][0]?.transcript ?? "";
          if (event.results[i].isFinal) finalText += transcript;
          else interim += transcript;
        }
        // Build the voice portion: prefer final text, fall back to interim
        // so the user sees live feedback as they speak.
        const voiceText = (finalText || interim).trim();
        if (voiceText) {
          setText(baseText + separator + voiceText);
        }
      };
      rec.onerror = (e: any) => {
        // `no-speech` and `aborted` are normal — the user paused or clicked
        // away. Don't log them as scary warnings.
        const err = e?.error ?? "";
        if (err !== "no-speech" && err !== "aborted" && err !== "audio-capture") {
          console.warn("Speech recognition error:", err);
        }
        setRecording(false);
      };
      rec.onend = () => {
        setRecording(false);
        recognitionRef.current = null;
        voiceBaseRef.current = "";
      };
      recognitionRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      console.error("Speech recognition failed to start:", e);
      setRecording(false);
    }
  };

  // Whether the active model supports vision
  const activeModel = localModels.find((m) => m.id === selectedModel);
  const visionSupported = activeModel?.capabilities.includes("vision") ?? false;

  return (
    <div className="relative">
      {/* Suggestion chips — only when empty and not streaming */}
      <AnimatePresence>
        {!text && !streaming && (activeThreadId ? (messages[threadId]?.length ?? 0) === 0 : true) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mb-2 flex flex-wrap items-center gap-1.5 px-2"
          >
            <span className="flex items-center gap-1 text-2xs text-ink-muted">
              <Sparkles className="h-3 w-3" /> Try:
            </span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => applySuggestion(s.prompt)}
                className="rounded-lg border border-line-subtle bg-surface-raised/60 px-2.5 py-1 text-xs text-ink-secondary hover:border-brand-indigo-400/40 hover:text-ink-primary hover:bg-brand-indigo-500/[0.06] transition-colors"
              >
                {s.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        layout
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-2xl border bg-surface-raised/80 backdrop-blur-xl transition-colors",
          dragActive ? "border-brand-indigo-400/60 bg-brand-indigo-500/[0.06]" : "border-line-soft",
        )}
      >
        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 p-2.5 pb-0">
            {attachments.map((a) => (
              <motion.div
                layout
                key={a.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative flex items-center gap-2 rounded-lg border border-line-soft bg-surface-deep/60 pl-1 pr-2 py-1"
              >
                {a.previewUrl ? (
                  <img src={a.previewUrl} alt={a.name} className="h-6 w-6 rounded object-cover" />
                ) : (
                  <div className="grid h-6 w-6 place-items-center rounded bg-brand-gradient-soft text-brand-indigo-300">
                    <Paperclip className="h-3 w-3" />
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="text-xs text-ink-secondary">{a.name}</span>
                  <span className="text-2xs text-ink-faint">{formatBytes(a.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="grid h-4 w-4 place-items-center rounded text-ink-faint hover:bg-status-danger/10 hover:text-status-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 p-2.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Attach button */}
          <Tooltip content="Attach files">
            <IconButton label="Attach" size="md" variant="ghost" onClick={handleFilePick}>
              <Paperclip />
            </IconButton>
          </Tooltip>

          {/* Image button — only shown when model supports vision */}
          {visionSupported && (
            <Tooltip content="Attach image (vision)">
              <IconButton label="Image" size="md" variant="ghost" onClick={handleFilePick}>
                <ImageIcon />
              </IconButton>
            </Tooltip>
          )}

          {/* Textarea */}
          <div className="flex-1 min-w-0">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={streaming ? "Xirea is responding…" : "Send a message…"}
              disabled={streaming}
              minHeight={40}
              maxHeight={240}
              className="border-transparent bg-transparent focus:shadow-none focus:border-transparent"
            />
          </div>

          {/* Voice */}
          <Tooltip content="Voice input">
            <IconButton label="Voice" size="md" variant="ghost" onClick={handleVoice} active={recording}>
              <Mic className={cn(recording && "text-status-danger animate-pulse")} />
            </IconButton>
          </Tooltip>

          {/* Send / Stop */}
          {streaming ? (
            <Tooltip content="Stop generating">
              <IconButton label="Stop" size="md" variant="danger" onClick={onStop}>
                <Square className="h-3.5 w-3.5 fill-current" />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip content="Send (Enter)" shortcut="↵">
              <motion.button
                type="button"
                onClick={handleSend}
                disabled={!text.trim() && attachments.length === 0}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                className={cn(
                  "relative grid h-9 w-9 place-items-center rounded-xl text-white transition-all",
                  "bg-gradient-to-br from-brand-indigo-500 to-brand-indigo-600",
                  "shadow-[0_2px_8px_rgba(99,102,241,0.28)] hover:shadow-[0_4px_12px_rgba(99,102,241,0.36)]",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </motion.button>
            </Tooltip>
          )}
        </div>

        {/* Composer footer — model picker + quick toggles */}
        <div className="flex items-center gap-2 border-t border-line-subtle px-2.5 py-1.5">
          <ModelPickerInline
            value={selectedModel}
            label={selectedModelName}
            options={enabledModels.map((m) => ({ value: m.id, label: m.name, hint: m.source }))}
            onChange={handleSelectModel}
          />
          <div className="mx-1 h-4 w-px bg-line-subtle" />
          <Tooltip content={settings.streaming ? "Streaming on" : "Streaming off"}>
            <button
              type="button"
              onClick={() => update("streaming", !settings.streaming)}
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors",
                settings.streaming ? "text-brand-teal-300 bg-brand-teal-500/10" : "text-ink-muted hover:text-ink-tertiary",
              )}
            >
              <Brain className="h-2.5 w-2.5" /> Stream
            </button>
          </Tooltip>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-2xs text-ink-faint">
              <kbd className="kbd">⇧</kbd> + <kbd className="kbd">↵</kbd> for newline
            </span>
            <IconButton
              label="Generation settings"
              size="xs"
              variant="ghost"
              onClick={() => useUIStore.getState().setRoute("settings")}
            >
              <Settings2 />
            </IconButton>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* Inline model picker — slim dropdown with search + capability filters. */
function ModelPickerInline({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Filter chips: "all" / "text" / "vision" — local GGUF models with the
  // "vision" capability are tagged as vision. Everything else is treated as
  // a text model.
  const [filter, setFilter] = useState<"all" | "text" | "vision">("all");

  // Filter the options client-side based on the search query and capability.
  const filtered = options.filter((opt) => {
    if (query) {
      const q = query.toLowerCase();
      if (!opt.label.toLowerCase().includes(q) && !opt.value.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filter === "vision") {
      // Vision models are tagged with "vision" in their hint, or have
      // "vision" / "vl" / "llava" in their id.
      const h = (opt.hint ?? "").toLowerCase();
      const v = opt.value.toLowerCase();
      const l = opt.label.toLowerCase();
      if (!h.includes("vision") && !v.includes("vision") && !v.includes("vl") && !v.includes("llava") && !l.includes("vision")) {
        return false;
      }
    } else if (filter === "text") {
      // Text models are anything WITHOUT vision capability.
      const h = (opt.hint ?? "").toLowerCase();
      const v = opt.value.toLowerCase();
      const l = opt.label.toLowerCase();
      if (h.includes("vision") || v.includes("vision") || v.includes("vl") || v.includes("llava") || l.includes("vision")) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs font-medium text-ink-secondary hover:bg-overlay/4 hover:text-ink-primary transition-colors"
      >
        {/* Show the model icon — a small CPU/Brain glyph rather than the
            Xirea app icon, so the user knows this is a model selector, not
            a brand button. */}
        <span className="grid h-3.5 w-3.5 place-items-center rounded-sm bg-brand-indigo-500/15 text-brand-indigo-300">
          <Brain className="h-2.5 w-2.5" />
        </span>
        <span className="max-w-[160px] truncate">{label}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full left-0 mb-2 w-[280px] surface-raised rounded-xl border border-line-soft p-1 shadow-elev-3"
          >
            {/* Search input */}
            <div className="flex items-center gap-1.5 rounded-lg border border-line-subtle bg-surface-deep/60 px-2 py-1 mb-1">
              <Search className="h-3 w-3 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="flex-1 bg-transparent text-xs text-ink-primary placeholder:text-ink-faint focus:outline-none"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="cursor-pointer text-ink-faint hover:text-ink-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {/* Filter chips */}
            <div className="flex gap-1 mb-1 px-0.5">
              {(["all", "text", "vision"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "flex-1 rounded-md px-1.5 py-0.5 text-2xs font-medium capitalize transition-colors cursor-pointer",
                    filter === f
                      ? "bg-brand-indigo-500/15 text-brand-indigo-300"
                      : "text-ink-tertiary hover:bg-overlay/4 hover:text-ink-secondary",
                  )}
                >
                  {f === "all" ? "All" : f === "text" ? "Text" : "Vision"}
                </button>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-ink-tertiary">
                  {options.length === 0 ? "No models available." : "No models match your filter."}
                </p>
              )}
              {filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs",
                    value === opt.value ? "bg-brand-indigo-500/[0.14] text-ink-primary" : "text-ink-secondary hover:bg-overlay/4",
                  )}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-brand-indigo-500/10 text-brand-indigo-300">
                    <Brain className="h-2.5 w-2.5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.hint && <span className="block text-2xs text-ink-faint capitalize">{opt.hint}</span>}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
