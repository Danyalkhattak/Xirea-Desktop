# Contributing to Xirea Desktop

Thanks for taking the time to contribute — Xirea is a small project and every
PR, issue, and review helps.

## Quick start

```bash
git clone https://github.com/Danyalkhattak/Xirea-Desktop.git
cd Xirea-Desktop
npm install
npm run tauri dev
```

See [`README.md`](./README.md) for the full prerequisites list (Rust ≥ 1.77,
Node ≥ 20, and platform-specific system libraries on Linux).

## Code map

```
.
├── src/                      # React + TypeScript frontend
│   ├── components/ui/        # Reusable UI primitives (Button, Card, etc.)
│   ├── components/layout/    # App shell, Sidebar, Topbar, CommandPalette
│   ├── features/             # One folder per top-level feature
│   │   ├── chat/             # Chat surface
│   │   ├── models/           # Local model management (ModelsView)
│   │   ├── huggingface/      # HF Hub browser + downloader
│   │   ├── downloads/        # Download queue UI
│   │   ├── providers/        # Cloud provider config
│   │   ├── settings/         # Settings panels
│   │   └── prompts/          # Saved prompt library
│   ├── store/                # Zustand stores (one per domain)
│   ├── lib/                  # Frontend utilities
│   │   ├── tauri.ts          # Single API surface for Rust commands
│   │   ├── llm.ts            # Provider routing helpers
│   │   └── utils.ts          # Generic helpers
│   └── types/                # Shared TS types
│
├── src-tauri/                # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── lib.rs            # Plugin wiring + command registration
│   │   ├── main.rs           # Binary entry point
│   │   ├── commands.rs       # Tauri command handlers
│   │   ├── providers.rs      # Cloud chat (OpenAI / Anthropic / Gemini)
│   │   ├── hf.rs             # Hugging Face Hub API client
│   │   ├── downloader.rs     # Streaming download manager (pause/resume)
│   │   ├── gguf.rs           # Real GGUF metadata parser
│   │   ├── system_info.rs    # Disk / CPU / GPU / RAM detection
│   │   ├── benchmark.rs      # Real prompt-eval + gen-speed benchmark
│   │   └── verify.rs         # SHA-256 + size verification
│   ├── binaries/             # Drop llama-server-<triple> here before build
│   ├── capabilities/         # Tauri 2 capability files
│   ├── icons/                # App icons
│   └── tauri.conf.json       # Tauri config
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # Lint + typecheck + cargo check
│   │   └── build.yml         # Build macOS + Linux bundles on tag push
│   ├── ISSUE_TEMPLATE/       # Bug report + feature request templates
│   └── PULL_REQUEST_TEMPLATE.md
│
├── package.json              # Frontend dependencies + scripts
├── tailwind.config.ts        # Tailwind theme — single-accent palette
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Before you open a PR

Run all three checks locally — CI runs the same set:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
(cd src-tauri && cargo check --all-targets)
```

For Rust changes, also run:

```bash
(cd src-tauri && cargo fmt --check)
(cd src-tauri && cargo clippy --all-targets -- -D warnings)
```

## Event-name discipline (Tauri 2)

Tauri 2's `listen()` command rejects event names containing anything other
than `A-Z a-z 0-9 - _ / :`. **Never** embed a model path, download id, or
session id in the event name — put it inside the JSON payload instead.

The backend exports these FIXED event-name constants in
`src-tauri/src/commands.rs`:

| Constant                  | Event name              |
|---------------------------|-------------------------|
| `EVENT_CHAT_DELTA`        | `chat-delta`            |
| `EVENT_CHAT_ERROR`        | `chat-error`            |
| `EVENT_CHAT_CANCEL`       | `chat-cancel`           |
| `EVENT_DOWNLOAD_PROGRESS` | `download-progress`     |
| `EVENT_DOWNLOAD_COMPLETE` | `download-complete`     |
| `EVENT_LLAMA_LOG`         | `llama-server-log`      |
| `EVENT_LLAMA_READY`       | `llama-server-ready`    |
| `EVENT_LLAMA_ERROR`       | `llama-server-error`    |
| `EVENT_MODEL_LOAD_PROGRESS`| `model-load-progress`  |
| `EVENT_MODEL_LOAD_DONE`   | `model-load-done`       |
| `EVENT_MODEL_LOAD_ERROR`  | `model-load-error`      |

Frontend listeners subscribe to the FIXED event name and filter by
`session` / `id` in the payload. See `src/lib/tauri.ts` for examples.

## Real-data rule

**No mock values, no fake progress bars, no simulated percentages.** Every
number on the Models page comes from a real query:

- Disk usage: `sysinfo::Disks` → `get_system_info_command` /
  `get_models_disk_info`
- RAM / CPU: `sysinfo::System`
- GPU / VRAM: `nvidia-smi` (NVIDIA) / `system_profiler` (Apple) /
  `rocm-smi` (AMD)
- SHA-256: real `sha2` computation, streamed in 1 MiB chunks
- Download progress: real `reqwest::bytes_stream` chunks, throttled to 10
  events/sec
- Benchmark: real chat completion against the running llama-server

If you can't get the real value, return `None` / `null` and let the UI hide
the field. Don't make up a number.

## Adding a new Tauri command

1. Write the command in `src-tauri/src/commands.rs` (or the appropriate
   submodule — `system_info.rs`, `hf.rs`, etc.).
2. Register it in the `tauri::generate_handler!` list in
   `src-tauri/src/lib.rs`.
3. Add a typed wrapper in `src/lib/tauri.ts`. Use the existing wrappers as
   a template — they handle the `isTauri()` check, browser fallback, and
   argument-name conversion (Tauri expects `camelCase` on the JS side and
   `snake_case` on the Rust side; the wrappers do the conversion for you).
4. Add the corresponding TS type in `src/types/` if the command returns a
   non-trivial shape.

## Adding a new cloud provider

1. Add the provider kind to `ProviderKind` in `src/types/`.
2. Implement streaming in `src-tauri/src/providers.rs` — either as an
   OpenAI-compatible shim (most providers) or a native implementation
   (Anthropic, Gemini).
3. Implement model listing in the same file.
4. Add a Settings panel entry in `src/features/settings/` so users can
   configure the API key + base URL.

## llama.cpp sidecar

Xirea bundles `llama-server` as a Tauri sidecar. The binary lives in
`src-tauri/binaries/` and MUST be named `llama-server-<target-triple>` (e.g.
`llama-server-aarch64-apple-darwin`). See
[`src-tauri/binaries/README.md`](./src-tauri/binaries/README.md) and
[`LlamaDocumentation.md`](./LlamaDocumentation.md) for the full guide.

If you add a new `--flag` to the llama-server invocation, do it in
`start_llama_server` in `src-tauri/src/commands.rs`. The same flag must be
added to BOTH the sidecar path and the PATH-fallback path.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
