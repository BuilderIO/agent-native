---
name: ship-desktop
description: Build the Agent Native desktop app locally, kill the running copy, install the fresh DMG to /Applications, and launch it. Use when the user says "rebuild/reinstall the desktop app", "ship desktop", "install the desktop app", or similar.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Ship Desktop

End-to-end local install of the Agent Native Electron app. Produces a **signed, un-notarized arm64 DMG** on Steve's Mac when the Builder Developer ID certificate is available. Stable local signing is required so Electron Safe Storage does not ask for Keychain access again after every rebuild. If no signing identity is installed, fall back to an ad-hoc build and warn that saved-provider access may prompt again.

## When to use

- "Rebuild and install the desktop app"
- "Ship the desktop app locally"
- After touching anything under `packages/desktop-app/`
- After bumping a dependency that affects the shell (main/preload/renderer)

## Pre-flight

```bash
ls packages/desktop-app/package.json      # sanity: we're at framework root
pgrep -f "/Applications/Agent Native.app" # note if it's currently running
```

## Steps

### 1. Build arm64 DMG

Universal builds silently stall during the merge step locally (npm dep collector noise). Build arm64-only — it's what Steve's machine runs anyway.

```bash
cd packages/desktop-app
pnpm exec electron-vite build
if security find-identity -v -p codesigning | grep -q 'Developer ID Application: Builder.io, Inc (W3PMF2T3MW)'; then
  pnpm exec electron-builder --mac dmg --arm64 \
    -c.mac.notarize=false \
    -c.mac.target.target=dmg \
    -c.mac.target.arch=arm64 \
    > /tmp/desktop-build.log 2>&1
else
  echo "Warning: Builder Developer ID is unavailable; building ad-hoc." >&2
  CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg --arm64 \
    -c.mac.notarize=false \
    -c.mac.identity=null \
    -c.mac.target.target=dmg \
    -c.mac.target.arch=arm64 \
    > /tmp/desktop-build.log 2>&1
fi
```

The build runs for ~1–2 minutes. Watch for `building target=DMG arch=arm64 file=dist/Agent Native.dmg` near the end. Skip the `npm error missing/invalid` noise — it's from the `npm ls` dep collector inside a pnpm workspace and is harmless.

If it finishes without writing `dist/Agent Native.dmg`, grep the log for `Error|Failed|exited.*code=[^0]` — a real failure will show up there.

### 2. Quit the running copy

```bash
osascript -e 'tell application "Agent Native" to quit' || true
sleep 2
pgrep -f "/Applications/Agent Native.app/Contents/MacOS/Agent Native" | xargs -r kill
```

### 3. Verify macOS Tahoe Liquid Glass assets

macOS 26 (Tahoe) draws the dynamic Liquid Glass bezel/specular only when an app has both `Assets.car` (compiled from our `.icon` bundle) and `CFBundleIconName` set in `Info.plist`. Both are included by `electron-builder.yml` before signing. Verify them without changing the signed bundle.

```bash
APP="packages/desktop-app/dist/mac-arm64/Agent Native.app"
test -f "$APP/Contents/Resources/Assets.car"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconName' "$APP/Contents/Info.plist")" = "agent-native"
codesign --verify --deep --strict "$APP"
```

### 4. Install to /Applications

```bash
rm -rf "/Applications/Agent Native.app"
cp -R "packages/desktop-app/dist/mac-arm64/Agent Native.app" /Applications/
```

### 5. Refresh icon caches + launch

macOS aggressively caches Dock/Finder icons. Without flushing, a fresh `.icns` won't show until logout. The `mv … .tmp && mv … back` is the no-`killall Dock` cache buster (the agent sandbox usually denies `killall Dock`).

```bash
xattr -dr com.apple.quarantine "/Applications/Agent Native.app" 2>/dev/null
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "/Applications/Agent Native.app"
find ~/Library/Caches/com.apple.iconservices.store -type f -delete 2>/dev/null
rm -f /private/var/folders/*/C/com.apple.dock.iconcache 2>/dev/null
mv "/Applications/Agent Native.app" "/Applications/Agent Native.app.tmp" && mv "/Applications/Agent Native.app.tmp" "/Applications/Agent Native.app"
open "/Applications/Agent Native.app"
```

## Notes

- **Why not `pnpm run build:mac`?** That script runs universal + notarize, which hangs on missing notarization credentials (only set in GitHub Actions). The universal merge step also silently aborts locally.
- **Shipping for real** — use the `Desktop App Release` GitHub Actions workflow (`.github/workflows/desktop-release.yml`). Never publish a locally-built artifact.
- **Data preserved** — user settings live in `~/Library/Application Support/Agent Native/`. Reinstalling does not touch them.
- **If the app won't open** after install, check Console.app for `Agent Native` entries — common cause is a stale Electron helper still running from the old version.
