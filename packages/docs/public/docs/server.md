# Server

`@agent-native/core` provides Express utilities for building your API server with file watching and SSE.

## createServer(options?)

Creates a pre-configured Express app with standard middleware:

```ts
import { createServer } from "@agent-native/core";

const app = createServer();
// Includes: cors, json({ limit: "50mb" }), urlencoded, /api/ping
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `cors` | `CorsOptions \| false` | CORS config. Pass false to disable. |
| `jsonLimit` | `string` | JSON body parser limit. Default: "50mb" |
| `pingMessage` | `string` | Health check response. Default: env PING_MESSAGE or "pong" |
| `disablePing` | `boolean` | Disable /api/ping endpoint |

## createFileWatcher(dir, options?)

Creates a chokidar file watcher for real-time file change detection:

```ts
import { createFileWatcher } from "@agent-native/core";

const watcher = createFileWatcher("./data");
// watcher emits "all" events: (eventName, filePath)
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `ignored` | `any` | Glob patterns or regex to ignore |
| `emitInitial` | `boolean` | Emit events for initial file scan. Default: false |

## createSSEHandler(watcher, options?)

Creates an Express route handler that streams file changes as Server-Sent Events:

```ts
import { createServer, createFileWatcher, createSSEHandler } from "@agent-native/core";

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  app.get("/api/items", listItems);
  app.post("/api/items", createItem);

  // SSE endpoint (keep last)
  app.get("/api/events", createSSEHandler(watcher));

  return app;
}
```

Each SSE message is JSON: `{ "type": "change", "path": "data/file.json" }`

### Options

| Option | Type | Description |
|--------|------|-------------|
| `extraEmitters` | `Array<{ emitter, event }>` | Additional EventEmitters to stream |

## createProductionServer(app, options?)

Starts a production server with SPA fallback and graceful shutdown:

```ts
// server/node-build.ts
import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";

createProductionServer(createAppServer());
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `port` | `number \| string` | Listen port. Default: env PORT or 3000 |
| `spaDir` | `string` | Built SPA directory. Default: "dist/spa" |
| `appName` | `string` | Name for log messages. Default: "Agent-Native" |
