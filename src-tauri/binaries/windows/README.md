# Windows llama-server binaries live here.
#
# Required files (drop in before building):
#   - llama-server.exe         (the server binary)
#   - llama.dll                (llama.cpp core)
#   - llama-common.dll         (shared common code)
#   - llama-server-impl.dll    (server implementation)
#   - ggml-base.dll            (GGML base)
#   - ggml.dll                 (GGML core)
#   - ggml-cpu.dll             (CPU backend)
#   - ggml-cuda.dll (optional) (CUDA backend — only if shipping CUDA build)
#   - ggml-vulkan.dll (optional) (Vulkan backend)
#   - ggml-blas.dll (optional) (BLAS backend)
#   - Vulkan-1.dll (optional)  (Vulkan loader, if ggml-vulkan.dll is present)
#   - cudart64_*.dll (optional) (CUDA runtime, if shipping CUDA build)
#   - cublas64_*.dll (optional) (CUDA BLAS, if shipping CUDA build)
#
# CI auto-downloads these on build (see .github/workflows/build.yml).
# For local dev on Windows, download from:
#   https://github.com/ggml-org/llama.cpp/releases
# Pick: llama-bXXXX-bin-win-avx2-x64.zip (CPU) or
#       llama-bXXXX-bin-win-cuda-cu12.x-x64.zip (CUDA)
# Extract ALL files from the zip into THIS folder.
