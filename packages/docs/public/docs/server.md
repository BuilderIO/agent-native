# Server

Agent-native apps use [Nitro](https://nitro.build) for the server layer. Nitro is included automatically via the `defineConfig()` Vite plugin — you get file-based API routing, server plugins, and deploy-anywhere presets out of the box.

## File-Based Routing

API routes live in `server/routes/`. Nitro auto-discovers them based on file name and path:

```
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

### Route naming conventions

| File name pattern  | HTTP method | Example path               |
| ------------------ | ----------- | -------------------------- |
| `index.get.ts`     | GET         | `/api/items`               |
| `index.post.ts`    | POST        | `/api/items`               |
| `[id].get.ts`      | GET         | `/api/items/:id`           |
| `[id].patch.ts`    | PATCH       | `/api/items/:id`           |
| `[id].delete.ts`   | DELETE      | `/api/items/:id`           |
| `[...slug].get.ts` | GET         | `/api/items/*` (catch-all) |

### Accessing route parameters

```ts
import { defineEventHandler, getRouterParam, readBody, getQuery } from "h3";

// GET /api/items/:id
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const { filter } = getQuery(event);
  // ...
});

// POST /api/items
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  // ...
});
```

## Server Plugins

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

### Core Routes Plugin

The `createCoreRoutesPlugin()` mounts all standard framework API routes as a single Nitro plugin, eliminating the need for individual boilerplate route files. Every template should include this plugin.

**Simplest usage** — no configuration needed:

```ts
// server/plugins/core-routes.ts
export { defaultCoreRoutesPlugin as default } from "@agent-native/core/server";
```

**With env key management** — enables the settings UI to save API keys and credentials:

```ts
// server/plugins/core-routes.ts
import { createCoreRoutesPlugin } from "@agent-native/core/server";
import { envKeys } from "../lib/env-config.js";

export default createCoreRoutesPlugin({ envKeys });
```

Where `env-config.ts` defines the allowed keys:

```ts
// server/lib/env-config.ts
import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  { key: "STRIPE_SECRET_KEY", label: "Stripe", required: false },
  { key: "GITHUB_TOKEN", label: "GitHub", required: false },
];
```

**With custom SSE route** — for templates where `/api/events` conflicts with app routes (e.g. a calendar app that has event CRUD at `/api/events/`):

```ts
// server/plugins/core-routes.ts
import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({ sseRoute: "/api/sse" });
```

#### Routes provided

| Method | Path                    | Purpose                                           |
| ------ | ----------------------- | ------------------------------------------------- |
| GET    | `/api/poll`             | Polling endpoint for change detection             |
| GET    | `/api/events`           | SSE endpoint for real-time sync (configurable)    |
| GET    | `/api/file-sync/status` | File sync status (deprecated, backward compat)    |
| GET    | `/api/ping`             | Health check                                      |
| GET    | `/api/env-status`       | Env key configuration status (requires `envKeys`) |
| POST   | `/api/env-vars`         | Save env vars to `.env` file (requires `envKeys`) |

#### Options

| Option            | Type             | Default         | Description                            |
| ----------------- | ---------------- | --------------- | -------------------------------------- |
| `sseRoute`        | `string`         | `"/api/events"` | Path for the SSE endpoint              |
| `disableSSE`      | `boolean`        | `false`         | Disable the SSE endpoint entirely      |
| `disableFileSync` | `boolean`        | `false`         | Disable the file-sync status endpoint  |
| `disablePing`     | `boolean`        | `false`         | Disable the ping health check          |
| `envKeys`         | `EnvKeyConfig[]` | —               | Enables env-status and env-vars routes |

When new framework routes are added to `createCoreRoutesPlugin()`, all templates pick them up automatically on the next dependency update — no per-template file changes needed.

## Credentials (SQL-Backed Secrets)

For per-user or per-account credentials (API keys, tokens, service account files), use `@agent-native/core/credentials` instead of environment variables. Credentials are stored in the SQL `settings` table and work in all deployment environments including serverless.

```ts
import {
  resolveCredential,
  saveCredential,
  hasCredential,
} from "@agent-native/core/credentials";

// Read — checks process.env first (backward compat), then SQL
const token = await resolveCredential("STRIPE_SECRET_KEY");

// Write — saves to SQL settings store
await saveCredential("STRIPE_SECRET_KEY", "sk_live_...");

// Check existence
const configured = await hasCredential("STRIPE_SECRET_KEY");
```

### When to use credentials vs env vars

| Type                 | Storage                          | Examples                                               |
| -------------------- | -------------------------------- | ------------------------------------------------------ |
| **Infrastructure**   | Env vars (`.env`, deploy config) | `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                  |
| **App-level shared** | Env vars                         | `GOOGLE_CLIENT_ID`, `ANTHROPIC_API_KEY`                |
| **Per-user/account** | `@agent-native/core/credentials` | `STRIPE_SECRET_KEY`, `GA4_PROPERTY_ID`, `GITHUB_TOKEN` |

The `envKeys` option on `createCoreRoutesPlugin` is for infrastructure keys that should be env vars. Use the credentials API for everything else.

## Shared State Between Plugins and Routes

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
// server/routes/api/events.get.ts
import { createSSEHandler } from "@agent-native/core";
import { watcher, sseExtraEmitters } from "../../lib/watcher.js";

export default createSSEHandler(watcher, {
  extraEmitters: sseExtraEmitters,
  contentRoot: "./data",
});
```

Each SSE message is JSON: `{ "type": "change", "path": "data/file.json" }`

### Options

| Option          | Type                        | Description                                              |
| --------------- | --------------------------- | -------------------------------------------------------- |
| `extraEmitters` | `Array<{ emitter, event }>` | Additional EventEmitters to stream (e.g. from file sync) |
| `contentRoot`   | `string`                    | Root directory used to relativize paths in events        |

## createServer(options?)

Optional helper that creates a pre-configured H3 app with CORS middleware and a health-check route. Returns `{ app, router }`. Useful for programmatic route registration in server plugins when file-based routing doesn't fit (e.g., complex catch-all patterns):

```ts
import { createServer } from "@agent-native/core";

const { app, router } = createServer();
router.get("/api/items", defineEventHandler(listItems));
```

### Options

| Option        | Type                               | Description                                                    |
| ------------- | ---------------------------------- | -------------------------------------------------------------- |
| `cors`        | `Record<string, unknown> \| false` | CORS config. Pass `false` to disable.                          |
| `pingMessage` | `string`                           | Health check response. Default: env `PING_MESSAGE` or `"pong"` |
| `disablePing` | `boolean`                          | Disable `/api/ping` endpoint.                                  |
| `envKeys`     | `EnvKeyConfig[]`                   | Enables `/api/env-status` and `/api/env-vars` settings routes. |

## mountAuthMiddleware(app, accessToken)

Mounts session-cookie authentication onto an H3 app. Serves a login page for unauthenticated browser requests and returns 401 for unauthenticated API requests.

```ts
import { mountAuthMiddleware } from "@agent-native/core";

mountAuthMiddleware(app, process.env.ACCESS_TOKEN!);
```

Adds two routes automatically: `POST /api/auth/login` and `POST /api/auth/logout`.

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
```

### Options

| Option         | Type                          | Description                                         |
| -------------- | ----------------------------- | --------------------------------------------------- |
| `scripts`      | `Record<string, ScriptEntry>` | Map of script name → `{ tool, run }` entries        |
| `systemPrompt` | `string`                      | System prompt for the embedded agent                |
| `apiKey`       | `string`                      | Anthropic API key. Default: `ANTHROPIC_API_KEY` env |
| `model`        | `string`                      | Model to use. Default: `claude-sonnet-4-6`          |
