# Clips Tray — Desktop menu-bar app

A small Tauri 2.x tray app for macOS, Windows, and Linux. Click the icon — or press the global shortcut `Cmd/Ctrl+Shift+L` — to open a popover with:

- **New recording** button (opens `/record` on your configured Clips server)
- **Recent** — your three most recent recordings
- Quick links to **Open library** and **Settings**

## Develop

First install the desktop workspace's own deps (this folder is outside the monorepo's `templates/*` glob because it ships its own Tauri/Vite toolchain):

```bash
cd templates/clips/desktop
pnpm install
pnpm tauri dev
```

You'll also need the Rust toolchain — see [Tauri prerequisites](https://tauri.app/start/prerequisites/).

From the template root you can also run:

```bash
pnpm tauri:dev    # start the tray app against the local dev server
pnpm tauri:build  # produce platform installers (.dmg / .msi / AppImage + .deb + .rpm)
```

On Linux, install Tauri's WebKitGTK/AppIndicator prerequisites before running
the app. Screen and window capture use the desktop portal and PipeWire, so a
modern XDG desktop session with `xdg-desktop-portal` and PipeWire must be
running. The AppImage bundles the GStreamer media framework; `.deb` and `.rpm`
installs use the distribution's WebKitGTK/GStreamer packages. Use the AppImage
for in-app auto-updates; package-manager installs are updated by installing the
new `.deb` or `.rpm`.

Dev builds use the real platform screen/camera/microphone permission flow by
default so failures show up in the popover instead of saving a fake recording.
For automation-only sessions that need a generated screen stream, run this in
the tray devtools console:

```js
localStorage.setItem("clips:dev-synthetic-capture", "1");
```

Remove that key to return to real capture.

### Linux capabilities

Linux uses the WebKitGTK recorder for screen, window, camera, and microphone
capture. Transcripts use Web Speech when available and the normal hosted
fallback after upload. macOS-native features — ScreenCaptureKit system audio,
local SFSpeech/Whisper capture, the Fn dictation shortcut, automatic text paste,
and Screen Memory — are not available on Linux yet.

Full-screen recording uses the native macOS recorder by default so it can start
without WebKit's screen/window picker. To debug the old `getDisplayMedia` path,
run this in the tray devtools console:

```js
localStorage.setItem("clips:native-fullscreen-recording", "0");
```

Remove that key to return full-screen mode to one-click native recording.

## First-run configuration

On first launch the popover asks for the URL of your Clips server. This is stored in `localStorage` (default: `http://localhost:8080`). You can change it at any time from the popover's "Server" link.

Clips registers itself to open at login by default, then runs quietly in the menu bar / system tray. Users can turn this off from Settings -> Open at login.

## Manual TODOs before shipping

- Replace `src-tauri/icons/tray.png` with a real 16×16 (and 32×32 @2x) monochrome PNG. The default placeholder is a plain purple square so the app still compiles out of the box.
- Add Apple Developer ID + Windows Authenticode signing config to `tauri.conf.json` — currently left blank.
- Run the **Updater signing key** setup below before the first release. Without it, `tauri-action` will refuse to build a signed bundle and the in-app updater will reject whatever the workflow uploads.

## Releases + auto-update

Clips Desktop has separate stable and Nightly lanes. The stable app keeps the
`Clips` name and `com.clips.tray` identifier; its releases use `clips-v*` tags,
the `clips-latest` updater pointer, and `/api/clips-updater.json`. Nightly
builds are named `Clips Nightly`, use `com.clips.tray.nightly`, and use the
`clips-nightly-v*` tags, `clips-nightly-latest` pointer, and
`/api/clips-updater.json?channel=nightly`. The in-app updater only sees the
pointer for the channel that produced the installed app.

### Shipping a release

1. For a stable release, dispatch **Clips Desktop Release** in GitHub Actions
   with `channel: production` and an explicit version. Stable releases are
   deliberate workflow runs; pushes to `main` never replace the stable lane.
2. Pushes to `main` automatically build the Nightly lane. A Nightly run can
   also be dispatched explicitly with `channel: nightly`.
3. The workflow builds macOS (universal), Windows, and Linux x86_64 installers,
   signs updater artifacts, and publishes the versioned release plus that
   channel's pointer manifest. Installed copies auto-download only updates
   from their own lane on the next hourly or app-focus check.

### Auto-update flow (inside the app)

- `src/lib/updater.ts` checks for updates 3s after launch, hourly while Clips stays open, and when the user returns after at least 15 minutes.
- On `available` it auto-downloads; on `downloaded` the popover shows an "Update ready — Restart" banner.
- Clicking Restart calls `@tauri-apps/plugin-process` `relaunch()`, which applies the already-staged bundle.
- No banner is shown in idle / checking / not-available states — the popover stays focused on recording.

### Updater signing key (one-time setup)

Tauri's updater verifies every downloaded bundle against an ed25519 signature baked into `tauri.conf.json` under `plugins.updater.pubkey`. Without a matching private key on the CI side, nothing installs.

```bash
# Generate the keypair — run once, store the output in a password manager.
pnpm tauri signer generate -w ~/.tauri/clips-updater.key

# Print the public key to paste into tauri.conf.json → plugins.updater.pubkey
cat ~/.tauri/clips-updater.key.pub
```

Then set these GitHub secrets on the repository:

| Secret                                     | Source                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| `CLIPS_TAURI_SIGNING_PRIVATE_KEY`          | Contents of `~/.tauri/clips-updater.key` (full file)    |
| `CLIPS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you entered at `tauri signer generate`     |
| `APPLE_CERTIFICATE`                        | Base64-encoded Developer ID .p12 (shared with Electron) |
| `APPLE_CERTIFICATE_PASSWORD`               | .p12 password (shared with Electron)                    |
| `APPLE_SIGNING_IDENTITY`                   | e.g. `Developer ID Application: Builder (W3PMF2T3MW)`   |
| `APPLE_ID`                                 | Apple ID for notarization (shared with Electron)        |
| `APPLE_APP_SPECIFIC_PASSWORD`              | App-specific password for notarization                  |

Once the keys are in place and `tauri.conf.json` has the real `pubkey`, subsequent workflow runs produce bundles the updater will accept.
