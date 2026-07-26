# Native GPU runner

The local-provider gate must run separately on native Windows x64, macOS
arm64, and native Linux x64 glibc. WSL, CPU-only execution, cross-compilation,
and a partially offloaded model cannot pass a platform cell. Supply the pinned
GGUF locally; these commands never download, bundle, or substitute it.

Use a clean checkout of llama.cpp commit
`22b208b1cacb67bae191b00d795dae7cc819edb8`. Build it with the repository
wrapper so the result includes `build-manifest.json`, the compiler/CMake
versions, exact backend flags, binary version/revision, and binary hash:

```bash
scripts/build-llama-cpp.sh <clean-llama-source> <output> linux-vulkan
scripts/build-llama-cpp.sh <clean-llama-source> <output> macos-metal
```

On Windows PowerShell:

```powershell
scripts/build-llama-cpp.ps1 -SourceDir <clean-llama-source> -OutputDir <output>
```

Before running, install the native platform diagnostic tool. Windows and Linux
use `vulkaninfo --summary`; the selected device must report Vulkan 1.2 or
newer. macOS uses native Metal and records the macOS runtime version. Select
the exact device ID printed by `llama-server --list-devices` and its matching
device name:

```bash
pnpm spike:local-gpu \
  --binary <output>/llama-server \
  --build-manifest <output>/build-manifest.json \
  --model <local-pinned.gguf> \
  --platform linux-x64 \
  --device Vulkan0 \
  --device-name "<exact listed device name>" \
  --output <safe-result.json>
```

Use `windows-x64` on Windows and `macos-arm64` on Apple Silicon. The runner
binds only to `127.0.0.1`, uses alias `jina-v5-nano`, explicitly selects the
device, requests `--n-gpu-layers all`, and machine-requires exact full-offload
logs. It checks batch association/order, 768 finite normalized dimensions,
repeat cosine at least `0.99999`, cancellation, timeout, invalid/empty/oversize
input classification, clean SIGTERM shutdown, and GPU/CPU cosine at least
`0.999`. The same server lifecycles also embed the fixed semantic manifest,
four prefix-control workloads, and every matching CPU control vector. CPU is
only the numerical control; it cannot satisfy a GPU platform cell.

The safe result contains hashes and allowlisted build/backend metadata. It
does not contain the model path, binary path, raw device selector, inputs,
vectors, or llama.cpp log. Any failure leaves that platform unpassed; do not
change the model, revision, backend, or threshold to obtain a pass.
Synthetic semantic result sets contain stable query/document IDs and grouped
metrics, but no source text or vectors. Gating metrics are reported separately
for all 12 languages and six cross-language directions; removed/swapped-prefix
controls remain diagnostic and cannot convert a failed gating group to pass.
