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
pnpm --filter @agent-native/desktop-app dev
```

---

## Architecture

```
packages/desktop-app/
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

Each app's `<webview>` is **mounted once and never unmounted**. Switching tabs simply toggles `visibility: hidden` + `pointer-events: none` on the inactive slots. The webview process keeps running in the background, so:

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

Use **+ New** in the sidebar and describe the app you want. Desktop:

1. Creates the app under `~/Agent Native Apps` by default. The path is shown
   below the prompt and can be edited; Desktop remembers the new location.
2. Starts a full Agent-Native Code session to scaffold and implement the app.
3. Adds the app to the sidebar immediately.
4. Starts the managed local dev server whenever the app is opened and reloads
   the tab when it is ready.

Right-click any sidebar app to edit, hide/remove, or move it. The **Add an
existing app** disclosure in the New dialog keeps the local-folder and hosted
URL flows available for advanced use.

The manual registry workflow below is only needed when adding a new built-in
app to the Desktop distribution.

### Step 1 — Register a built-in app

Edit `shared/app-registry.ts` and add a new entry to `APP_REGISTRY`:

```ts
{
  id: "notes",
  name: "Notes",
  icon: "StickyNote",       // ICON_MAP key wired up in Sidebar.tsx (Tabler icon)
  description: "Quick notes",
  devPort: 8086,            // pick an unused port
  color: "#06B6D4",
  colorRgb: "6 182 212",
},
```

### Step 2 — Add the icon import

Open `src/renderer/components/Sidebar.tsx` and add the icon to the import and `ICON_MAP`:

```ts
import { …, IconNote } from "@tabler/icons-react";

const ICON_MAP = {
  …
  StickyNote: IconNote,
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

## App launch shortcuts

Desktop can register local global shortcuts that show Agent Native, switch to a target app, and optionally pass a view through the existing `/_agent-native/open` bridge.

Shortcuts live in the advanced settings panel under **Customize per app → Keyboard launch shortcuts**. A binding stores:

```ts
{
  accelerator: "Control+Alt+V",
  app: "mail",
  view: "inbox",
  behavior: "toggle"
}
```

`toggle` hides Agent Native when the same app is already frontmost; `show` always focuses and switches. External agents can propose a shortcut with a confirmed desktop deep link:

```text
agentnative://shortcuts/upsert?accelerator=Control%2BAlt%2BV&app=mail&view=inbox
```

## Authenticated Design previews

Desktop can render one focused, URL-backed Design screen as a native
`WebContentsView` in Interact mode. This lets restrictive sites render with a
persistent, connection-scoped cookie/session store even when they reject
iframes. The native backend fails closed to the normal DOM iframe for every
editing mode, overview, zoom, rotation, clipping, rounded corner, overlap, or
stale layout case. A bounded, versioned bitmap handoff keeps Draw/Comment and
inspectable local Edit transitions flash-free without treating screenshot
pixels as editable DOM. See
[DESIGN_NATIVE_PREVIEWS.md](./DESIGN_NATIVE_PREVIEWS.md) for the security
contract, framed-development relay, tests, and remaining compositor phases.

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
pnpm --filter @agent-native/desktop-app build
```

This outputs:

- `dist/main/` — compiled main process (CJS)
- `dist/preload/` — compiled preload script (CJS)
- `dist/renderer/` — built React SPA

To package into a distributable app, add `electron-builder` and run:

```bash
npx electron-builder@latest --config electron-builder.yml
```

See [electron-builder docs](https://www.electron.build) for platform-specific packaging.
