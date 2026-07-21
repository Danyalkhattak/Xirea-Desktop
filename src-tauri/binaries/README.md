# llama.cpp runtime binaries

This folder holds the **`llama-server`** binaries + runtime libraries that
Xirea bundles inside its installer and spawns as a child process whenever you
click **Run** on a local GGUF model.

## Folder structure

```
binaries/
│
├── windows/           # Windows x64 — llama-server.exe + .dll files
│                      # (kept in the repo for local dev on Windows)
│
├── linux/             # Linux x86_64 — llama-server + .so files (if any)
│                      # (downloaded by CI — not committed)
│
├── macos-x64/         # macOS Intel — llama-server + .dylib files (if any)
│                      # (downloaded by CI — not committed)
│
└── macos-arm64/       # macOS Apple Silicon — llama-server + .dylib files
                       # (downloaded by CI — not committed)
```

Xirea auto-detects the host OS/arch at runtime and picks the matching
subfolder. **Never hardcode Windows paths** — the same code path works on
every platform.

## What goes in each subfolder

Each subfolder needs the `llama-server` executable plus any runtime DLLs /
shared libraries the build links against. Most official llama.cpp release
builds are statically linked, so you usually only need the executable itself.
CUDA / Vulkan / Metal builds may need extra shared libraries — see the
README.md inside each subfolder for the exact list.

Only include files actually required to run `llama-server`. Do not include:
- Other llama.cpp tools (`llama-cli`, `llama-quantize`, etc.)
- Example models
- Documentation
- Test files

## Where to get the binaries

### During CI (recommended for releases)

The `.github/workflows/build.yml` workflow **automatically downloads** the
correct official llama.cpp release for each platform during CI builds. You
don't need to commit Linux/macOS binaries — CI handles it.

### Manual download (for local dev)

1. Open <https://github.com/ggml-org/llama.cpp/releases>
2. Find the latest release (e.g. `b4400`).
3. Download the asset matching your target platform:
   - **Windows x64 (CPU)** → `llama-bXXXX-bin-win-avx2-x64.zip`
   - **Windows x64 (CUDA)** → `llama-bXXXX-bin-win-cuda-cu12.x-x64.zip`
   - **Linux x64** → `llama-bXXXX-bin-ubuntu-x64.zip`
   - **macOS Apple Silicon** → `llama-bXXXX-bin-macos-arm64.zip`
   - **macOS Intel** → `llama-bXXXX-bin-macos-x64.zip`
4. Unzip and copy the `llama-server` binary (and any DLLs / .so / .dylib
   files in the archive) into the correct subfolder above.

### Build from source (best performance, supports any GPU)

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

The binary you want is at `build/bin/llama-server`. Copy it into the correct
subfolder for your platform.

## Making the binary executable (macOS / Linux)

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

## How Xirea picks which binary to use

At runtime, Xirea:

1. Detects the host OS and architecture via `cfg!(target_os)` and
   `cfg!(target_arch)`.
2. Resolves the bundled binary path:
   `<resource_dir>/binaries/<subfolder>/llama-server`
3. If the bundled binary doesn't exist (e.g. user is on an architecture you
   didn't ship a binary for), falls back to looking up `llama-server` on the
   user's `PATH`.
4. If neither works, returns a detailed error explaining exactly what was
   checked and what failed.

The user experience: click Run → Xirea spawns the binary → waits for the HTTP
endpoint to come up → switches the chat provider to
`http://127.0.0.1:<port>/v1`.

## Verifying the binary works

Before building Xirea, sanity-check the binary by running it directly:

```bash
# macOS / Linux
./src-tauri/binaries/<subfolder>/llama-server --version

# Windows
.\src-tauri\binaries\windows\llama-server.exe --version
```

You should see a version string like `llama-server b4400 (…)`.

If you see `command not found` or a permission error, re-run the
`chmod +x` step above. If you see a macOS Gatekeeper dialog, run the
`xattr -dr com.apple.quarantine` step on the file.

Xirea also performs this check at startup — see the
`verify_llama_runtime` Tauri command in `src-tauri/src/llama_runtime.rs`.

## Troubleshooting

### `error: spawn: Permission denied` (macOS / Linux)

The binary isn't marked executable. Run:
```bash
chmod +x src-tauri/binaries/<subfolder>/llama-server
```

### macOS says the binary "can't be opened because Apple cannot check it for malicious software"

This is the quarantine attribute. Run:
```bash
xattr -dr com.apple.quarantine src-tauri/binaries/<subfolder>/llama-server
```

For an unsigned release build of Xirea, the same dialog will appear when the
user first runs Xirea itself — that's normal for non-App-Store macOS apps and
is resolved by the user right-clicking → **Open** → **Open anyway** in
**System Settings → Privacy & Security**.

### The binary spawns but immediately exits

Xirea captures the binary's **stdout**, **stderr**, and **exit code** and
surfaces them in the UI. Common causes:

- The GGUF model file is corrupted (re-download and verify the SHA-256).
- The binary was built for a different CPU architecture (e.g. AVX2 binary on
  an AVX-only CPU).
- The CUDA build can't find the CUDA runtime — install the matching CUDA
  toolkit or use the CPU-only build instead.
- Missing DLL on Windows (use a tool like Dependencies.exe to find which).

The error message in the UI will tell you the **actual reason** — never the
generic "exited without printing anything" message.

## Reference

- **llama.cpp repo**: <https://github.com/ggml-org/llama.cpp>
- **llama.cpp releases**: <https://github.com/ggml-org/llama.cpp/releases>
- **Xirea's full llama.cpp integration guide**: see `LlamaDocumentation.md`
  in the project root.
