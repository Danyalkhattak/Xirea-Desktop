# macOS Intel (x86_64) llama-server binary lives here.
#
# Required files (drop in before building):
#   - llama-server  (the server binary, Mach-O x86_64 executable)
#
# macOS llama.cpp builds are typically statically linked, so no .dylib files
# are needed in most cases. If your build is dynamically linked, also drop:
#   - libllama.dylib
#   - libggml.dylib
#   - libggml-base.dylib
#   - libggml-metal.dylib (optional — Metal acceleration)
#   - ggml-metal.metal  (optional — Metal kernel source, if the build expects it)
#
# CI auto-downloads this on build (see .github/workflows/build.yml).
# For local dev on macOS Intel, download from:
#   https://github.com/ggml-org/llama.cpp/releases
# Pick: llama-bXXXX-bin-macos-x64.zip
# Extract llama-server into THIS folder, then:
#   chmod +x src-tauri/binaries/macos-x64/llama-server
#   xattr -dr com.apple.quarantine src-tauri/binaries/macos-x64/llama-server
