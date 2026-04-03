# @agent-native/pinpoint

Visual feedback and annotation tool for web applications. Users select UI elements, add feedback, and send structured context to any AI agent.

Works standalone, with [Builder.io](https://builder.io), or with any agent runtime that speaks the agent-native protocol (Builder.io, Claude Code, Codex, Gemini CLI, Cursor, etc.).

## AI Agent Setup Guide

Instructions for an AI agent (Builder.io, Claude Code, Codex, Cursor, etc.) to add Pinpoint to an agent-native repository.

### Step 1: Install

```sh
pnpm add @agent-native/pinpoint
```

### Step 2: Initialize agent actions and skill

```sh
npx @agent-native/pinpoint init
```

This copies agent actions to `actions/` and the Pinpoint skill to `.agents/skills/pinpoint/`. No manual file copying needed.

### Step 3: Mount the client overlay

Find the root React component (typically `app/App.tsx` or `src/App.tsx`). Add the `<Pinpoint />` component:

```tsx
import { Pinpoint } from "@agent-native/pinpoint/react";

// Add as a sibling to your app root — renders nothing, mounts overlay in Shadow DOM
<Pinpoint author="User" endpoint="/api/pins" autoSubmit colorScheme="auto" />;
```

If the app is not React-based, use the imperative API:

```ts
import { mountPinpoint } from "@agent-native/pinpoint";
mountPinpoint({ author: "User", endpoint: "/api/pins", autoSubmit: true });
```

### Step 4: Add server middleware

Find the Express server setup (typically `server/index.ts`). Add the pin routes:

```ts
import { pagePinRoutes } from "@agent-native/pinpoint/server";

// Add before your page routes
app.use("/api/pins", pagePinRoutes());
```

This creates REST endpoints at `/api/pins` for pin CRUD. Pins are stored as JSON files in `data/pins/`.

### Step 5: Verify

1. Start the dev server
2. Open the app in a browser
3. Press `Cmd+Shift+.` to toggle the Pinpoint toolbar
4. Click any element, add a comment, click "Add Pin"
5. Click the send button — the annotation should appear in the agent chat

### Working with Pins

Pins are stored as individual JSON files in `data/pins/{uuid}.json`:

```json
{
  "id": "uuid",
  "pageUrl": "/dashboard",
  "comment": "This button color is wrong",
  "element": {
    "tagName": "button",
    "selector": ".sidebar button.primary",
    "classNames": ["primary", "btn"]
  },
  "framework": {
    "framework": "react",
    "componentPath": "<Sidebar> <ActionButton>",
    "sourceFile": "src/components/Sidebar.tsx:42"
  },
  "status": { "state": "open" }
}
```

**Key fields for agents:**

- `sourceFile` — the exact file and line to edit
- `componentPath` — the React/Vue component hierarchy
- `selector` — CSS selector to find the element in the DOM
- `comment` — what the user wants changed

**Agent commands** (available after `npx @agent-native/pinpoint init`):

- `pnpm action get-pins --status open` — list unresolved pins
- `pnpm action resolve-pin --id <uuid>` — mark as resolved after fixing
- `pnpm action create-pin --pageUrl / --selector ".btn" --comment "Fix this"`
- `pnpm action update-pin --id <uuid> --comment "Updated feedback"`
- `pnpm action delete-pin --id <uuid>` — remove a pin

**Workflow:**

1. User creates annotations in the browser
2. Read with `pnpm action get-pins --status open`
3. Use `sourceFile` to locate and edit the relevant code
4. After fixing, mark resolved: `pnpm action resolve-pin --id <uuid>`

### Troubleshooting

| Issue                  | Fix                                                                        |
| ---------------------- | -------------------------------------------------------------------------- |
| Toolbar doesn't appear | Check that `<Pinpoint />` is mounted. Press `Cmd+Shift+.`                  |
| Pins not persisting    | Ensure `endpoint="/api/pins"` is set and server middleware is added        |
| `sourceFile` is empty  | Source detection requires dev mode. Production builds strip `_debugSource` |
| "Cannot find module"   | Run `pnpm install`. Check the package is in `dependencies`                 |

---

## Install

```sh
pnpm add @agent-native/pinpoint
# or
npm install @agent-native/pinpoint
```

## Quick Start

### React

```tsx
import { Pinpoint } from "@agent-native/pinpoint/react";

function App() {
  return (
    <>
      <Pinpoint author="Designer" endpoint="/api/pins" autoSubmit />
      <YourApp />
    </>
  );
}
```

### Vanilla JS / Script Tag

```html
<script src="https://unpkg.com/@agent-native/pinpoint/dist/index.browser.js"></script>
<script>
  Pinpoint.mountPinpoint({ author: "Designer" });
</script>
```

### Imperative API (Non-React)

```ts
import { mountPinpoint } from "@agent-native/pinpoint";

const { dispose } = mountPinpoint({
  author: "Designer",
  endpoint: "/api/pins",
});
// Call dispose() to unmount
```

## Setup in an Agent-Native App

### 1. Install

```sh
pnpm add @agent-native/pinpoint
```

### 2. Initialize

```sh
npx @agent-native/pinpoint init
```

Copies agent actions to `actions/` and the Pinpoint skill to `.agents/skills/pinpoint/`.

### 3. Client — Mount the overlay

```tsx
// app/App.tsx
import { Pinpoint } from "@agent-native/pinpoint/react";

function App() {
  return (
    <>
      <Pinpoint
        author="Designer"
        endpoint="/api/pins"
        autoSubmit
        colorScheme="auto"
      />
      <YourApp />
    </>
  );
}
```

### 4. Server — Add the REST middleware

```ts
// server/index.ts
import { createServer } from "@agent-native/core/server";
import { pagePinRoutes } from "@agent-native/pinpoint/server";

const app = createServer({
  /* ... */
});
app.use("/api/pins", pagePinRoutes());
```

## How It Works

1. **Toggle** the toolbar: `Cmd+Shift+.` (or `Ctrl+Shift+.`)
2. **Click** any element to annotate it
3. **Type** feedback in the popup
4. **Send** to the agent: `Cmd+Shift+Enter`

The agent receives structured context: CSS selector, component hierarchy, source file location, and the user's comment.

## Configuration

All options can be passed as props to `<Pinpoint />` or as the config object to `mountPinpoint()`:

| Option               | Type                                    | Default      | Description                                       |
| -------------------- | --------------------------------------- | ------------ | ------------------------------------------------- |
| `author`             | `string`                                | —            | Who is annotating                                 |
| `endpoint`           | `string`                                | —            | REST endpoint for persistence (e.g., `/api/pins`) |
| `colorScheme`        | `'auto' \| 'light' \| 'dark'`           | `'auto'`     | Theme                                             |
| `outputFormat`       | `'compact' \| 'standard' \| 'detailed'` | `'standard'` | Detail level in agent output                      |
| `autoSubmit`         | `boolean`                               | `true`       | Auto-submit annotations to agent chat             |
| `clearOnSend`        | `boolean`                               | `false`      | Clear pins after sending                          |
| `blockInteractions`  | `boolean`                               | `false`      | Block page clicks during selection                |
| `compactPopup`       | `boolean`                               | `true`       | Hide technical details behind toggle              |
| `freezeJSTimers`     | `boolean`                               | `false`      | Freeze JS timers during selection                 |
| `allowedOrigins`     | `string[]`                              | —            | Allowed origins for postMessage                   |
| `webhookUrl`         | `string`                                | —            | Webhook URL for pin events                        |
| `includeSourcePaths` | `boolean`                               | —            | Include source file paths in output               |
| `markerColor`        | `string`                                | `'#3b82f6'`  | Badge color on annotated elements                 |
| `plugins`            | `Plugin[]`                              | —            | Plugin extensions                                 |
| `storage`            | `PinStorage`                            | —            | Custom storage adapter                            |
| `position`           | `{ x, y }`                              | —            | Initial toolbar position                          |

## CLI

```sh
npx @agent-native/pinpoint init   # Copy actions and skill to your project
npx @agent-native/pinpoint        # Show help
```

## Keyboard Shortcuts

| Shortcut               | Action                         |
| ---------------------- | ------------------------------ |
| `Cmd/Ctrl+Shift+.`     | Toggle toolbar                 |
| `Cmd/Ctrl+Shift+C`     | Copy annotations to clipboard  |
| `Cmd/Ctrl+Shift+Enter` | Send annotations to agent      |
| `Esc`                  | Close popup / collapse toolbar |
| `Shift+Drag`           | Multi-select elements          |

## Package Exports

| Import Path                         | What It Provides                                              |
| ----------------------------------- | ------------------------------------------------------------- |
| `@agent-native/pinpoint`            | `mountPinpoint()`, `unmountPinpoint()`, types                 |
| `@agent-native/pinpoint/react`      | `<Pinpoint />` React component                                |
| `@agent-native/pinpoint/server`     | `pagePinRoutes()` Express middleware                          |
| `@agent-native/pinpoint/primitives` | `getElementContext()`, `freeze()`, `unfreeze()`, `openFile()` |
| `@agent-native/pinpoint/types`      | TypeScript types (`Pin`, `PinpointConfig`, etc.)              |

## Server Middleware

Express middleware for pin CRUD:

```ts
import { pagePinRoutes } from "@agent-native/pinpoint/server";

app.use("/api/pins", pagePinRoutes({ dataDir: "data/pins" }));
```

| Method | Endpoint        | Description                            |
| ------ | --------------- | -------------------------------------- |
| GET    | `/api/pins`     | List pins (query: `pageUrl`, `status`) |
| GET    | `/api/pins/:id` | Get a pin                              |
| POST   | `/api/pins`     | Create a pin                           |
| PATCH  | `/api/pins/:id` | Update a pin                           |
| DELETE | `/api/pins/:id` | Delete a pin                           |
| DELETE | `/api/pins`     | Clear pins (query: `pageUrl`)          |

## Agent Actions

Available after running `npx @agent-native/pinpoint init`:

| Action          | Purpose              | Args                                   |
| --------------- | -------------------- | -------------------------------------- |
| `get-pins`      | List pins            | `--pageUrl`, `--status`                |
| `create-pin`    | Create a pin         | `--pageUrl`, `--selector`, `--comment` |
| `resolve-pin`   | Mark as resolved     | `--id`, `--message`                    |
| `update-pin`    | Update a pin         | `--id`, `--comment`, `--status`        |
| `delete-pin`    | Remove a pin         | `--id`                                 |
| `list-sessions` | List pages with pins | —                                      |

## Primitives API

Standalone functions for programmatic element inspection (no UI):

```ts
import {
  getElementContext,
  freeze,
  unfreeze,
  openFile,
  detectFramework,
} from "@agent-native/pinpoint/primitives";

const context = getElementContext(document.querySelector(".sidebar"));

freeze(); // Pause all animations
unfreeze(); // Resume

openFile("src/components/Sidebar.tsx", 42); // Open in editor
```

## Plugin System

```ts
import type { Plugin } from "@agent-native/pinpoint/types";

const myPlugin: Plugin = {
  name: "analytics",
  hooks: {
    onPinCreate(pin) {
      analytics.track("pin_created", { page: pin.pageUrl });
    },
    onPinResolve(pin) {
      analytics.track("pin_resolved", { id: pin.id });
    },
    transformOutput(output) {
      return output + "\n\n_Sent via Pinpoint_";
    },
  },
  actions: [
    {
      label: "Export to Jira",
      handler(element, context) {
        createJiraTicket(context);
      },
    },
  ],
};
```

## A2A & MCP

Expose pins to external agents via A2A or MCP:

```ts
import {
  registerPinpointA2A,
  createPinpointMCPTools,
} from "@agent-native/pinpoint/server";

registerPinpointA2A(app); // /.well-known/agent-card.json

const { tools, handleTool } = createPinpointMCPTools(); // MCP tool handlers
```

## Framework Support

| Framework   | Detection        | Component Info      | Source Location                 |
| ----------- | ---------------- | ------------------- | ------------------------------- |
| React 18/19 | Auto (via bippy) | Component hierarchy | `_debugSource` / element-source |
| Vue 3       | Auto (`__VUE__`) | Component tree      | `$options.__file`               |
| Other       | Fallback         | DOM-only            | Not available                   |

## Storage Adapters

| Adapter       | Use Case              | Persistence                   |
| ------------- | --------------------- | ----------------------------- |
| `MemoryStore` | Standalone, no server | Session only (lost on reload) |
| `RestClient`  | Browser with server   | Server-side via REST API      |
| `FileStore`   | Server-side           | `data/pins/{uuid}.json`       |

## Builder.io Integration

Inside [Builder.io's Fusion](https://builder.io), annotations are sent via `sendToAgentChat()` from `@agent-native/core`:

```tsx
<Pinpoint author="Builder User" autoSubmit outputFormat="standard" />
```

No additional configuration needed when running inside a Builder.io project.

## Architecture

- **SolidJS overlay** in **Shadow DOM** — zero interference with host app styles or React reconciliation
- **Canvas-based** hover highlighting with LERP interpolation — smooth 60fps
- **One file per pin** — eliminates concurrent write conflicts
- **Pluggable storage** — MemoryStore, RestClient, FileStore
- MIT libraries: [bippy](https://github.com/aidenybai/bippy), [@medv/finder](https://github.com/antonmedv/finder), [element-source](https://www.npmjs.com/package/element-source)

## License

MIT
