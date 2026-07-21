# Linux llama-server binary lives here.
#
# Required files (drop in before building):
#   - llama-server  (the server binary, ELF executable)
#
# Linux llama.cpp builds are typically statically linked, so no .so files
# are needed in most cases. If your build is dynamically linked, also drop:
#   - libllama.so
#   - libggml.so
#   - libggml-base.so
#   - libggml-cuda.so (optional)
#   - libggml-vulkan.so (optional)
#
# CI auto-downloads this on build (see .github/workflows/build.yml).
# For local dev on Linux, download from:
#   https://github.com/ggml-org/llama.cpp/releases
# Pick: llama-bXXXX-bin-ubuntu-x64.zip
# Extract llama-server into THIS folder, then:
#   chmod +x src-tauri/binaries/linux/llama-server
