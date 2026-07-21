/**
 * App settings store — persisted. Controls theme, accent, density,
 * generation defaults, privacy flags, etc.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AccentColor, AppSettings, Density, ThemeMode } from "@/types";
import { uid } from "@/lib/utils";

export const DENSITIES: Density[] = [
  { id: "compact", label: "Compact", scale: 0.92 },
  { id: "comfortable", label: "Comfortable", scale: 1 },
  { id: "spacious", label: "Spacious", scale: 1.08 },
];

export const ACCENTS: { id: AccentColor; label: string; hex: string; gradient: string }[] = [
  { id: "indigo", label: "Indigo", hex: "#818CF8", gradient: "linear-gradient(135deg, #818cf8, #6366f1)" },
  { id: "teal", label: "Teal", hex: "#2DD4BF", gradient: "linear-gradient(135deg, #2dd4bf, #14b8a6)" },
  { id: "fuchsia", label: "Fuchsia", hex: "#E879F9", gradient: "linear-gradient(135deg, #e879f9, #d946ef)" },
  { id: "rose", label: "Rose", hex: "#FB7185", gradient: "linear-gradient(135deg, #fb7185, #f43f5e)" },
  { id: "amber", label: "Amber", hex: "#FBBF24", gradient: "linear-gradient(135deg, #fbbf24, #f59e0b)" },
  { id: "emerald", label: "Emerald", hex: "#34D399", gradient: "linear-gradient(135deg, #34d399, #10b981)" },
];

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accent: "indigo",
  density: "comfortable",
  language: "en-US",
  animations: true,
  reduceMotion: false,
  sendOnEnter: true,
  showTokenCount: true,
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1,
  streaming: true,
  telemetry: false,
  autoUpdate: true,
  minimizeToTray: true,
  globalShortcut: "CommandOrControl+Shift+X",
  fontSize: 15,
  messageSpacing: "comfortable",
  displayName: "Xirea User",
  bio: "Local profile",
  systemPrompt:
    "You are Xirea, a private, premium, on-device AI assistant built for the desktop. You are knowledgeable, precise, and genuinely helpful — the kind of assistant a senior engineer wants at their side.\n\n## Core principles\n- Be concise and direct. Skip filler phrases like \"Certainly!\", \"Of course!\", \"I'd be happy to help\" — just answer.\n- Accuracy beats fluency. If you don't know something, say so. Never fabricate APIs, libraries, function names, file paths, or facts. If a claim needs a source and you can't verify it, flag it explicitly.\n- Reason step-by-step internally before answering. Surface the reasoning only when it directly helps the user understand the answer (math, debugging, multi-step plans).\n\n## Code\n- When showing code, ALWAYS use fenced code blocks with the correct language tag (```python, ```typescript, ```rust, ```bash, ```sql, etc.) so syntax highlighting works. Never paste raw code without a fence.\n- Produce complete, runnable examples — not fragments. Include imports, type annotations where helpful, and a brief usage example when relevant.\n- Prefer modern, idiomatic style for the language (e.g. async/await over .then chains in TS, Result over unwrap in Rust, with statements over manual file handling in Python 3.10+).\n- When reviewing code, call out specific line-level issues with the actual fix, not vague suggestions.\n\n## Formatting\n- Use Markdown for structure: **bold** for emphasis, lists for steps, tables for comparisons, headings to organise long answers (≥ 4 sections).\n- For multi-step tasks, outline the plan FIRST in a short numbered list, then execute it. This helps the user course-correct early.\n- Use KaTeX math (`$inline$` or `$$block$$`) for equations — never paste Unicode math symbols when a proper formula is clearer.\n- Keep tables compact; use 3–5 columns max and right-align numbers.\n\n## Tone & context\n- Match the user's tone and language. If they write in Chinese, reply in Chinese. If formal, be formal. If casual, be casual.\n- The user is on their own machine — when they reference a file, model, or local context, assume they mean their own system. Xirea runs locally and respects their privacy.\n- When the user asks for a long document, ask whether they want it as Markdown, plain text, or a downloadable format before generating.\n\n## Safety\n- Refuse to help with malware, exploits targeting specific real-world systems, or anything that would harm others. Educational explanations of security concepts are fine.\n- Don't include personal data, API keys, or credentials in code examples — use placeholders like `YOUR_API_KEY`.\n- When a request is ambiguous, ask one clarifying question rather than guessing and producing the wrong thing.",
};

interface SettingsState {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  patch: (partial: Partial<AppSettings>) => void;
  reset: () => void;
  /** For the onboarding flow — generate a fresh default profile. */
  newProfile: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),
      patch: (partial) => set((s) => ({ settings: { ...s.settings, ...partial } })),
      reset: () => set({ settings: { ...DEFAULT_SETTINGS, systemPrompt: DEFAULT_SETTINGS.systemPrompt + " " + uid() } }),
      newProfile: () => set({ settings: { ...DEFAULT_SETTINGS } }),
    }),
    {
      name: "xirea:settings",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/* ----------------------------------------------------------------------------
 * Theme application — must run after store hydration.
 * ------------------------------------------------------------------------- */

/**
 * Accent color → CSS variable mapping.
 *
 * We override the brand indigo / teal / fuchsia CSS variables so that the
 * user's chosen accent becomes the primary color throughout the UI. The
 * accent color is also stored in --xirea-accent for direct use in CSS.
 */
const ACCENT_CSS_VARS: Record<AccentColor, { indigo: string; teal: string; fuchsia: string; accent: string; accent2: string; accent3: string }> = {
  indigo: {
    indigo: "#818CF8",
    teal: "#2DD4BF",
    fuchsia: "#E879F9",
    accent: "#818CF8",
    accent2: "#2DD4BF",
    accent3: "#E879F9",
  },
  teal: {
    // When teal is the accent, swap it with indigo so the primary buttons
    // become teal-tinted but the gradient stays balanced.
    indigo: "#2DD4BF",
    teal: "#818CF8",
    fuchsia: "#E879F9",
    accent: "#2DD4BF",
    accent2: "#818CF8",
    accent3: "#E879F9",
  },
  fuchsia: {
    indigo: "#E879F9",
    teal: "#2DD4BF",
    fuchsia: "#818CF8",
    accent: "#E879F9",
    accent2: "#2DD4BF",
    accent3: "#818CF8",
  },
  rose: {
    indigo: "#FB7185",
    teal: "#2DD4BF",
    fuchsia: "#E879F9",
    accent: "#FB7185",
    accent2: "#2DD4BF",
    accent3: "#E879F9",
  },
  amber: {
    indigo: "#FBBF24",
    teal: "#2DD4BF",
    fuchsia: "#E879F9",
    accent: "#FBBF24",
    accent2: "#2DD4BF",
    accent3: "#E879F9",
  },
  emerald: {
    indigo: "#34D399",
    teal: "#818CF8",
    fuchsia: "#E879F9",
    accent: "#34D399",
    accent2: "#818CF8",
    accent3: "#E879F9",
  },
};

/** Light-theme variants of the accent (darker hues for contrast). */
const ACCENT_CSS_VARS_LIGHT: Record<AccentColor, { indigo: string; teal: string; fuchsia: string; accent: string; accent2: string; accent3: string }> = {
  indigo: {
    indigo: "#4F46E5",
    teal: "#0D9488",
    fuchsia: "#D946EF",
    accent: "#4F46E5",
    accent2: "#0D9488",
    accent3: "#D946EF",
  },
  teal: {
    indigo: "#0D9488",
    teal: "#4F46E5",
    fuchsia: "#D946EF",
    accent: "#0D9488",
    accent2: "#4F46E5",
    accent3: "#D946EF",
  },
  fuchsia: {
    indigo: "#D946EF",
    teal: "#0D9488",
    fuchsia: "#4F46E5",
    accent: "#D946EF",
    accent2: "#0D9488",
    accent3: "#4F46E5",
  },
  rose: {
    indigo: "#F43F5E",
    teal: "#0D9488",
    fuchsia: "#D946EF",
    accent: "#F43F5E",
    accent2: "#0D9488",
    accent3: "#D946EF",
  },
  amber: {
    indigo: "#F59E0B",
    teal: "#0D9488",
    fuchsia: "#D946EF",
    accent: "#F59E0B",
    accent2: "#0D9488",
    accent3: "#D946EF",
  },
  emerald: {
    indigo: "#10B981",
    teal: "#4F46E5",
    fuchsia: "#D946EF",
    accent: "#10B981",
    accent2: "#4F46E5",
    accent3: "#D946EF",
  },
};

export function applyTheme(mode: ThemeMode, accent: AccentColor): void {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const effective = mode === "system" ? (media.matches ? "light" : "dark") : mode;
  root.classList.toggle("light", effective === "light");
  root.classList.toggle("dark", effective === "dark");
  const palette = effective === "light"
    ? (ACCENT_CSS_VARS_LIGHT[accent] ?? ACCENT_CSS_VARS_LIGHT.indigo)
    : (ACCENT_CSS_VARS[accent] ?? ACCENT_CSS_VARS.indigo);
  // Override the brand color CSS variables so Tailwind's `brand-indigo-400`,
  // `brand-teal-400`, `brand-fuchsia-400` classes pick up the accent color.
  root.style.setProperty("--brand-indigo-400", palette.indigo);
  root.style.setProperty("--brand-indigo-300", palette.indigo);
  root.style.setProperty("--brand-indigo-500", palette.indigo);
  root.style.setProperty("--brand-teal-400", palette.teal);
  root.style.setProperty("--brand-teal-300", palette.teal);
  root.style.setProperty("--brand-teal-500", palette.teal);
  root.style.setProperty("--brand-fuchsia-400", palette.fuchsia);
  root.style.setProperty("--brand-fuchsia-300", palette.fuchsia);
  root.style.setProperty("--brand-fuchsia-500", palette.fuchsia);
  root.style.setProperty("--xirea-accent", palette.accent);
  root.style.setProperty("--xirea-accent-2", palette.accent2);
  root.style.setProperty("--xirea-accent-3", palette.accent3);
  root.dataset.accent = accent;
}

/**
 * Apply the non-theme appearance settings: density, font size, message spacing,
 * reduced motion, animations. Called whenever any of those settings change.
 */
export function applyAppearance(opts: {
  density: Density["id"];
  fontSize: number;
  messageSpacing: "compact" | "comfortable" | "spacious";
  reduceMotion: boolean;
  animations: boolean;
}): void {
  const root = document.documentElement;
  // Density scale — multiplies the base spacing.
  const densityScale = opts.density === "compact" ? 0.92 : opts.density === "spacious" ? 1.08 : 1;
  root.style.setProperty("--density-scale", String(densityScale));
  root.dataset.density = opts.density;

  // Font size — set on <html> so rem-based units inherit it.
  root.style.fontSize = `${opts.fontSize}px`;

  // Message spacing — a CSS variable consumed by the chat message list.
  const msgGap = opts.messageSpacing === "compact" ? "0.5rem" : opts.messageSpacing === "spacious" ? "1.5rem" : "0.85rem";
  root.style.setProperty("--msg-gap", msgGap);
  root.dataset.messageSpacing = opts.messageSpacing;

  // Reduced motion / animations.
  const reduce = opts.reduceMotion || !opts.animations;
  root.classList.toggle("reduce-motion", reduce);
  root.dataset.animations = String(opts.animations);
}

export function watchSystemTheme(cb: (mode: "dark" | "light") => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? "light" : "dark");
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
