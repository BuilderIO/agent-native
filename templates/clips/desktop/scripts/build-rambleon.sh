#!/bin/bash
# RambleOn-branded local build: tauri bundle → stable-identity codesign →
# DMG repack. Signing happens post-build because tauri's child codesign
# cannot access the imported keychain key (errSecInternalComponent), while
# a direct codesign can.
set -euo pipefail
cd "$(dirname "$0")/.."

# whisper.cpp's Metal backend uses @available checks that reference
# __isPlatformVersionAtLeast from clang's compiler runtime. rustc links with
# -nodefaultlibs, so the runtime archive must be added explicitly or the final
# link fails with "Undefined symbols: ___isPlatformVersionAtLeast".
CLANG_RT="$(xcrun clang --print-runtime-dir)/libclang_rt.osx.a"
if [ -f "$CLANG_RT" ]; then
  export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=$CLANG_RT"
fi

pnpm tauri build --config src-tauri/tauri.rambleon.conf.json --bundles app

APP=src-tauri/target/release/bundle/macos/RambleOn.app
# The identity lives in a dedicated keychain with a known password so signing
# works non-interactively (login-keychain keys hit errSecInternalComponent
# when no GUI prompt can appear). Local self-signed key — low-value secret.
security unlock-keychain -p rambleon-local rambleon-signing.keychain-db
codesign --force --deep -s "RambleOn Local Signing" "$APP"
codesign --verify --deep --strict "$APP"

# Tauri packs the DMG before our signing pass — rebuild it from the signed app
# so drag-installs get the same stable code identity.
VERSION=$(node -p "require('./package.json').version")
DMG="src-tauri/target/release/bundle/dmg/RambleOn_${VERSION}_aarch64.dmg"
STAGE=$(mktemp -d)
ditto "$APP" "$STAGE/RambleOn.app"
ln -s /Applications "$STAGE/Applications"
# Detach any mounted copy of a previous DMG — hdiutil refuses to rebuild
# while the volume is open in Finder ("resource busy").
for vol in /Volumes/RambleOn*; do
  [ -d "$vol" ] && hdiutil detach "$vol" -force >/dev/null 2>&1 || true
done
rm -f "$DMG"
hdiutil create -volname "RambleOn" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo "Signed app: $APP"
echo "DMG: $DMG"
