#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: build-llama-cpp.sh SOURCE_DIR OUTPUT_DIR <linux-vulkan|macos-metal>" >&2
  exit 2
fi

source_dir=$1
output_dir=$2
target=$3
expected_commit=22b208b1cacb67bae191b00d795dae7cc819edb8
actual_commit=$(git -C "$source_dir" rev-parse HEAD)
test "$actual_commit" = "$expected_commit"
test -z "$(git -C "$source_dir" status --porcelain)"

case "$target" in
  linux-vulkan)
    cmake -S "$source_dir" -B "$output_dir/build" -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DGGML_METAL=OFF
    ;;
  macos-metal)
    cmake -S "$source_dir" -B "$output_dir/build" -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DGGML_VULKAN=OFF
    ;;
  *)
    echo "unsupported target: $target" >&2
    exit 2
    ;;
esac

cmake --build "$output_dir/build" --config Release --target llama-server --parallel
binary="$output_dir/build/bin/llama-server"
test -f "$binary"
cmake -E copy "$binary" "$output_dir/llama-server"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$script_dir/write-llama-build-manifest.mjs" \
  --source "$source_dir" --build "$output_dir/build" --binary "$output_dir/llama-server" \
  --target "$(test "$target" = linux-vulkan && echo linux-vulkan || echo macos-metal)" \
  --output "$output_dir/build-manifest.json"
