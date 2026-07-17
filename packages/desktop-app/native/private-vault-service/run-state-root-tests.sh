#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
TEST_BINARY="$(mktemp "${TMPDIR:-/tmp}/agent-native-private-vault-state-root.XXXXXX")"

cleanup() {
  rm -f "$TEST_BINARY"
}
trap cleanup EXIT

xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
  -isysroot "$SDK" \
  -mmacosx-version-min=13.0 \
  -framework Foundation \
  "$ROOT/storage/PrivateVaultStateRoot.m" \
  "$ROOT/storage/PrivateVaultStateRootTests.m" \
  -o "$TEST_BINARY"
"$TEST_BINARY"
