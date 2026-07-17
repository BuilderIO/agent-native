#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ROOT="$ROOT/native/private-vault-service"
SOURCES=("$SOURCE_ROOT/main.m" "$SOURCE_ROOT/Protocol.m")
INFO_PLIST="$SOURCE_ROOT/Info.plist"
ENTITLEMENTS="$ROOT/build/entitlements.private-vault-service.plist"
OUTPUT_ROOT="${1:-$SOURCE_ROOT/build}"
BUNDLE="$OUTPUT_ROOT/com.agentnative.desktop.private-vault-service.xpc"
CONTENTS="$BUNDLE/Contents"
MACOS="$CONTENTS/MacOS"
EXECUTABLE="$MACOS/AgentNativePrivateVaultService"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
INTERMEDIATES="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-service.XXXXXX")"

cleanup() {
  rm -rf "$INTERMEDIATES"
}
trap cleanup EXIT

plutil -lint "$INFO_PLIST" >/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null

[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST")" == \
  "com.agentnative.desktop.private-vault-service" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundlePackageType' "$INFO_PLIST")" == "XPC!" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$INFO_PLIST")" == "13.0" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :keychain-access-groups:0' "$ENTITLEMENTS")" == \
  "W3PMF2T3MW.com.agentnative.desktop.private-vault" ]]

compile_slice() {
  local architecture="$1"
  local output="$2"
  xcrun clang -O2 -fobjc-arc -fblocks -Wall -Wextra -Werror \
    -isysroot "$SDK" \
    -mmacosx-version-min=13.0 \
    -arch "$architecture" \
    -framework Foundation \
    -framework Security \
    "${SOURCES[@]}" \
    -o "$output"
}

compile_slice arm64 "$INTERMEDIATES/service-arm64"
compile_slice x86_64 "$INTERMEDIATES/service-x86_64"

rm -rf "$BUNDLE"
mkdir -p "$MACOS"
cp "$INFO_PLIST" "$CONTENTS/Info.plist"
lipo -create \
  "$INTERMEDIATES/service-arm64" \
  "$INTERMEDIATES/service-x86_64" \
  -output "$EXECUTABLE"
chmod 0755 "$EXECUTABLE"

plutil -lint "$CONTENTS/Info.plist" >/dev/null
lipo "$EXECUTABLE" -verify_arch arm64 x86_64
printf '%s\n' "$BUNDLE"
