#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ROOT="$ROOT/native/private-vault-xpc-client"
SOURCE="$SOURCE_ROOT/addon.mm"
OUTPUT_ROOT="${1:-$SOURCE_ROOT/build}"
OUTPUT="$OUTPUT_ROOT/private-vault-xpc-client.node"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
NODE_EXECUTABLE="${NODE_EXECUTABLE:-$(command -v node)}"
NODE_PREFIX="$(cd "$(dirname "$NODE_EXECUTABLE")/.." && pwd)"
NODE_HEADERS="${NODE_HEADERS:-$NODE_PREFIX/include/node}"
INTERMEDIATES="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-xpc-client.XXXXXX")"

cleanup() {
  rm -rf "$INTERMEDIATES"
}
trap cleanup EXIT

[[ -f "$NODE_HEADERS/node_api.h" ]]

compile_slice() {
  local architecture="$1"
  local output="$2"
  xcrun clang++ -O2 -fblocks -std=c++20 -Wall -Wextra -Werror \
    -DNAPI_VERSION=8 \
    -DNODE_GYP_MODULE_NAME=private_vault_xpc_client \
    -I"$NODE_HEADERS" \
    -isysroot "$SDK" \
    -mmacosx-version-min=13.0 \
    -arch "$architecture" \
    -bundle \
    -undefined dynamic_lookup \
    -framework Foundation \
    "$SOURCE" \
    -o "$output"
}

mkdir -p "$OUTPUT_ROOT"
compile_slice arm64 "$INTERMEDIATES/client-arm64.node"
compile_slice x86_64 "$INTERMEDIATES/client-x86_64.node"
lipo -create \
  "$INTERMEDIATES/client-arm64.node" \
  "$INTERMEDIATES/client-x86_64.node" \
  -output "$OUTPUT"
chmod 0755 "$OUTPUT"
lipo "$OUTPUT" -verify_arch arm64 x86_64
printf '%s\n' "$OUTPUT"
