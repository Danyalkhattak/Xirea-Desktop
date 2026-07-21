# llama.cpp Integration for Xirea Desktop

This document explains how Xirea Desktop integrates with [llama.cpp](https://github.com/ggml-org/llama.cpp) for running local GGUF models on your own hardware — no cloud, no API keys, fully private.

> **Why llama.cpp?** It's the fastest, most portable CPU/GPU inference engine for GGUF models. It supports every major architecture (Llama, Mistral, Qwen, Gemma, Phi, DeepSeek, Command-R, etc.), runs on CPU-only laptops and discrete GPUs alike, and has a built-in OpenAI-compatible HTTP server that Xirea can talk to directly.

---

## Table of contents

1. [TL;DR — three-second summary](#tldr--three-second-summary)
2. [Architecture overview](#architecture-overview)
3. [Bundled vs PATH fallback — which binary does Xirea use?](#bundled-vs-path-fallback--which-binary-does-xirea-use)
4. [For developers — drop the binary into `src-tauri/binaries/<subfolder>/` before building](#for-developers--drop-the-binary-into-src-tauribinariessubfolder-before-building)
5. [For end users — clicking Run on a local GGUF model](#for-end-users--clicking-run-on-a-local-gguf-model)
6. [Installing llama.cpp yourself (PATH fallback)](#installing-llamacpp-yourself-path-fallback)
7. [Starting the llama.cpp server manually](#starting-the-llamacpp-server-manually)
8. [Connecting Xirea to a manually-started server](#connecting-xirea-to-a-manually-started-server)
9. [Performance tuning](#performance-tuning)
10. [Troubleshooting](#troubleshooting)
11. [Advanced — multiple GPU variants, custom builds, LAN serving](#advanced--multiple-gpu-variants-custom-builds-lan-serving)
12. [Event reference — what Xirea emits while spawning the runtime](#event-reference--what-xirea-emits-while-spawning-the-runtime)

---

## TL;DR — three-second summary

- **Xirea bundles `llama-server` inside its installer.** End users do **not** need to install llama.cpp themselves — they click Run on a GGUF model and it just works.
- **Developers** must drop a `llama-server` binary into `src-tauri/binaries/<subfolder>/` before building Xirea. See [`src-tauri/binaries/README.md`](src-tauri/binaries/README.md) for the exact subfolder per platform.
- **CI auto-downloads** the official llama.cpp release for Linux, macOS Intel, and macOS Apple Silicon on every build — you don't need to commit those binaries to the repo. Windows binaries are committed for local dev convenience.
- If no bundled binary exists (or the user is on an architecture you didn't ship a binary for), Xirea falls back to looking up `llama-server` on the user's `PATH`.
- All inference stays local. Xirea talks to `llama-server` over `http://127.0.0.1:<port>/v1` — same protocol as OpenAI.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       Xirea Desktop (Tauri)                      │
│  ┌─────────────────┐   ┌─────────────────┐   ┌────────────────┐  │
│  │   React UI      │──▶│  Rust backend   │──▶│  HTTP client   │  │
│  │  (chat, models) │   │  (Tauri commands)│   │  (reqwest)     │  │
│  └─────────────────┘   └────────┬────────┘   └────────┬───────┘  │
│                                  │ spawn                │ HTTP    │
│                                  │ child                │ /v1/... │
│                                  ▼                      ▼        │
│                          ┌──────────────────┐   ┌──────────────┐  │
│                          │  bundled binary  │   │ llama-server │  │
│                          │  (binaries/      │   │ (HTTP API)   │  │
│                          │   <subfolder>/   │   │              │  │
│                          │   llama-server)  │   │              │  │
│                          └────────┬─────────┘   └──────┬───────┘  │
│                                   │ stdout / stderr    │          │
│                                   │ forwarded as       │          │
│                                   │ llama-server-log   │          │
└───────────────────────────────────┼────────────────────┼──────────┘
                                    │                    │
                                    ▼                    ▼
                              GGUF model loaded into RAM / VRAM
```

Xirea talks to llama.cpp through its **OpenAI-compatible HTTP API**. This means:

- Xirea doesn't need to link against llama.cpp at build time — it just makes HTTP requests to a running `llama-server` process.
- You can use any llama.cpp version (CPU-only, CUDA, Metal, Vulkan) — Xirea doesn't care as long as the HTTP API responds.
- You can run llama.cpp on a **different machine** (a beefy GPU box on your LAN, for example) and point Xirea at it over the network.

---

## Bundled vs PATH fallback — which binary does Xirea use? 

When the user clicks **Run** on a local GGUF model in Xirea, the Rust backend tries three sources in order, picking the first that works:

| # | Source | When it's used | How to set it up |
|---|---|---|---|
| 1 | **Bundled resource** | Default. The `llama-server` binary shipped inside the Xirea installer at `binaries/<subfolder>/llama-server[.exe]`. | Developer drops the binary in `src-tauri/binaries/<subfolder>/` before building. See [For developers](#for-developers--drop-the-binary-into-src-tauribinariessubfolder-before-building) below. |
| 2 | **`PATH` lookup** | The bundled binary is missing (e.g. you forgot to drop the binary in, or the user is on an architecture you didn't ship for). | End user installs llama.cpp themselves. See [Installing llama.cpp yourself](#installing-llamacpp-yourself-path-fallback) below. |
| 3 | **Hard error** | Neither is available. | The UI shows a friendly error pointing the user to this document. |

Either way, the user experience is identical: click Run → Xirea spawns the binary → waits for the HTTP endpoint to come up → switches the chat provider to `http://127.0.0.1:<port>/v1`.

---

## For developers — drop the binary into `src-tauri/binaries/<subfolder>/` before building

Xirea's CI pipeline **auto-downloads** the official `llama-server` release for Linux, macOS Intel, and macOS Apple Silicon on every build — you don't need to commit those binaries to the repo. For **local development**, you need to drop the binary into the right subfolder yourself before running `npm run tauri dev`.

### Subfolder layout

```
src-tauri/binaries/
├── windows/           # Windows x64 — llama-server.exe + .dll files
├── linux/             # Linux x86_64 — llama-server + .so files (if any)
├── macos-x64/         # macOS Intel — llama-server + .dylib files (if any)
└── macos-arm64/       # macOS Apple Silicon — llama-server + .dylib files (if any)
```

Xirea auto-detects the host OS/arch at runtime and picks the matching subfolder — **never hardcode Windows paths**.

### Step 1 — Get the binary

#### Option A — Pre-built release (fastest)

1. Open <https://github.com/ggml-org/llama.cpp/releases>
2. Find the latest release (e.g. `b4400`).
3. Download the asset matching your target platform:
   - **macOS Apple Silicon** → `llama-bXXXX-bin-macos-arm64.zip`
   - **macOS Intel** → `llama-bXXXX-bin-macos-x64.zip`
   - **Windows x64 (CPU)** → `llama-bXXXX-bin-win-avx2-x64.zip`
   - **Windows x64 (CUDA)** → `llama-bXXXX-bin-win-cuda-cu12.2-x64.zip`
   - **Linux x64 (CPU)** → `llama-bXXXX-bin-ubuntu-x64.zip`
   - **Linux x64 (CUDA)** → `llama-bXXXX-bin-ubuntu-cuda-cu12.2-x64.zip`
4. Unzip and copy the `llama-server` (or `llama-server.exe`) binary **plus any DLL / .so / .dylib files** in the archive into the correct subfolder.

#### Option B — Build from source (best performance, supports any GPU)

```bash
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp

# CPU-only build (works everywhere):
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j

# Or — with NVIDIA CUDA support (much faster if you have an NVIDIA GPU):
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j

# Or — with Apple Metal support (M1/M2/M3 Macs — uses the GPU):
cmake -B build -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j
```

The binary you want is at `build/bin/llama-server`. Copy it into the correct subfolder.

### Step 2 — Drop it in the right subfolder

```
src-tauri/binaries/
├── windows/
│   ├── llama-server.exe         # Windows x64
│   ├── llama.dll                # Required Windows DLLs
│   ├── ggml.dll
│   └── ...
├── linux/
│   └── llama-server             # Linux x86_64 (usually statically linked)
├── macos-x64/
│   └── llama-server             # macOS Intel (usually statically linked)
└── macos-arm64/
    └── llama-server             # macOS Apple Silicon (usually statically linked)
```

### Step 3 — Mark it executable and clear quarantine (macOS / Linux only)

```bash
# macOS Apple Silicon
chmod +x src-tauri/binaries/macos-arm64/llama-server
xattr -dr com.apple.quarantine src-tauri/binaries/macos-arm64/llama-server

# macOS Intel
chmod +x src-tauri/binaries/macos-x64/llama-server
xattr -dr com.apple.quarantine src-tauri/binaries/macos-x64/llama-server

# Linux
chmod +x src-tauri/binaries/linux/llama-server
```

On Windows, no extra step is needed — `.exe` files are executable by default.

### Step 4 — Verify before building

```bash
# macOS / Linux
./src-tauri/binaries/<subfolder>/llama-server --version

# Windows
.\src-tauri\binaries\windows\llama-server.exe --version
```

You should see a version string like `llama-server b4400 (…)`.

Xirea also performs this check at startup — see the `verify_llama_runtime` Tauri command in `src-tauri/src/llama_runtime.rs`.

### Step 5 — Build Xirea normally

```bash
npm run tauri build
```

Tauri will pick up the binary from `src-tauri/binaries/`, copy it into the installer bundle, and register it as a sidecar. End users get a one-click "Run" experience for any local GGUF model.

> **Tip:** If you don't have a binary for a given platform, just skip it. Xirea will fall back to `PATH` lookup on that platform and show a friendly error if the user doesn't have `llama-server` installed.

---

## For end users — clicking Run on a local GGUF model

If you installed Xirea from an installer that includes a bundled `llama-server` binary, you don't need to do anything else:

1. Import a GGUF model into Xirea (**Models → Import → pick a `.gguf` file**).
2. Click **Run** on the model card.
3. Watch the loading overlay — it shows live stdout / stderr from `llama-server` as it loads the model into RAM / VRAM.
4. When the HTTP endpoint is ready, Xirea automatically switches your chat provider to `llama.cpp · <model-name>` and you can start chatting.

If your installer didn't include a `llama-server` binary (e.g. you're on an architecture the developer didn't ship for), Xirea will fall back to looking up `llama-server` on your `PATH`. Install llama.cpp yourself (see [Installing llama.cpp yourself](#installing-llamacpp-yourself-path-fallback) below) and try again.

---

## Installing llama.cpp yourself (PATH fallback)

If you'd rather use your own llama.cpp build (e.g. a custom CUDA build with proprietary kernels), install it on your system `PATH` and Xirea will pick it up automatically when the bundled sidecar isn't available.

### Option A — Pre-built binaries

1. Go to <https://github.com/ggml-org/llama.cpp/releases>
2. Find the latest release
3. Download the asset matching your platform:
   - **macOS Apple Silicon**: `llama-bXXXX-bin-macos-arm64.zip`
   - **macOS Intel**: `llama-bXXXX-bin-macos-x64.zip`
   - **Windows CUDA**: `llama-bXXXX-bin-win-cuda-cu12.2-x64.zip`
   - **Windows CPU**: `llama-bXXXX-bin-win-avx2-x64.zip`
   - **Linux CUDA**: `llama-bXXXX-bin-ubuntu-cuda-cu12.2-x64.zip`
   - **Linux CPU**: `llama-bXXXX-bin-ubuntu-x64.zip`
4. Unzip and add the folder to your `PATH`.

### Option B — Build from source

```bash
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp

# CPU-only build (works everywhere):
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j

# Or — with NVIDIA CUDA support:
cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j

# Or — with Apple Metal support (M1/M2/M3 Macs):
cmake -B build -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j
```

The binary you want is at `build/bin/llama-server`. Copy it to `/usr/local/bin/llama-server` (or anywhere else on your `PATH`).

### Option C — Package managers

| Platform | Command |
|---|---|
| macOS (Homebrew) | `brew install llama.cpp` |
| Arch Linux (AUR) | `yay -S llama.cpp` |
| NixOS | `nix-env -iA nixpkgs.llama-cpp` |
| Windows (Scoop) | `scoop install llama-cpp` |
| Docker | `docker run -p 8080:8080 -v ~/models:/models ghcr.io/ggerganov/llama.cpp:server-light --model /models/your-model.gguf` |

After install, verify it works:
```bash
llama-server --version
```

---

## Starting the llama.cpp server manually

You normally don't need to do this — Xirea starts the server for you when you click Run. But if you'd rather run it manually (e.g. to use a custom config, or to run it on a different machine), here's the recommended invocation:

```bash
llama-server \
  --model ~/models/your-model.gguf \
  --port 8080 \
  --host 127.0.0.1 \
  --ctx-size 8192 \
  --threads 4 \
  --temp 0.7 \
  --top-p 0.9 \
  --cont-batching \
  --metrics \
  --flash-attn
```

### What each flag does

| Flag | Purpose | Recommended value |
|---|---|---|
| `--model` | Path to the GGUF file you want to run. | Your downloaded model. |
| `--port` | HTTP port to listen on. | `8080` (Xirea default). |
| `--host` | Bind address. Use `127.0.0.1` to only allow local connections; use `0.0.0.0` to allow other machines on your LAN. | `127.0.0.1` |
| `--ctx-size` | Context window size in tokens. Larger = more conversation history but more RAM. | `8192` for chat; `32768` for long documents. |
| `--threads` | CPU threads to use. Set to your physical core count (not logical). | `4`–`8` typically. |
| `--temp` | Sampling temperature. 0 = deterministic, 1 = creative. | `0.7` for chat. |
| `--top-p` | Nucleus sampling. Lower = more focused. | `0.9` for chat. |
| `--cont-batching` | Enable continuous batching — multiple requests share the context efficiently. | Always on. |
| `--metrics` | Expose a `/metrics` endpoint for Prometheus-style monitoring. | Optional. |
| `--flash-attn` | Use FlashAttention — significantly faster on supported architectures (Llama, Mistral, Qwen, Gemma). | On if your model supports it. |
| `--n-gpu-layers` | How many transformer layers to offload to the GPU. `-1` = all. Only works with CUDA/Metal/Vulkan builds. | `-1` if you have a GPU; `0` if CPU-only. |
| `--split-mode` | How to split model across multiple GPUs. `row` is usually fastest. | `row` for multi-GPU. |

### Verifying the server is running

Open another terminal:
```bash
curl http://127.0.0.1:8080/v1/models
```

You should get JSON like:
```json
{
  "object": "list",
  "data": [
    { "id": "your-model.gguf", "object": "model", ... }
  ]
}
```

If you see that, you're ready to connect Xirea.

---

## Connecting Xirea to a manually-started server

Xirea ships with two providers that can talk to llama.cpp:

### Option 1 — Use the built-in "LM Studio" provider

LM Studio and llama.cpp both speak the OpenAI Chat Completions protocol on `/v1/chat/completions`. The built-in **LM Studio** provider works without any configuration changes:

1. Go to **Settings → Providers** (or click the Providers icon in the sidebar).
2. Find **LM Studio** in the list.
3. Set **Base URL** to `http://127.0.0.1:8080/v1`.
4. Leave **API key** empty.
5. Toggle **Enabled**.
6. Click **Refresh models** — your GGUF model appears.
7. Click **Use** on the model you want.

### Option 2 — Add a custom OpenAI-compatible provider

If you'd rather keep LM Studio separate, add a new **OpenAI-compatible** provider:

1. **Providers → Add provider → OpenAI-compatible**
2. Name: `llama.cpp (local)`
3. Base URL: `http://127.0.0.1:8080/v1`
4. API key: anything (llama.cpp ignores it — but Xirea needs the field non-empty if your build requires auth; usually leave it blank).
5. Toggle **Enabled**.
6. **Refresh models** → pick the model.

### Running llama.cpp on a different machine

If you have a beefy GPU box on your LAN:

1. Start `llama-server --host 0.0.0.0 --port 8080 ...` on the GPU box.
2. Note its IP (e.g. `192.168.1.50`).
3. On Xirea (running on your laptop), set the provider's base URL to `http://192.168.1.50:8080/v1`.

⚠️ **Security note**: only do this on a trusted LAN — llama.cpp's HTTP server has no authentication. For internet-exposed setups, put it behind a reverse proxy with auth (nginx + Basic Auth, Caddy, etc.).

---

## Performance tuning

### CPU-only laptops

- Pick a **Q4_K_M** quant — best balance of speed/quality. Q5_K_M is sharper but ~30% slower.
- Set `--threads` to your **physical** core count (not logical/hyperthreaded). On a 6P/4E Intel CPU, use 6.
- Always enable `--flash-attn` if your model supports it — usually 1.5×–2× faster.
- Use `--mlock` to pin the model in RAM (prevents swapping).
- Smaller context = faster. Use `--ctx-size 4096` for casual chat, `8192` for code, `32768` for long documents.

### NVIDIA GPU (CUDA build)

- Set `--n-gpu-layers -1` to offload everything to the GPU.
- Use `--split-mode row` for multi-GPU setups.
- For very large models (70B+) that don't fit on one GPU, llama.cpp's `--tensor-split` lets you control the split ratio per GPU.
- Use `--flash-attn` — mandatory for GPU performance.
- VRAM rule of thumb: model size on disk ≈ VRAM needed at Q4_K_M. A 40GB model needs ~40GB VRAM.

### Apple Silicon (Metal)

- Set `--n-gpu-layers -1` — Metal will use unified memory.
- Use `--flash-attn` (Metal supports it).
- For M1/M2/M3 with 16GB+ unified memory, you can run up to ~13B Q4_K_M models comfortably.
- `--threads` doesn't matter much on Metal (the GPU does the heavy lifting) — set to `4` anyway for the CPU side.

### RAM/VRAM rules of thumb

| Model size (Q4_K_M) | Minimum RAM | Recommended RAM | Notes |
|---|---|---|---|
| 1.5B | 4 GB | 8 GB | Tiny but useful for autocomplete. |
| 7B | 8 GB | 16 GB | Best for everyday chat on laptops. |
| 13B | 16 GB | 32 GB | Noticeably smarter; needs a desktop. |
| 34B | 32 GB | 64 GB | workstation-class. |
| 70B | 64 GB | 96 GB+ | Multi-GPU or big Mac Studio. |

---

## Troubleshooting

### `llama-server not found` error when clicking Run

Neither the bundled sidecar nor `PATH` lookup found a `llama-server` binary. Either:

- **You're the developer** — drop the binary in `src-tauri/binaries/` before building (see [For developers](#for-developers--drop-the-binary-into-src-tauribinaries-before-building) above), **or**
- **You're an end user** — install llama.cpp yourself (see [Installing llama.cpp yourself](#installing-llamacpp-yourself-path-fallback) above).

### The loading overlay says "llama-server exited without printing anything"

The binary spawned but crashed immediately. Common causes:

- The binary doesn't match your CPU architecture (e.g. AVX2 binary on an AVX-only CPU). Re-download the right variant — see [src-tauri/binaries/README.md](src-tauri/binaries/README.md).
- The GGUF file is corrupted. Re-download and `md5sum` it against the Hugging Face page.
- The CUDA build can't find the CUDA runtime. Install the matching CUDA toolkit or use the CPU-only build instead.

The Xirea Developer Console (View → Show Developer Tools) shows the full `llama-server-log` event stream — every line of the binary's stdout / stderr is forwarded there. The `llama-server-exited` event carries the **real** exit code and a path to a per-session log file at `~/.xirea/logs/llama-<session>-<timestamp>.log` (which includes the launch command, system info, GGUF metadata, and full stdout + stderr).

### `curl http://127.0.0.1:8080/v1/models` returns `connection refused`

The server isn't running. Start it with `llama-server --model ... --port 8080`. Check the server's console output for errors.

### Xirea shows "Cloud providers require the desktop app"

You're running Xirea in a browser tab (`vite dev`) instead of as a Tauri app. Run `npm run tauri dev` to launch the desktop build.

### Xirea shows "Model not found" when chatting

The model ID you selected in Xirea doesn't match the file name llama.cpp loaded. Run `curl http://127.0.0.1:8080/v1/models` and use the EXACT `id` value returned.

### Generation is super slow

- Check `--threads` — too many threads is worse than too few.
- Use a smaller quant (Q4_K_S, Q4_0).
- Reduce `--ctx-size` to `4096` or less.
- If you have a GPU, make sure `--n-gpu-layers -1` is set.
- Enable `--flash-attn`.

### Out of memory (OOM) errors

- Use a smaller quant (Q3_K_M or Q4_0).
- Reduce `--ctx-size`.
- Close other memory-hungry apps.
- On Linux, check `dmesg` for OOM-killer activity.

### Server crashes on startup

- Make sure the model file isn't corrupted — re-download if in doubt. `md5sum` it against the HF page.
- Try a different quant — some quants aren't supported on all CPUs (e.g. `IQ2_XXS` requires AVX2).
- For CUDA builds, check that `nvidia-smi` works and your driver is up to date.

### `--flash-attn` rejected

Your model architecture doesn't support FlashAttention yet (rare). Drop the flag.

### macOS says the binary "can't be opened because Apple cannot check it for malicious software"

This is the quarantine attribute. Run:
```bash
xattr -dr com.apple.quarantine src-tauri/binaries/llama-server-<target-triple>
```

For an unsigned release build of Xirea, the same dialog will appear when the user first runs Xirea itself — that's normal for non-App-Store macOS apps and is resolved by the user right-clicking → **Open** → **Open anyway** in **System Settings → Privacy & Security**.

---

## Advanced — multiple GPU variants, custom builds, LAN serving

### Shipping both a CPU-only and a CUDA build for Windows

Tauri's sidecar mechanism only lets you ship **one** binary per target triple. If you want to ship both a CPU-only build and a CUDA build for Windows, the cleanest approach is:

1. Ship the **CPU-only** build as `llama-server-x86_64-pc-windows-msvc.exe` so it works out of the box on every Windows machine.
2. Add a **Settings → Local runtime** panel in Xirea that lets the user override the binary path with a custom one (e.g. their CUDA build).
3. In `commands.rs`, check the override path first, then the sidecar, then `PATH` — in that order.

This is on the roadmap; for now, the sidecar path is the only one wired up.

### Running llama.cpp on a different machine

See [Running llama.cpp on a different machine](#running-llamacpp-on-a-different-machine) above. The bundled-sidecar flow only works for the local case — for remote setups you must start `llama-server` yourself and point Xirea at it via a custom OpenAI-compatible provider.

### Custom llama.cpp builds

Because Xirea only talks to llama.cpp over HTTP, you can use any fork, any build flags, any custom kernels — as long as the HTTP API still responds on `/v1/chat/completions`. Just install your custom build on your `PATH` (or replace the bundled binary in `src-tauri/binaries/` before building Xirea).

---

## Event reference — what Xirea emits while spawning the runtime

When `start_llama_server` is called, Xirea emits FOUR event streams. All event names are **fixed** — the session ID travels inside the JSON payload, NOT in the event name. (Tauri 2's `listen()` rejects event names containing anything other than `A-Z a-z 0-9 - _ / :`, so we never put the model path in the event name.)

| Event name | Payload | When it fires |
|---|---|---|
| `llama-server-log` | `{ session, modelPath, stream, line, phase }` where `stream` is `"stdout"`, `"stderr"`, `"terminated"`, or `"error"`, and `phase` is `"starting"`, `"loading-tensors"`, `"cuda-init"`, `"kv-cache"`, `"ready"`, `"error"`, or `"info"`. | Every line of stdout / stderr from the binary. Use `phase` to render a phase-aware progress UI. |
| `llama-server-ready` | `{ session, modelPath, port, url }` | Once, when the HTTP endpoint at `http://127.0.0.1:<port>/v1/models` responds successfully. |
| `llama-server-error` | `{ session, modelPath, error, diagnostic }` | Spawn-level errors (e.g. binary not found) or ready-poll timeout. `diagnostic` is an actionable hint. |
| `llama-server-exited` | `{ session, modelPath, exitCode, logFile, reason, error, diagnostic }` | When the child process terminates — carries the **real** exit code, log file path, and a human-readable summary. **Replaces** the old generic "exited without printing anything" message. |

The `session` field is a short alphanumeric token (`s1`, `s2`, …) returned from `startLlamaServer`. The frontend filters events by it.

On the frontend, use the helpers in `src/lib/tauri.ts`:

```ts
import {
  startLlamaServer,
  verifyLlamaRuntime,
  onLlamaServerLog,
  onLlamaServerReady,
  onLlamaServerError,
  onLlamaServerExited,
} from "@/lib/tauri";

// Step 1: Verify the runtime BEFORE clicking Run.
const verification = await verifyLlamaRuntime();
if (!verification.ok) {
  // Show the real reason — binary missing, --version failed, DLLs missing.
  console.error(verification.error, verification.diagnostic);
  return;
}

// Step 2: Spawn the server.
const handle = await startLlamaServer({
  modelPath: model.path,
  port: 8080,
  ctxSize: 8192,
  threads: undefined, // let llama.cpp auto-detect
  nGpuLayers: undefined, // CPU by default
});

// Step 3: Subscribe to events filtered by `handle.session`.
const unlistenLog = await onLlamaServerLog(handle.session, (log) => {
  console.log(`[llama-server:${log.stream}] (${log.phase})`, log.line);
});
const unlistenReady = await onLlamaServerReady(handle.session, (info) => {
  console.log(`llama-server ready at ${info.url}`);
});
const unlistenError = await onLlamaServerError(handle.session, (err, diag) => {
  console.error("llama-server error:", err, diag);
});
const unlistenExited = await onLlamaServerExited(handle.session, (p) => {
  // Real exit code + log file path — never "exited without printing anything".
  console.log(`llama-server exited (code=${p.exitCode}): ${p.error}`);
  console.log(`Full session log: ${p.logFile}`);
});

// ...later, to stop:
await stopLlamaServer(model.path);
unlistenLog();
unlistenReady();
unlistenError();
```

---

## Reference links

- **llama.cpp repo**: <https://github.com/ggml-org/llama.cpp>
- **llama.cpp releases**: <https://github.com/ggml-org/llama.cpp/releases>
- **Server docs**: <https://github.com/ggml-org/llama.cpp/tree/master/tools/server>
- **GGUF model finder**: <https://huggingface.co/models?library=gguf>
- **Quantisation guide**: <https://github.com/ggerganov/llama.cpp/wiki/Quantization>
- **Tauri sidecar docs**: <https://v2.tauri.app/develop/sidecar/>
- **Drop-the-binary guide**: [`src-tauri/binaries/README.md`](src-tauri/binaries/README.md)
- **Xirea GitHub**: <https://github.com/Danyalkhattak/Xirea-Desktop>
- **Author**: Danyal Khattak — <https://github.com/Danyalkhattak> · <https://www.instagram.com/dannyk_739>

---

If you spot an error in this document or want to add a section (e.g. ROCm/AMD instructions, Kubernetes deployment, etc.), please open a PR at <https://github.com/Danyalkhattak/Xirea-Desktop>.
