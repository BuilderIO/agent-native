# Clips Tray — Desktop menu-bar app

A small Tauri 2.x menu-bar app that lives in the macOS menu bar / Windows system tray. Click the icon — or press the global shortcut `Cmd/Ctrl+Shift+L` — to open a popover with:

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
pnpm tauri:build  # produce a .dmg / .msi
```

## First-run configuration

On first launch the popover asks for the URL of your Clips server. This is stored in `localStorage` (default: `http://localhost:8080`). You can change it at any time from the popover's "Server" link.

## Manual TODOs before shipping

- Replace `src-tauri/icons/tray.png` with a real 16×16 (and 32×32 @2x) monochrome PNG. The default placeholder is a plain purple square so the app still compiles out of the box.
- Add Apple Developer ID + Windows Authenticode signing config to `tauri.conf.json` — currently left blank.
- Run the **Updater signing key** setup below before the first release. Without it, `tauri-action` will refuse to build a signed bundle and the in-app updater will reject whatever the workflow uploads.

## Releases + auto-update

Clips Desktop ships on its own release channel — tag prefix `clips-v*`, separate from the main `v*` tags used by `packages/desktop-app` (Electron). The in-app updater pulls its manifest from the hosted Clips endpoint (`/api/clips-updater.json`), which proxies the stable pointer release (`clips-latest`) when a signed manifest exists and otherwise returns a no-update manifest so end users do not see release-channel setup errors.

### Shipping a release

1. Bump `templates/clips/desktop/package.json` version (or pass it via workflow input).
2. Trigger **Clips Desktop Release** in GitHub Actions (`.github/workflows/clips-desktop-release.yml`). It builds on macOS (universal), Windows, and Linux in parallel, signs everything, and uploads to `clips-v{version}`.
3. After all three platforms finish, the `publish-release` job flips the versioned release out of draft and refreshes the `clips-latest` pointer release with the new manifest. Within a few hours (next update check) every installed Clips starts auto-downloading in the background through the hosted manifest endpoint.

### Auto-update flow (inside the app)

- `src/lib/updater.ts` checks for updates 3s after launch and every 4 hours.
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
