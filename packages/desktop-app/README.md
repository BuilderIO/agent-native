# Agent Native — Electron Shell

A minimal Electron container that loads agent-native apps as tabbed modules. Each app runs as an independent dev server and is embedded in an Electron `<webview>`, preserving its full state (login sessions, scroll position, in-flight requests) when you switch between tabs.

```
┌────────────────────────────────────────────────────┐
│  ●  ●  ●   Agent Native                            │  ← macOS title bar
├──────┬─────────────────────────────────────────────┤
│      │                                             │
│  ✉   │                                             │
│ Mail │         Active app webview                  │
│      │         (fills entire content area)         │
│  📅  │                                             │
│ Cal  │                                             │
│      │                                             │
│  📝  │                                             │
│ Cont │                                             │
│      │                                             │
│ ···  │                                             │
│      │                                             │
│  ⚙   │                                             │
└──────┴─────────────────────────────────────────────┘
```

---

## Quick start

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Start everything

```bash
# From the repo root — starts calendar + content + Electron
pnpm dev:electron
```

Or start specific apps:

```bash
node scripts/dev-electron.ts --apps calendar,slides
```

Or run just the Electron shell (if apps are already running):

```bash
pnpm --filter @agent-native/electron-shell dev
```

---

## Architecture

```
packages/electron-shell/
├── index.html                    # Renderer entry point
├── electron.vite.config.ts       # Build config (main + preload + renderer)
├── shared/
│   ├── app-registry.ts           # App definitions (id, name, port, color…)
│   └── ipc-channels.ts           # IPC channel name constants
└── src/
    ├── main/index.ts             # Electron main process
    ├── preload/index.ts          # Context bridge (exposes window.electronAPI)
    └── renderer/
        ├── App.tsx               # Root component — tab state management
        ├── shell.css             # Shell chrome styles (no framework)
        ├── global.d.ts           # window.electronAPI + <webview> typings
        └── components/
            ├── Sidebar.tsx       # Left nav with app tabs
            └── AppWebview.tsx    # Webview slot with loading/error/placeholder states
```

### How tab state is preserved

Each app's `<webview>` is **mounted once and never unmounted**. Switching tabs simply toggles `display: none` on the inactive slots. The webview process keeps running in the background, so:

- Login sessions survive tab switches
- Scroll positions are preserved
- In-flight network requests complete normally
- No re-render or reload on tab switch

### IPC surface (`window.electronAPI`)

Available in all renderer code via the preload context bridge:

```ts
// Window chrome
window.electronAPI.windowControls.minimize()
window.electronAPI.windowControls.maximize()
window.electronAPI.windowControls.close()
window.electronAPI.windowControls.isMaximized() // Promise<boolean>
window.electronAPI.windowControls.onMaximizedChange(cb) // returns unsubscribe fn

// Inter-app messaging
window.electronAPI.interApp.send(targetAppId, event, data)
window.electronAPI.interApp.on((from, event, data) => { … }) // returns unsubscribe fn

// Platform
window.electronAPI.platform // "darwin" | "win32" | "linux"
```

---

## Adding a new app

### Step 1 — Register the app

Edit `shared/app-registry.ts` and add a new entry to `APP_REGISTRY`:

```ts
{
  id: "notes",
  name: "Notes",
  icon: "StickyNote",       // any Lucide icon name
  description: "Quick notes",
  devPort: 8086,            // pick an unused port
  color: "#06B6D4",
  colorRgb: "6 182 212",
},
```

### Step 2 — Add the icon import

Open `src/renderer/components/Sidebar.tsx` and add the icon to the import and `ICON_MAP`:

```ts
import { …, StickyNote } from "lucide-react";

const ICON_MAP = {
  …
  StickyNote,
};
```

### Step 3 — Wire up the dev runner

Add the port to `scripts/dev-electron.ts`:

```ts
const PORT_MAP: Record<string, number> = {
  …
  notes: 8086,
};
```

Then start with:

```bash
node scripts/dev-electron.ts --apps calendar,content,notes
```

---

## Inter-app communication

Apps can send messages to each other through the Electron IPC relay.

**Sending (from any webview or the shell renderer):**

```ts
// From the shell renderer
window.electronAPI.interApp.send("calendar", "open-event", { eventId: "abc" });
```

**Receiving (in the target app's webview):**

Since webviews are sandboxed, they can't directly access `window.electronAPI`. To receive inter-app messages inside a webview, inject a listener via the webview's preload or use `webContents.executeJavaScript` from the shell.

A simpler pattern is to use URL-based routing: navigate the target webview to a deep-link URL that the app handles via React Router.

```ts
// In AppWebview.tsx — listen for inter-app events and act on them
window.electronAPI.interApp.on((from, event, data) => {
  if (event === "open-event" && app.id === "calendar") {
    webviewRef.current?.src = `http://localhost:${app.devPort}/events/${data.eventId}`;
  }
});
```

---

## Port assignments

| App       | Dev port           |
| --------- | ------------------ |
| mail      | 8081 (placeholder) |
| calendar  | 8082               |
| content   | 8083               |
| analytics | 8084               |
| slides    | 8085               |

---

## Platform differences

| Feature             | macOS                                    | Windows / Linux                |
| ------------------- | ---------------------------------------- | ------------------------------ |
| Window controls     | Native traffic lights (red/yellow/green) | Custom colored dots in sidebar |
| Title bar drag      | Top of sidebar is draggable              | Top of sidebar is draggable    |
| Sidebar top padding | 48 px (clears traffic lights)            | 8 px                           |

---

## Building for distribution

```bash
pnpm --filter @agent-native/electron-shell build
```

This outputs:

- `dist/main/` — compiled main process (CJS)
- `dist/preload/` — compiled preload script (CJS)
- `dist/renderer/` — built React SPA

To package into a distributable app, add `electron-builder` and run:

```bash
npx electron-builder --config electron-builder.yml
```

See [electron-builder docs](https://www.electron.build) for platform-specific packaging.
