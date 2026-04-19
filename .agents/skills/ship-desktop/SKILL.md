---
name: ship-desktop
description: Build the Agent Native desktop app locally, kill the running copy, install the fresh DMG to /Applications, and launch it. Use when the user says "rebuild/reinstall the desktop app", "ship desktop", "install the desktop app", or similar.
user_invocable: true
---

# Ship Desktop

End-to-end local install of the Agent Native Electron app. Produces an **unsigned, un-notarized arm64 DMG** — fine for local use on Steve's M-series Mac. This skill intentionally bypasses codesign/notarize because they only work in CI (`.github/workflows/desktop-release.yml`) where the Apple secrets live.

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

### 1. Build arm64 DMG (unsigned)

Universal builds silently stall during the merge step locally (npm dep collector noise). Build arm64-only — it's what Steve's machine runs anyway.

```bash
cd packages/desktop-app
pnpm exec electron-vite build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg --arm64 \
  -c.mac.notarize=false \
  -c.mac.identity=null \
  -c.mac.target.target=dmg \
  -c.mac.target.arch=arm64 \
  > /tmp/desktop-build.log 2>&1
```

The build runs for ~1–2 minutes. Watch for `building target=DMG arch=arm64 file=dist/Agent Native.dmg` near the end. Skip the `npm error missing/invalid` noise — it's from the `npm ls` dep collector inside a pnpm workspace and is harmless.

If it finishes without writing `dist/Agent Native.dmg`, grep the log for `Error|Failed|exited.*code=[^0]` — a real failure will show up there.

### 2. Quit the running copy

```bash
osascript -e 'tell application "Agent Native" to quit' || true
sleep 2
pgrep -f "/Applications/Agent Native.app/Contents/MacOS/Agent Native" | xargs -r kill
```

### 3. Install to /Applications

```bash
DMG="packages/desktop-app/dist/Agent Native.dmg"
MOUNT=$(hdiutil attach -nobrowse -noverify -noautoopen "$DMG" | tail -1 | awk -F'\t' '{print $NF}')
rm -rf "/Applications/Agent Native.app"
cp -R "$MOUNT/Agent Native.app" /Applications/
hdiutil detach "$MOUNT" -quiet
```

### 4. Strip quarantine + launch

Unsigned apps get a Gatekeeper warning on first launch — `xattr -dr` clears it.

```bash
xattr -dr com.apple.quarantine "/Applications/Agent Native.app"
open "/Applications/Agent Native.app"
```

## Notes

- **Why not `pnpm run build:mac`?** That script runs universal + notarize + sign, which hangs on missing `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` env vars (only set in GitHub Actions). The universal merge step also silently aborts locally.
- **Shipping for real** — use the `Desktop App Release` GitHub Actions workflow (`.github/workflows/desktop-release.yml`). Never publish a locally-built artifact.
- **Data preserved** — user settings live in `~/Library/Application Support/Agent Native/`. Reinstalling does not touch them.
- **If the app won't open** after install, check Console.app for `Agent Native` entries — common cause is a stale Electron helper still running from the old version.
