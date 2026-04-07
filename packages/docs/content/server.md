---
title: "Server"
description: "Nitro server layer with file-based routing, server plugins, SSE handlers, and production agent configuration."
---

# Server

Agent-native apps use [Nitro](https://nitro.build) for the server layer. Nitro is included automatically via the `defineConfig()` Vite plugin — you get file-based API routing, server plugins, and deploy-anywhere presets out of the box.

## File-Based Routing {#file-based-routing}

API routes live in `server/routes/`. Nitro auto-discovers them based on file name and path:

```text
server/routes/
  api/
    hello.get.ts          → GET  /api/hello
    items/
      index.get.ts        → GET  /api/items
      index.post.ts       → POST /api/items
      [id].get.ts         → GET  /api/items/:id
      [id].delete.ts      → DELETE /api/items/:id
      [id]/
        archive.patch.ts  → PATCH /api/items/:id/archive
```

Each route file exports a default `defineEventHandler`:

```ts
// server/routes/api/items/index.get.ts
import { defineEventHandler } from "h3";
import fs from "fs/promises";

export default defineEventHandler(async () => {
  const files = await fs.readdir("./data/items");
  const items = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) =>
        JSON.parse(await fs.readFile(`./data/items/${f}`, "utf-8")),
      ),
  );
  return items;
});
```

### Route naming conventions {#route-naming-conventions}

| File name pattern  | HTTP method | Example path               |
| ------------------ | ----------- | -------------------------- |
| `index.get.ts`     | GET         | `/api/items`               |
| `index.post.ts`    | POST        | `/api/items`               |
| `[id].get.ts`      | GET         | `/api/items/:id`           |
| `[id].patch.ts`    | PATCH       | `/api/items/:id`           |
| `[id].delete.ts`   | DELETE      | `/api/items/:id`           |
| `[...slug].get.ts` | GET         | `/api/items/* (catch-all)` |

### Accessing route parameters {#accessing-route-parameters}

```ts
import { defineEventHandler, getRouterParam, readBody, getQuery } from "h3";

// GET /api/items/:id
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const { filter } = getQuery(event);
  // ...
});
```

## Server Plugins {#server-plugins}

Cross-cutting concerns — file watchers, file sync, scheduled jobs, auth — go in `server/plugins/`. Nitro runs these at startup before serving requests:

```ts
// server/plugins/file-sync.ts
import { defineNitroPlugin } from "@agent-native/core";
import { createFileSync } from "@agent-native/core/adapters/sync";

export default defineNitroPlugin(async () => {
  const result = await createFileSync({ contentRoot: "./data" });
  if (result.status === "error") {
    console.warn(`[app] File sync failed: ${result.reason}`);
  }
});
```

## Shared State Between Plugins and Routes {#shared-state}

Use a shared module in `server/lib/` to pass state from plugins to route handlers:

```ts
// server/lib/watcher.ts
import { createFileWatcher } from "@agent-native/core";
import type { SSEHandlerOptions } from "@agent-native/core";

export const watcher = createFileWatcher("./data");
export const sseExtraEmitters: NonNullable<SSEHandlerOptions["extraEmitters"]> =
  [];

export let syncResult: any = { status: "disabled" };
export function setSyncResult(result: any) {
  syncResult = result;
  if (result.status === "ready" && result.sseEmitter) {
    sseExtraEmitters.push(result.sseEmitter);
  }
}
```

The plugin populates the state at startup; route handlers read it at request time.

## createFileWatcher(dir, options?) {#createfilewatcher}

Creates a chokidar file watcher for real-time file change detection:

```ts
import { createFileWatcher } from "@agent-native/core";

const watcher = createFileWatcher("./data");
// watcher emits "all" events: (eventName, filePath)
```

### Options {#filewatcher-options}

| Option        | Type    | Description                                       |
| ------------- | ------- | ------------------------------------------------- |
| `ignored`     | any     | Glob patterns or regex to ignore                  |
| `emitInitial` | boolean | Emit events for initial file scan. Default: false |

## createSSEHandler(watcher, options?) {#createssehandler}

Creates an H3 event handler that streams file changes as Server-Sent Events:

```ts
// server/routes/_agent-native/events.get.ts
import { createSSEHandler } from "@agent-native/core";
import { watcher, sseExtraEmitters } from "../../lib/watcher.js";

export default createSSEHandler(watcher, {
  extraEmitters: sseExtraEmitters,
  contentRoot: "./data",
});
```

Each SSE message is JSON: `{ "type": "change", "path": "data/file.json" }`

### Options {#ssehandler-options}

| Option        | Type                        | Description                                       |
| ------------- | --------------------------- | ------------------------------------------------- |
| extraEmitters | `Array<{ emitter, event }>` | Additional EventEmitters to stream                |
| contentRoot   | string                      | Root directory used to relativize paths in events |

## createServer(options?) {#createserver}

Optional helper that creates a pre-configured H3 app with CORS middleware and a health-check route. Returns `{ app, router }`. Useful for programmatic route registration when file-based routing doesn't fit:

```ts
import { createServer } from "@agent-native/core";
import { defineEventHandler } from "h3";

const { app, router } = createServer();
router.get("/api/items", defineEventHandler(listItems));
```

## mountAuthMiddleware(app, accessToken) {#mountauthmiddleware}

Mounts session-cookie authentication onto an H3 app. Serves a login page for unauthenticated browser requests and returns 401 for unauthenticated API requests.

```ts
import { mountAuthMiddleware } from "@agent-native/core";

mountAuthMiddleware(app, process.env.ACCESS_TOKEN!);
```

Adds two routes automatically: `POST /api/auth/login` and `POST /api/auth/logout`.

## createProductionAgentHandler(options) {#createproductionagenthandler}

Creates an H3 SSE handler at `POST /_agent-native/agent-chat` that runs an agentic tool loop using Claude. Each script's `run()` function is registered as a tool the agent can invoke.

```ts
import { createProductionAgentHandler } from "@agent-native/core";
import { scripts } from "./scripts/registry.js";
import { readFileSync } from "fs";

const agent = createProductionAgentHandler({
  scripts,
  systemPrompt: readFileSync("agents/system-prompt.md", "utf-8"),
});
```

### Options {#agent-handler-options}

| Option         | Type                          | Description                                       |
| -------------- | ----------------------------- | ------------------------------------------------- |
| `scripts`      | `Record<string, ScriptEntry>` | Map of script name → { tool, run } entries        |
| `systemPrompt` | string                        | System prompt for the embedded agent              |
| `apiKey`       | string                        | Anthropic API key. Default: ANTHROPIC_API_KEY env |
| `model`        | string                        | Model to use. Default: claude-sonnet-4-6          |
