# @agent-native/pinpoint

Visual feedback and annotation tool for web applications. Select UI elements, add feedback, and send structured context to any AI agent.

Works standalone, with [Builder.io](https://builder.io), or with any agent harness that speaks the agent-native protocol (Claude Code, Codex, Gemini CLI, Cursor, etc.).

## Install

```sh
npm install @agent-native/pinpoint
```

## Quick Start

### In a Browser (Script Tag)

```html
<script src="https://unpkg.com/@agent-native/pinpoint/dist/index.global.js"></script>
<script>
  Pinpoint.mountPinpoint({ author: "Designer" });
</script>
```

### In a React App

```tsx
import { mountPinpoint } from "@agent-native/pinpoint";
import { useEffect } from "react";

function App() {
  useEffect(() => {
    const { dispose } = mountPinpoint({
      author: "Designer",
      colorScheme: "auto",
      endpoint: "/api/pins", // optional: enable server persistence
    });
    return dispose;
  }, []);

  return <div>Your app here</div>;
}
```

### In an Agent-Native App

Pinpoint is designed as a first-class plugin for [agent-native](https://github.com/BuilderIO/agent-native) apps. Add it to your existing app:

**1. Add the dependency:**

```sh
pnpm add @agent-native/pinpoint
```

**2. Mount in your client:**

```tsx
// client/App.tsx
import { mountPinpoint } from "@agent-native/pinpoint";
import { useEffect } from "react";

export default function App() {
  useEffect(() => {
    const { dispose } = mountPinpoint({
      author: "Designer",
      endpoint: "/api/pins",
      autoSubmit: true,
    });
    return dispose;
  }, []);

  return <YourApp />;
}
```

**3. Add the server middleware:**

```ts
// server/index.ts
import { createServer } from "@agent-native/core";
import { pagePinRoutes } from "@agent-native/pinpoint/server";

const app = createServer({
  /* ... */
});
app.use("/api/pins", pagePinRoutes());
```

**4. Copy the agent scripts to your app's `scripts/` directory:**

```sh
cp node_modules/@agent-native/pinpoint/src/scripts/*.ts scripts/
```

Now the agent can read, create, resolve, and delete annotations via `pnpm script get-pins`, `pnpm script resolve-pin --id <uuid>`, etc.

### With Builder.io

Use Pinpoint inside [Builder.io's Fusion](https://builder.io) to annotate your visual editor output and send feedback directly to the AI agent:

```tsx
import { mountPinpoint } from "@agent-native/pinpoint";

mountPinpoint({
  author: "Builder User",
  autoSubmit: true, // sends annotations straight to the agent chat
  outputFormat: "standard",
});
```

Annotations are sent via `sendToAgentChat()` from `@agent-native/core`, which communicates with Builder.io's Fusion chat bridge via `postMessage`. No additional configuration is needed when running inside a Builder.io harness.

## How It Works

1. **Toggle** the toolbar with `Cmd+Shift+.` (or `Ctrl+Shift+.`)
2. **Click** any element on the page to annotate it
3. **Type** your feedback in the popup
4. **Send** to the agent (`Cmd+Shift+Enter`) or **Copy** to clipboard (`Cmd+Shift+C`)

The agent receives structured context: CSS selector, component hierarchy, source file location, computed styles, and your comment.

## Configuration

```ts
mountPinpoint({
  // Who is annotating
  author: "Designer",

  // REST endpoint for pin persistence (optional)
  endpoint: "/api/pins",

  // Color scheme: 'auto' | 'light' | 'dark'
  colorScheme: "auto",

  // Output format: 'compact' | 'standard' | 'detailed'
  outputFormat: "standard",

  // Auto-submit annotations to the agent chat
  autoSubmit: true,

  // Clear annotations after sending
  clearOnSend: false,

  // Block page interactions during element selection
  blockInteractions: false,

  // Freeze JS timers during selection (opt-in, disabled by default)
  freezeJSTimers: false,

  // Allowed origins for postMessage security
  allowedOrigins: ["https://yourapp.com"],

  // Webhook URL for pin events
  webhookUrl: "https://yourapp.com/hooks/pinpoint",

  // Include source file paths in output
  includeSourcePaths: true,

  // Custom storage adapter (default: MemoryStore or RestClient)
  storage: customAdapter,

  // Plugins
  plugins: [myPlugin],

  // Initial toolbar position
  position: { x: 100, y: 100 },

  // Marker color
  markerColor: "#3b82f6",
});
```

## Keyboard Shortcuts

| Shortcut               | Action                         |
| ---------------------- | ------------------------------ |
| `Cmd/Ctrl+Shift+.`     | Toggle toolbar                 |
| `Cmd/Ctrl+Shift+C`     | Copy annotations to clipboard  |
| `Cmd/Ctrl+Shift+Enter` | Send annotations to agent      |
| `Esc`                  | Close popup / collapse toolbar |
| `Arrow Up/Down`        | Navigate component tree        |
| `Shift+Drag`           | Multi-select elements          |
| `Cmd/Ctrl+Shift+Click` | Add to selection               |

## Primitives API

Use standalone functions for agent-initiated element inspection, independent of the UI:

```ts
import {
  getElementContext,
  freeze,
  unfreeze,
  openFile,
  detectFramework,
} from "@agent-native/pinpoint/primitives";

// Inspect any element programmatically
const context = getElementContext(document.querySelector(".sidebar"));

// Freeze all animations while inspecting
freeze();
// ... do work ...
unfreeze();

// Open a file in the user's editor
openFile("src/components/Sidebar.tsx", 42);
```

## Agent Scripts

Scripts for agent CRUD operations on annotations. Run with `pnpm script <name>`:

| Script           | Description                 | Args                                   |
| ---------------- | --------------------------- | -------------------------------------- |
| `get-pins`    | List annotations            | `--pageUrl`, `--status`                |
| `create-pin`  | Create an annotation        | `--pageUrl`, `--selector`, `--comment` |
| `resolve-pin` | Mark as resolved            | `--id`, `--message`                    |
| `update-pin`  | Update annotation           | `--id`, `--comment`, `--status`        |
| `delete-pin`  | Remove annotation           | `--id`                                 |
| `list-sessions`  | List pages with annotations |                                        |

## Server Middleware

Express middleware for pin CRUD via REST API:

```ts
import { pagePinRoutes } from "@agent-native/pinpoint/server";

app.use("/api/pins", pagePinRoutes({ dataDir: "data/pins" }));
```

**Endpoints:**

- `GET /api/pins` — List pins (query: `pageUrl`, `status`)
- `GET /api/pins/:id` — Get a pin
- `POST /api/pins` — Create a pin
- `PATCH /api/pins/:id` — Update a pin
- `DELETE /api/pins/:id` — Delete a pin
- `DELETE /api/pins` — Clear pins (query: `pageUrl`)

## Plugin System

Extend Pinpoint with custom behavior:

```ts
import { mountPinpoint } from "@agent-native/pinpoint";
import type { Plugin } from "@agent-native/pinpoint/types";

const analyticsPlugin: Plugin = {
  name: "analytics",
  hooks: {
    onPinCreate(pin) {
      analytics.track("annotation_created", { page: pin.pageUrl });
    },
    onPinResolve(pin) {
      analytics.track("annotation_resolved", { id: pin.id });
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

mountPinpoint({ plugins: [analyticsPlugin] });
```

## A2A & MCP

Expose annotations to external agents:

```ts
import {
  registerPinpointA2A,
  createPinpointMCPTools,
} from "@agent-native/pinpoint/server";

// A2A: publish agent card at /.well-known/agent-card.json
registerPinpointA2A(app);

// MCP: create tool handlers for an MCP server
const { tools, handleTool } = createPinpointMCPTools();
```

## Framework Support

| Framework   | Detection        | Component Info      | Source Location                 |
| ----------- | ---------------- | ------------------- | ------------------------------- |
| React 18/19 | Auto (via bippy) | Component hierarchy | `_debugSource` / element-source |
| Vue 3       | Auto (`__VUE__`) | Component tree      | `$options.__file`               |
| None/Other  | Fallback         | DOM-only            | Not available                   |

## Storage Adapters

| Adapter       | Use Case              | Persistence                   |
| ------------- | --------------------- | ----------------------------- |
| `MemoryStore` | Standalone, no server | Session only (lost on reload) |
| `RestClient`  | Browser with server   | Server-side files             |
| `FileStore`   | Server-side           | `data/pins/{uuid}.json`       |

## Architecture

- **SolidJS overlay** rendered in **Shadow DOM** — zero interference with host app styles or React reconciliation
- **Canvas-based** hover highlighting with **LERP interpolation** — smooth 60fps, no DOM layout thrashing
- **One file per annotation** — eliminates concurrent write conflicts
- **Pluggable storage** — `MemoryStore` (standalone), `RestClient` (browser → server), `FileStore` (server-side)
- Uses MIT-licensed libraries: [bippy](https://github.com/aidenybai/bippy), [@medv/finder](https://github.com/antonmedv/finder), [element-source](https://www.npmjs.com/package/element-source)

## License

MIT
