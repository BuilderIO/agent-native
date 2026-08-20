# Clips Tray — Desktop menu-bar app

A small Tauri 2.x tray app for macOS, Windows, and Linux. Click the icon — or press the global shortcut `Cmd/Ctrl+Shift+L` — to open a popover with:

The macOS desktop build requires macOS 13 or newer because its native
ScreenCaptureKit and Metal transcription dependencies target that SDK.

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

### The tray needs a Clips server running

`pnpm tauri dev` starts only the tray and its own Vite server (port 1420). The
tray is a client of the **Clips web app**, which is a separate process. Dev
builds point at `http://localhost:8094` (`devPort` for clips in
`packages/shared-app-config/templates.ts`), but a standalone `pnpm dev` in the
template does **not** read that value — it lands on Vite's default 8080. Pass
the port explicitly so the two agree:

```bash
cd templates/clips
pnpm dev -- --port 8094
```

Without a server every request fails, sign-in included, and the popover shows
"Can't reach localhost:8094" with a link to the setting. To skip running it at
all, point the tray at the hosted instance from **Settings -> Advanced -> Clips
server URL**.

### Signing in during development

**Use "Continue as the dev account".** The framework exposes
`/_agent-native/auth/local-dev`, which creates or reuses an auto-managed dev
account and returns a session token. The tray offers this button only when the
server answers `GET /_agent-native/auth/local-dev` with `available: true` —
which it does only when `NODE_ENV=development` and no other user rows exist. The
server decides, so the button cannot appear against a hosted instance.

Under the hood, dev auth rides the **bearer token**, not cookies. `tauri dev`
serves the webview from `http://localhost:1420`, and the framework deliberately
withholds credentialed CORS from localhost origins — see
`shouldAllowMcpEmbedCredentials`, "only the configured browser allowlist and the
framework's exact native app origins may receive cookies". Since the fetch
interceptor always adds `X-Request-Source`, every request is preflighted, so
asking for cookies there fails the whole request. The interceptor therefore
omits credentials on an http origin and relies on the token the server returns
in the login body (`http://localhost:1420` is on its token allowlist).

**Email + password needs an existing account.** `/_agent-native/auth/login`
calls `signInEmail` only — it never registers — and the tray has no sign-up
form. Create the account once in the web app at http://localhost:8094, then sign
in from the tray. Password signup does work locally: with
`NODE_ENV !== "production"` and no email provider configured,
`resolveEmailPasswordAuthPolicy` leaves both `requireEmailVerification` and
`disableSignUp` off, so there is no email round-trip.

**Google sign-in cannot work locally without credentials.** The provider is
registered only when `GOOGLE_SIGN_IN_CLIENT_ID`/`GOOGLE_SIGN_IN_CLIENT_SECRET`
(or the legacy `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) are set for the Clips
server, and that OAuth client must whitelist the local redirect URI. With no
`.env` the auth-url endpoint returns 422 — by design, not a bug. Magic links are
no help either: dev logs a token *digest*, never a usable URL.

Sessions reset on every server restart unless `BETTER_AUTH_SECRET` is set; the
server warns about this on boot.

### Previewing a surface in a browser tab

Layout and copy can be reviewed without a Rust build. `pnpm vite:dev` serves the
same bundle at http://localhost:1420, where `src/dev/browser-preview.ts` (dev
builds only) stubs just enough of Tauri's IPC to keep React mounted. Add a route
hash to land on a surface directly:

```
http://localhost:1420/#settings
http://localhost:1420/#settings/advanced
```

The route is read once at boot, so changing only the hash does nothing — reload
after editing it. Every Tauri command rejects there, and rows say so rather than
showing invented values — so treat it as a layout preview. Anything depending on real device
state (permission grants, the Whisper catalog, Rewind) has to be checked in the
actual app.

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

The popover talks to a Clips server, whose URL is stored in `localStorage`. Dev
builds default to `http://localhost:8094`; release builds default to
`https://clips.agent-native.com`. Change it any time from **Settings ->
Advanced -> Clips server URL**. When nothing answers at that URL the sign-in
screen says so and links straight to that setting.

Clips registers itself to open at login by default, then runs quietly in the menu bar / system tray. Users can turn this off from Settings -> Open at login.

## Manual TODOs before shipping

- Replace `src-tauri/icons/tray.png` with a real 16×16 (and 32×32 @2x) monochrome PNG. The default placeholder is a plain purple square so the app still compiles out of the box.
- Add Apple Developer ID + Windows Authenticode signing config to `tauri.conf.json` — currently left blank.
- Run the **Updater signing key** setup below before the first release. Without it, `tauri-action` will refuse to build a signed bundle and the in-app updater will reject whatever the workflow uploads.

## Releases + auto-update

Clips Desktop has separate stable and Nightly lanes. The stable app keeps the
`Clips` name, `Clips` binary, `clips://` scheme, and `com.clips.tray` identifier;
its releases use `clips-v*` tags, the `clips-latest` updater pointer, and
`/api/clips-updater.json`. Nightly builds are named `Clips Nightly`, use the
`Clips-Nightly` binary, the `clips-nightly://` scheme, and
`com.clips.tray.nightly`. They use the `clips-nightly-v*` tags,
`clips-nightly-latest` pointer, and `/api/clips-updater.json?channel=nightly`.
The in-app updater only sees the pointer for the channel that produced the
installed app, and the separate native binary/desktop entry keeps both lanes
installable at once.

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
