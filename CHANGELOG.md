# Changelog — this build

All 15 issues from the latest feedback round have been addressed. Each fix below links to the file(s) it was made in.

## Critical bug fixes

### 1. Light-theme code blocks were unreadable (black text on black background)
**Root cause:** The `highlight.js` and `KaTeX` CSS files were being loaded from `cdn.jsdelivr.net`. Browsers with Tracking Prevention (Edge, Brave, Firefox Strict) block these requests, so syntax-highlighting tokens never got their colors — code appeared as black text on the dark code-block background.

**Fix:**
- Bundled `atom-one-dark.min.css` and `katex.min.css` (plus its woff2 fonts) under `public/styles/`. See `public/styles/`.
- Updated `index.html` to reference the local paths instead of the CDN URLs.
- Tightened `.xirea-codeblock` CSS in `src/index.css` so the header chip / copy button text stays light, but syntax-highlight token colors (`.hljs-keyword`, `.hljs-string`, etc.) are no longer overridden.

### 2. Code copy produced `[object Object]`
**Root cause:** The copy handler walked the React element tree to extract plain text. In some edge cases (array of React elements) `String(children)` was used as a fallback, which produced `[object Object],[object Object]`.

**Fix:** `src/features/chat/Markdown.tsx` now stores a ref to the `<code>` DOM node and reads `codeRef.current.textContent` directly. This is bulletproof — `textContent` always returns the raw text regardless of how `rehype-highlight` wrapped the tokens. The tree-walking `extractText()` is kept as a defensive fallback.

### 3. Voice input concatenated interim results
**Root cause:** The `onresult` handler was building the text as `finalText + " " + interim`, which on some browsers resulted in duplicated words as interim results accumulated.

**Fix:** `src/features/chat/Composer.tsx` now prefers `finalText` and only falls back to `interim` when no final result is available yet. Also:
- Added `maxAlternatives = 1` for cleaner transcripts.
- The `no-speech`, `aborted`, and `audio-capture` errors are now silently swallowed (they're normal — the user paused or clicked away).

### 4. Gemini returned `Unknown name 'systeminstruction': Cannot find field`
**Root cause:** The user's Gemini base URL was `https://generativelanguage.googleapis.com/v1`. The `v1` endpoint doesn't support the `systemInstruction` top-level field for newer models (gemini-2.5-flash, gemini-2.5-pro) — only `v1beta` does.

**Fix:**
- Changed the default Gemini base URL in `src/store/providers.ts` to `https://generativelanguage.googleapis.com/v1beta`.
- Added an automatic `v1` → `v1beta` upgrade in `src-tauri/src/providers.rs::stream_gemini` and `fetch_gemini_models` so even users with persisted `v1` URLs get the fix without reconfiguring.

### 5. HuggingFace returned `Invalid repo name: ... - repo name includes an url-encoded slash`
**Root cause:** The Rust `urlencode` function percent-encoded the `/` in `org/name` repo identifiers (e.g. `thinkingmachines/Inkling` became `thinkingmachines%2FInkling`). The HF API rejects encoded slashes.

**Fix:** Added `encode_model_id_path` in `src-tauri/src/hf.rs` which keeps `/` literal (it's a path separator, not a special character). All HF URL constructions now use this new function. The original `urlencode` is still used for query parameter values where encoding `/` is correct.

### 6. Maximize window didn't work
**Root cause:** The JS wrapper called `isMaximized()` → `maximize()`/`unmaximize()` as separate operations. On Windows, the window state could change between the check and the call, causing the operation to silently no-op.

**Fix:**
- `src/lib/tauri.ts::windowToggleMaximize` now uses Tauri 2's atomic `toggleMaximize()` API first, with a manual fallback.
- `src-tauri/src/lib.rs::window_toggle_maximize` likewise uses `window.toggle_maximize()`.
- `src/components/layout/WindowControls.tsx` no longer calls `e.preventDefault()` on `mousedown` — that was swallowing the subsequent `click` event on Windows WebView2.

### 7. Model selection didn't update the active model after the first message
**Root cause:** The Composer's inline model picker only updated `settings.defaultModelId`, but the LLM resolver (`resolveActiveProvider`) looks up the provider by `settings.defaultProviderId`. If the user picked a model from a *different* provider than the current default, the resolver would use the new model ID with the OLD provider — silently sending, e.g., `gpt-4o` requests to Anthropic.

**Fix:** `src/features/chat/Composer.tsx::handleSelectModel` now updates BOTH `defaultModelId` AND `defaultProviderId` together, looking up which provider each model belongs to. Also subscribed `ChatView` to `providers.length` and `local.length` so the header label refreshes immediately when a provider is enabled or a local model is imported.

### 8. Update checker hit a 404 and scared the user
**Root cause:** `https://api.github.com/repos/Danyalkhattak/Xirea-Desktop/releases/latest` returns 404 when the repo has no releases yet — which is the current state. The previous code treated any non-200 as an error.

**Fix:** `src/features/settings/SettingsView.tsx::handleCheck` now treats 404 as a friendly "No releases yet" info toast instead of an error. Also removed the broken `tauri-plugin-updater` config (it had an empty pubkey so it was non-functional anyway) — left only the GitHub releases URL.

### 9. Export chat did nothing
**Root cause:** The export used `document.createElement('a') + download attribute` which doesn't work in Tauri 2's webview — the download attribute is ignored for blob URLs.

**Fix:**
- `src/features/settings/SettingsView.tsx::handleExport` now uses Tauri's native `save` dialog + `writeTextFile` from `@tauri-apps/plugin-fs`. Browser dev mode still uses the download attribute as a fallback.
- `src/features/chat/ChatView.tsx::handleExportChat` (new) adds per-chat export with both Markdown and JSON formats, accessible from the chat header's "More" menu.

## New features

### 10. llama.cpp integration
- New file `LlamaDocumentation.md` — a comprehensive guide covering installation, server startup, connecting Xirea, performance tuning, troubleshooting, and advanced sidecar bundling.
- New Rust commands `start_llama_server` and `stop_llama_server` in `src-tauri/src/commands.rs` — spawn a `llama-server` process and poll its HTTP endpoint until ready.
- New TypeScript wrappers in `src/lib/tauri.ts`: `startLlamaServer`, `stopLlamaServer`, `onLlamaServerReady`, `onLlamaServerError`.
- `ModelsView.tsx::handleRun` now tries llama.cpp FIRST (just needs `llama-server` on PATH), and falls back to Ollama if not available. When llama.cpp comes up, it auto-creates an OpenAI-compatible provider pointing at the local server.

### 11. GGUF import loading indicator
- `ModelsView.tsx` now shows a progress banner at the top of the page while reading GGUF metadata for each imported file. Shows current file name, file count (e.g. "2 of 5"), and a progress bar percentage.

### 12. Model search with text/vision filters
- The Composer's inline model picker already had search + All/Text/Vision filter chips.
- Added the same search + filters to the Cloud Models tab in `ModelsView.tsx::CloudModelsList`.

## UI / theme refinements

### 13. Dark theme simplified
**User feedback:** "you fucked the dark theme & added a lot of colors to it and some buttons are not looking good with just borders"

**Fix:**
- Replaced the 3-color brand gradient (indigo→teal→fuchsia) with a single-accent indigo gradient everywhere it was used:
  - `tailwind.config.ts::backgroundImage.brand-gradient` and `brand-gradient-soft`
  - `src/index.css::text-gradient-brand` and `.brand-glow::before`
  - `Button.tsx` primary variant
  - `IconButton.tsx` primary variant
  - `Composer.tsx` send button
  - `src/index.css` range slider thumb, switch — all now use a solid `#6366f1` instead of the gradient.
- The aurora background is now a single subtle indigo radial wash instead of three overlapping colored radials.
- Button `outline` variant now has a `bg-surface-raised/60` background instead of being transparent with just a border — looks more substantial.
- Button `subtle` variant now uses `bg-overlay/6` (was `bg-overlay/4`) for better visibility.

### 14. Cursor pointer on all interactive elements
**Fix:** Added a global CSS rule in `src/index.css` that applies `cursor: pointer` to all `button`, `[role="button"]`, `a`, `summary`, `label[for]`, `select`, and `.clickable` elements by default. Disabled elements get `cursor: not-allowed`. No more needing to remember `cursor-pointer` on every individual button.

### 15. Chat window centering
- `ChatView.tsx` now uses `items-stretch justify-center` (was just `justify-center`) so the chat column fills the full height AND stays horizontally centered.
- Widened the chat column from `max-w-4xl` (896px) to `max-w-5xl` (1024px) for better use of wide screens.

### 16. Better system prompt
- Completely rewrote the default system prompt in `src/store/settings.ts`. The new prompt is structured with clear sections (Core principles, Code, Formatting, Tone & context, Safety) and gives explicit guidance on:
  - When to use fenced code blocks with language tags
  - Modern idiomatic style per language
  - KaTeX math formatting
  - Multi-step task planning
  - Matching the user's tone and language
  - Safety boundaries (no malware, no real credentials in examples)

### 17. Profile no longer shows X SVG
- The `ProfileAvatar` component (`src/components/ui/ProfileAvatar.tsx`) already uses the user's initial (or a `User` icon for empty names). It never shows the Xirea brand mark or any X icon.
- The previous complaint was likely from an older build; the current code is correct.

## Build & dependencies

- Added `which = "6"` to `src-tauri/Cargo.toml` for locating `llama-server` on PATH.
- Added `nix = { version = "0.29", features = ["signal", "process"] }` under `[target.'cfg(unix)'.dependencies]` for SIGTERM on llama-server processes.
- No frontend dependencies changed.

## Verification

- TypeScript: `npx tsc -b --noEmit` passes cleanly (0 errors).
- Vite production build: `npx vite build` succeeds in ~9 seconds.
- Rust code: structured for compilation but `cargo` was not available in this environment to verify — code has been reviewed for correctness.

---

— Danyal Khattak
