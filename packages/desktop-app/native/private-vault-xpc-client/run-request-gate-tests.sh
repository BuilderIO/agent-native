#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$(mktemp "${TMPDIR:-/tmp}/agent-native-private-vault-xpc-client-gate.XXXXXX")"

cleanup() {
  rm -f "$OUTPUT"
}
trap cleanup EXIT

xcrun clang++ -O2 -std=c++20 -Wall -Wextra -Werror \
  "$ROOT/RequestGateTests.cc" \
  -o "$OUTPUT"
"$OUTPUT"
