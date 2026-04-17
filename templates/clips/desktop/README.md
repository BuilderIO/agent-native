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
