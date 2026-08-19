# Agent Native — Electron Shell

A minimal Electron chat-first workbench. Each app runs as an independent dev
server and is embedded in an Electron `<webview>` when opened from the app
rail or chat, preserving its full state (login sessions, scroll position,
in-flight requests) while it remains mounted.

```
┌────────────────────────────────────────────────────┐
│  ●  ●  ●   Agent Native                            │  ← macOS title bar
├──────┬─────────────────────────────────────────────┤
│  rail  │        Chat + contextual app pane         │
│        │                                             │
│  New   │        Agent conversation                  │
│ Search │                                             │
│ Chats  │        App/browser/watch surfaces open     │
│ Apps   │        here when selected                  │
│        │                                             │
│  ⚙     │                                             │
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
        ├── App.tsx               # Root component — always-on chat-first shell
        ├── shell.css             # Shell chrome styles (no framework)
        ├── global.d.ts           # window.electronAPI + <webview> typings
        └── components/
            ├── CodeAgentsHub.tsx  # Chat-first rail and contextual surfaces
            └── AppWebview.tsx    # Webview slot with loading/error/placeholder states
```

### How app state is preserved

Each opened app's `<webview>` is **mounted once and never unmounted**. Moving
between chat, apps, and contextual surfaces simply hides inactive slots. The
webview process keeps running in the background, so:

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

Use **+ New** in the chat-first rail and describe the app you want. Desktop:

1. Creates the app under `~/Agent Native Apps` by default. The path is shown
   below the prompt and can be edited; Desktop remembers the new location.
2. Starts a full Agent-Native Code session to scaffold and implement the app.
3. Adds the app to the app rail immediately.
4. Starts the managed local dev server whenever the app is opened and reloads
   the tab when it is ready.

Right-click any app in the rail or app grid to edit, hide/remove, or move it. The **Add an
existing app** disclosure in the New dialog keeps the local-folder and hosted
URL flows available for advanced use.

### Make a code change locally from app chat

When a prompt needs a code change, the Electron app offers **Do locally** next
to the existing Builder cloud handoff. Choosing it creates an editable clone of
the selected first-party template with the CLI, installs dependencies, and
applies the request in a managed local workspace. Desktop then switches only
that app's preview to its local dev server; the app's production URL and hosted
deployment remain unchanged.

The manual registry workflow below is only needed when adding a new built-in
app to the Desktop distribution.

### Step 1 — Register a built-in app

Edit `shared/app-registry.ts` and add a new entry to `APP_REGISTRY`:

```ts
{
  id: "notes",
  name: "Notes",
  icon: "StickyNote",       // APP_ICON_MAP key in CodeAgentsAppIcon.tsx
  description: "Quick notes",
  devPort: 8086,            // pick an unused port
  color: "#06B6D4",
  colorRgb: "6 182 212",
},
```

### Step 2 — Add the icon import

Open `src/renderer/components/CodeAgentsAppIcon.tsx` and add the icon to the
import and `APP_ICON_MAP`:

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

## Quick Prompt

Quick Prompt is an opt-in global command bar for the native Agent chat. Enable
it in Desktop Settings, then press Cmd+Space from any app to bring the bar
above other windows. Submitting creates the same native coding chat as the
Agent surface and returns focus to that run. The preference is off by default
and is stored locally with the desktop settings.

## Shared sign-in for workspace apps

Desktop presents the parent sign-in surface inline the first time a hosted app
needs authentication. After that sign-in completes, eligible built-in and
custom workspace apps receive short-lived app sessions through Dispatch and
open without another login screen.

The supported flow is:

1. Open an app while signed out and complete the inline Google-first sign-in
   surface. Password sign-in stays inline; Google and magic-link verification
   may complete in the system browser before returning to Desktop.
2. Desktop stores the parent session in its persistent identity partition and
   mints a separate target-app session for each eligible workspace app. The
   parent bearer is never used as proof of a child-app session.
3. Reopening an app reuses its child session when it is still present. If a
   child cookie was cleared or expired, Desktop mints it again instead of
   treating a stale completed sync as success.

Custom workspace apps must be explicitly registered for Desktop SSO through
`IDENTITY_SSO_APP_REGISTRY_JSON` and must be available to the signed-in
workspace. App-specific first-use setup, such as choosing a role, still occurs
inside that app after identity propagation.

To switch accounts, sign out from Desktop first, then complete the next
account's sign-in. This clears the parent and child sessions together and
prevents an existing identity from being adopted by a different account.

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

| Feature          | macOS                                    | Windows / Linux                  |
| ---------------- | ---------------------------------------- | -------------------------------- |
| Window controls  | Native traffic lights (red/yellow/green) | Custom colored dots in chat rail |
| Title bar drag   | Top of chat rail is draggable            | Top of chat rail is draggable    |
| Rail top padding | 48 px (clears traffic lights)            | 8 px                             |

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

### Release channels

The `Desktop App Release` workflow keeps stable and Nightly installs separate:

- Production keeps the `Agent Native` name and `com.agentnative.desktop` app ID.
  It is released only by dispatching the workflow with `channel: production`.
- Nightly uses the `Agent Native Nightly` name and
  `com.agentnative.desktop.nightly` app ID. Pushes to `main` publish this lane
  automatically, with prerelease tags and update metadata under
  `/api/desktop-updates/nightly/`.

The different app IDs let employees install both lanes side by side. Each lane
only updates from its own GitHub release stream. Nightly Linux packages also
use the `agent-native-nightly` executable namespace so their launcher and
package files do not overwrite the production install.
