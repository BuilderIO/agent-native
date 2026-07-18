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

# Private Vault ships as one universal XPC service plus a universal N-API
# transport addon. Build both before electron-builder copies and signs them.
bash "$ROOT/native/build-private-vault-service.sh"
bash "$ROOT/native/build-private-vault-xpc-client.sh"

PRIVATE_VAULT_SERVICE="$ROOT/native/private-vault-service/build/com.agentnative.desktop.private-vault-service.xpc"
PRIVATE_VAULT_SERVICE_EXECUTABLE="$PRIVATE_VAULT_SERVICE/Contents/MacOS/AgentNativePrivateVaultService"
PRIVATE_VAULT_ADDON="$ROOT/native/private-vault-xpc-client/build/private-vault-xpc-client.node"

[[ -d "$PRIVATE_VAULT_SERVICE" ]]
[[ -f "$PRIVATE_VAULT_SERVICE_EXECUTABLE" ]]
[[ -f "$PRIVATE_VAULT_ADDON" ]]
lipo "$PRIVATE_VAULT_SERVICE_EXECUTABLE" -verify_arch arm64 x86_64
lipo "$PRIVATE_VAULT_ADDON" -verify_arch arm64 x86_64
