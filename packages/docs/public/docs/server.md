# Server

`@agent-native/core` provides H3 utilities for building your API server with file watching and SSE.

## createServer(options?)

Creates a pre-configured H3 app with CORS middleware and a health-check route. Returns `{ app, router }` — mount your routes on `router`.

```ts
import { createServer } from "@agent-native/core";

const { app, router } = createServer();

router.get(
  "/api/items",
  defineEventHandler(() => listItems()),
);
router.post("/api/items", defineEventHandler(createItem));
```

### Options

| Option        | Type                               | Description                                                    |
| ------------- | ---------------------------------- | -------------------------------------------------------------- |
| `cors`        | `Record<string, unknown> \| false` | CORS config. Pass `false` to disable.                          |
| `jsonLimit`   | `string`                           | Kept for API compatibility (H3 uses `readBody`).               |
| `pingMessage` | `string`                           | Health check response. Default: env `PING_MESSAGE` or `"pong"` |
| `disablePing` | `boolean`                          | Disable `/api/ping` endpoint.                                  |
| `envKeys`     | `EnvKeyConfig[]`                   | Enables `/api/env-status` and `/api/env-vars` settings routes. |

## createFileWatcher(dir, options?)

Creates a chokidar file watcher for real-time file change detection:

```ts
import { createFileWatcher } from "@agent-native/core";

const watcher = createFileWatcher("./data");
// watcher emits "all" events: (eventName, filePath)
```

### Options

| Option        | Type      | Description                                       |
| ------------- | --------- | ------------------------------------------------- |
| `ignored`     | `any`     | Glob patterns or regex to ignore                  |
| `emitInitial` | `boolean` | Emit events for initial file scan. Default: false |

## createSSEHandler(watcher, options?)

Creates an H3 event handler that streams file changes as Server-Sent Events:

```ts
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { defineEventHandler } from "h3";

export async function createAppServer() {
  const { app, router } = createServer();
  const watcher = createFileWatcher("./data");

  router.get("/api/items", defineEventHandler(listItems));
  router.post("/api/items", defineEventHandler(createItem));

  // SSE endpoint (keep last)
  router.get("/api/events", createSSEHandler(watcher));

  return app;
}
```

Each SSE message is JSON: `{ "type": "change", "path": "data/file.json" }`

### Options

| Option          | Type                        | Description                                              |
| --------------- | --------------------------- | -------------------------------------------------------- |
| `extraEmitters` | `Array<{ emitter, event }>` | Additional EventEmitters to stream (e.g. from file sync) |
| `contentRoot`   | `string`                    | Root directory used to relativize paths in events        |

## createProductionServer(app, options?)

Starts a production server that serves the built SPA, falls back to `index.html` for client-side routing, and shuts down gracefully on SIGTERM/SIGINT.

```ts
// server/node-build.ts
import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";

createAppServer().then((app) => createProductionServer(app));
```

### Options

| Option        | Type               | Description                                                  |
| ------------- | ------------------ | ------------------------------------------------------------ |
| `port`        | `number \| string` | Listen port. Default: env `PORT` or `3000`                   |
| `spaDir`      | `string`           | Built SPA directory. Default: `"dist/spa"`                   |
| `appName`     | `string`           | Name for log messages. Default: `"Agent-Native"`             |
| `agent`       | `H3EventHandler`   | Production agent handler — mounted at `POST /api/agent-chat` |
| `accessToken` | `string`           | If set, enables session-cookie auth gating all routes        |

## mountAuthMiddleware(app, accessToken)

Mounts session-cookie authentication onto an H3 app. Serves a login page for unauthenticated browser requests and returns 401 for unauthenticated API requests.

```ts
import { mountAuthMiddleware } from "@agent-native/core";

mountAuthMiddleware(app, process.env.ACCESS_TOKEN!);
```

Adds two routes automatically: `POST /api/auth/login` and `POST /api/auth/logout`. Typically used via `createProductionServer({ accessToken })` rather than directly.

## createProductionAgentHandler(options)

Creates an H3 SSE handler at `POST /api/agent-chat` that runs an agentic tool loop using Claude. Each script's `run()` function is registered as a tool the agent can invoke.

```ts
import { createProductionAgentHandler } from "@agent-native/core";
import { scripts } from "./scripts/registry.js";
import { readFileSync } from "fs";

const agent = createProductionAgentHandler({
  scripts,
  systemPrompt: readFileSync("agents/system-prompt.md", "utf-8"),
});

// Pass to createProductionServer:
createAppServer().then((app) =>
  createProductionServer(app, { agent, accessToken: process.env.ACCESS_TOKEN }),
);
```

### Options

| Option         | Type                          | Description                                         |
| -------------- | ----------------------------- | --------------------------------------------------- |
| `scripts`      | `Record<string, ScriptEntry>` | Map of script name → `{ tool, run }` entries        |
| `systemPrompt` | `string`                      | System prompt for the embedded agent                |
| `apiKey`       | `string`                      | Anthropic API key. Default: `ANTHROPIC_API_KEY` env |
| `model`        | `string`                      | Model to use. Default: `claude-sonnet-4-6`          |

Each script must export a `tool: ScriptTool` (Anthropic tool definition) and a `run(args): Promise<string>` function alongside its existing `main()` CLI entry point. See [Scripts](./scripts.md) for details.
