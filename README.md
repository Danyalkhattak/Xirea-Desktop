<div align="center">

# Xirea Desktop

<p align="center">
  <a href="https://github.com/Danyalkhattak/Xirea-Desktop/releases">
    <img src="https://img.shields.io/github/v/release/Danyalkhattak/Xirea-Desktop?style=for-the-badge&logo=github&color=6366F1" alt="Latest Release"/>
  </a>

  <a href="https://github.com/Danyalkhattak/Xirea-Desktop/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/Danyalkhattak/Xirea-Desktop?style=for-the-badge&logo=opensourceinitiative&logoColor=white&color=10B981" alt="License"/>
  </a>

  <a href="#">
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-2563EB?style=for-the-badge&logo=tauri&logoColor=white" alt="Platform"/>
  </a>

  <a href="#">
    <img src="https://img.shields.io/badge/Framework-Tauri%202-8B5CF6?style=for-the-badge&logo=tauri&logoColor=white" alt="Framework"/>
  </a>

  <a href="#">
    <img src="https://img.shields.io/badge/Local%20AI-llama.cpp-F97316?style=for-the-badge&logo=llama&logoColor=white" alt="Local AI"/>
  </a>

  <a href="#">
    <img src="https://img.shields.io/badge/Privacy-On--Device-10B981?style=for-the-badge&logo=shield&logoColor=white" alt="Privacy"/>
  </a>

  <a href="#">
    <img src="https://img.shields.io/badge/Version-1.0.0-818CF8?style=for-the-badge&logo=semanticweb&logoColor=white" alt="Version"/>
  </a>

  <a href="https://github.com/Danyalkhattak/Xirea-Desktop">
    <img src="https://api.visitorbadge.io/api/visitors?path=Danyalkhattak/Xirea-Desktop&label=Visitors&labelColor=%236366F1&countColor=%2310B981" alt="Visitors"/>
  </a>
</p>

Private, on-device AI chat that runs local GGUF models via [llama.cpp](https://github.com/ggml-org/llama.cpp) and connects to 10+ cloud providers from a single keyboard-driven workspace.


[Platforms](#platforms) · [Install](#install) · [Build from source](#build-from-source) · [Features](#features) · [Architecture](#architecture) · [Contributing](#contributing)

</div>

---

## Why Xirea?

- **Private by default.** Local models run entirely on-device via a bundled `llama-server` sidecar. Cloud providers are opt-in per-chat.
- **One workspace, every model.** Browse Hugging Face, download with real pause/resume, and run GGUF files alongside OpenAI / Anthropic / Gemini / Groq / Mistral / Ollama — no context switching.
- **Real hardware awareness.** Disk, CPU, GPU, VRAM, CUDA / Metal / ROCm / Vulkan detection drives a compatibility check on every model card. No mock values.
- **Production-quality Rust backend.** Streaming downloads with HTTP Range resume, real-time llama-server stdout parsing, SHA-256 verification, live benchmarking.

> The Android app has been stable since v2.0.0. This is the **official desktop port** — same brand, same privacy-first philosophy, rebuilt for large screens.

## Platforms

| Platform | Status | Repository |
|----------|--------|------------|
| 🖥️ Desktop | ✅ Stable | https://github.com/Danyalkhattak/Xirea-Desktop |
| 📱 Android | ✅ Stable | https://github.com/Danyalkhattak/Xirea |

---

## Install

Pre-built binaries are published on the [releases page](https://github.com/Danyalkhattak/Xirea-Desktop/releases). The CI pipeline in [`.github/workflows/build.yml`](./.github/workflows/build.yml) produces a DMG for macOS (Apple Silicon + Intel) and an AppImage + .deb for Linux on every `v*` tag push.

> macOS binaries are unsigned by default — right-click → **Open** → **Open anyway** in System Settings → Privacy & Security on first launch.

## Build from source

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 LTS | Tested on 24 |
| Rust | ≥ 1.77 | Installed via [rustup](https://rustup.rs) |
| System libs | see below | Linux only |

#### Linux system dependencies

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  pkg-config \
  libgtk-3-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev
```

#### macOS

```bash
xcode-select --install
```

#### Windows

Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/).

### Build & run

```bash
git clone https://github.com/Danyalkhattak/Xirea-Desktop.git
cd Xirea-Desktop
npm install
npm run tauri dev
```

The first run compiles the Rust backend — subsequent runs are fast thanks to incremental compilation.

### Production build

```bash
npm run tauri build
```

Bundles land in `src-tauri/target/release/bundle/`.


## Features

### Chat
- Streaming responses with thinking indicator and live token counter
- Full Markdown — GFM, syntax-highlighted code with copy buttons, KaTeX math, tables, task lists
- Message actions — copy, edit, regenerate, pin, bookmark, delete
- Attachments — drag & drop, paste, multi-image, file picker
- Vision auto-enabled when the selected model supports it

### Models
- Local GGUF/GGML with full metadata: architecture, context length, parameters, quantization, RAM/VRAM estimates, capabilities
- Drag & drop import, run/stop with live status
- Real storage tracking from the disk containing `~/.xirea/models`
- Hardware panel — CPU, GPU, RAM, VRAM, CUDA / Metal / ROCm / Vulkan
- Tabs: Installed · Running · Favorites · Cloud · Recommended

### Hugging Face
- Browse in-app — no browser required
- Search by name, author, or tag; filter by Trending / Most downloaded / Newest / Verified
- Detail drawer with description, downloads, likes, tags, quantizations, file list
- Real streaming downloads with pause / resume / retry / cancel (HTTP Range resume)
- Auto-imports completed downloads into the Models page

### Providers
- 10 providers: OpenAI, Anthropic, Google Gemini, Groq, Mistral, OpenRouter, Azure OpenAI, Ollama, LM Studio, OpenAI-compatible, Custom
- Real latency health check via Rust `reqwest`
- Fetch models from each provider's `/models` endpoint
- API key vault — masked input, stored locally, never synced

### Downloads
- Queue management with active / paused / failed / completed sections
- Real progress, speed, ETA — calculated from `downloadedBytes / totalBytes`
- HTTP Range-based resume — never restarts from 0%
- SHA-256 + size verification after completion

### llama.cpp integration
- Bundled sidecar with PATH fallback — just works if the binary is dropped in
- Real stdout parsing — emits semantic phase events (`loading-tensors`, `cuda-init`, `kv-cache`, `ready`, `error`)
- Actionable diagnostics — "AVX2 binary on AVX-only CPU", "CUDA init failed", "GGUF corrupted"
- Multi-session — run multiple llama-server processes on different ports safely

### Desktop-native
- Custom window chrome with native dragging
- System tray support (hide-on-close on non-macOS)
- Global shortcuts (Cmd+Shift+X to focus)
- Native notifications, clipboard manager, auto-update support
- Command palette (Cmd+K) — jump to any route, chat, model, provider, prompt, or file

## Architecture

```
xirea-desktop/
├── src/                      # React + TypeScript frontend
│   ├── components/
│   │   ├── ui/               # Primitives (Button, Card, Modal, …)
│   │   └── layout/           # AppShell, TopBar, Sidebar, CommandPalette
│   ├── features/             # One folder per top-level feature
│   │   ├── chat/             # Chat surface
│   │   ├── models/           # ModelsView — local model management
│   │   ├── huggingface/      # HF Hub browser + downloader
│   │   ├── downloads/        # Download queue UI
│   │   ├── providers/        # Cloud provider config
│   │   ├── settings/         # Settings panels
│   │   └── prompts/          # Saved prompt library
│   ├── store/                # Zustand stores (one per domain)
│   ├── lib/
│   │   ├── tauri.ts          # Single API surface for Rust commands
│   │   ├── llm.ts            # Provider routing helpers
│   │   └── utils.ts          # Generic helpers
│   └── types/                # Shared TS types
│
├── src-tauri/                # Rust backend (Tauri 2)
│   └── src/
│       ├── lib.rs            # Plugin wiring + command registration
│       ├── main.rs           # Binary entry point
│       ├── commands.rs       # Tauri command handlers + event-name constants
│       ├── providers.rs      # Cloud chat — OpenAI / Anthropic / Gemini
│       ├── hf.rs             # Hugging Face Hub API client
│       ├── downloader.rs     # Streaming downloads with pause/resume/cancel
│       ├── gguf.rs           # Real GGUF metadata parser
│       ├── system_info.rs    # Disk / CPU / GPU / RAM detection
│       ├── benchmark.rs      # Real prompt-eval + generation-speed benchmark
│       └── verify.rs         # SHA-256 + size verification
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # Lint + typecheck + cargo check
│   │   └── build.yml         # Build macOS + Linux bundles on tag push
│   ├── ISSUE_TEMPLATE/       # Bug report + feature request templates
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
│
├── package.json
├── tailwind.config.ts        # Single-accent palette (bound to CSS vars)
├── tsconfig.json
├── vite.config.ts
├── LICENSE                   # MIT
├── CONTRIBUTING.md
└── README.md
```

### Event-name discipline (Tauri 2)

Tauri 2's `listen()` rejects event names containing anything other than `A-Z a-z 0-9 - _ / :`. Xirea uses a fixed set of event names and routes by `sessionId` / `id` / `modelPath` inside the JSON payload:

| Event name              | Payload                                              |
|-------------------------|------------------------------------------------------|
| `chat-delta`            | `{ id, delta, accumulated, tokens, done, reason }`   |
| `chat-error`            | `{ id, error }`                                      |
| `chat-cancel`           | `{ id }`                                             |
| `download-progress`     | `{ id, receivedBytes, totalBytes, speedBps, ... }`  |
| `download-complete`     | `{ id, path, totalBytes }`                           |
| `llama-server-log`      | `{ session, modelPath, stream, line, phase }`        |
| `llama-server-ready`    | `{ session, modelPath, port, url }`                  |
| `llama-server-error`    | `{ session, modelPath, error, diagnostic }`          |
| `model-load-progress`   | `{ id, percent, message, model }` (Ollama only)      |
| `model-load-done`       | `{ id, model }`                                      |
| `model-load-error`      | `{ id, error }`                                      |

The constants live in `src-tauri/src/commands.rs` (`EVENT_CHAT_DELTA`, `EVENT_LLAMA_LOG`, etc.).

## Contributing

PRs, issues, and reviews are all welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide — the short version:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
(cd src-tauri && cargo check --all-targets)
```

CI runs the same checks on every push (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

**Real-data rule:** no mock values, no fake progress bars, no simulated percentages. If you can't get the real value, return `None` / `null` and let the UI hide the field.

## License

[MIT](./LICENSE) — © 2026 Danyal Khattak.

Xirea bundles [llama.cpp](https://github.com/ggml-org/llama.cpp) when a `llama-server-<target-triple>` binary is dropped into `src-tauri/binaries/` before building. llama.cpp is also MIT-licensed.
