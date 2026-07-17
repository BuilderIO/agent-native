#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
TEST_BINARY="$(mktemp "${TMPDIR:-/tmp}/agent-native-private-vault-protocol.XXXXXX")"

cleanup() {
  rm -f "$TEST_BINARY"
}
trap cleanup EXIT

xcrun clang -O1 -fblocks -Wall -Wextra -Werror \
  -isysroot "$SDK" \
  -mmacosx-version-min=13.0 \
  -framework Foundation \
  -framework Security \
  "$ROOT/Protocol.m" \
  "$ROOT/ProtocolTests.m" \
  -o "$TEST_BINARY"
"$TEST_BINARY"
