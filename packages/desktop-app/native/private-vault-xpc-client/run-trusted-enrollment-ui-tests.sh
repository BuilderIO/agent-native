#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$(mktemp "${TMPDIR:-/tmp}/agent-native-trusted-enrollment-ui.XXXXXX")"
trap 'rm -f "$OUTPUT"' EXIT
SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun clang++ -O1 -fobjc-arc -std=c++20 -Wall -Wextra -Werror \
  -isysroot "$SDK" -mmacosx-version-min=13.0 -arch arm64 \
  -framework Foundation -framework AppKit \
  "$ROOT/TrustedEnrollmentUI.mm" "$ROOT/TrustedEnrollmentUITests.mm" \
  -o "$OUTPUT"
"$OUTPUT"
