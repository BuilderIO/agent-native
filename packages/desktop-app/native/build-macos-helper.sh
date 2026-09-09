#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/native/macos/AgentNativeComputerHelper.swift"
OUTPUT_DIR="$ROOT/native/bin"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p "$OUTPUT_DIR"

swiftc -O -sdk "$SDK" -target arm64-apple-macosx13.0 \
  -framework AppKit -framework ApplicationServices \
  "$SOURCE" -o "$OUTPUT_DIR/agent-native-computer-helper-arm64"
swiftc -O -sdk "$SDK" -target x86_64-apple-macosx13.0 \
  -framework AppKit -framework ApplicationServices \
  "$SOURCE" -o "$OUTPUT_DIR/agent-native-computer-helper-x64"
lipo -create \
  "$OUTPUT_DIR/agent-native-computer-helper-arm64" \
  "$OUTPUT_DIR/agent-native-computer-helper-x64" \
  -output "$OUTPUT_DIR/agent-native-computer-helper"
rm "$OUTPUT_DIR/agent-native-computer-helper-arm64" "$OUTPUT_DIR/agent-native-computer-helper-x64"
chmod 0755 "$OUTPUT_DIR/agent-native-computer-helper"
