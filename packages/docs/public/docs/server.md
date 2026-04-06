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

Cross-cutting concerns — auth, agent chat, polling, file sync — go in `server/plugins/`. The framework auto-discovers `.ts` files in this directory, sorts them alphabetically, and runs each one at startup.

### Default plugins (auto-mounted)

The framework provides 6 default plugins that auto-mount when your app doesn't provide a custom version. You only need to create a plugin file if you want to customize it:

| Plugin        | What it does                                                                | When to customize                           |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| `agent-chat`  | Agent chat endpoints                                                        | Custom `mentionProviders` or `systemPrompt` |
| `auth`        | Authentication middleware                                                   | Custom `publicPaths` or Google OAuth config |
| `core-routes` | `/_agent-native/poll`, `/_agent-native/events`, `/_agent-native/ping`, etc. | Custom `envKeys` or `sseRoute`              |
| `file-sync`   | File watcher for sync events                                                | Custom sync configuration                   |
| `resources`   | Resource CRUD endpoints                                                     | Rarely customized                           |
| `terminal`    | Terminal emulator endpoints                                                 | Rarely customized                           |

A minimal app needs **zero** plugin files — all defaults mount automatically. Only create plugin files for plugins you need to customize.

### Customizing a plugin

To customize a default plugin, create a file in `server/plugins/` with the same name. Your file takes precedence over the default:

```ts
// server/plugins/auth.ts — custom auth with public paths
import { createGoogleAuthPlugin } from "@agent-native/core/server";

export default createGoogleAuthPlugin({
  publicPaths: ["/api/public", "/api/forms"],
});
```

### Core Routes Plugin

The `createCoreRoutesPlugin()` mounts all standard framework API routes. It auto-mounts with no configuration, but you can customize it by creating a `server/plugins/core-routes.ts` file.

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

**With custom SSE route** — if you need to change the SSE endpoint path:

```ts
// server/plugins/core-routes.ts
import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({ sseRoute: "/_agent-native/sse" });
```

#### Routes provided

| Method | Path                              | Purpose                                           |
| ------ | --------------------------------- | ------------------------------------------------- |
| GET    | `/_agent-native/poll`             | Polling endpoint for change detection             |
| GET    | `/_agent-native/events`           | SSE endpoint for real-time sync (configurable)    |
| GET    | `/_agent-native/file-sync/status` | File sync status (deprecated, backward compat)    |
| GET    | `/_agent-native/ping`             | Health check                                      |
| GET    | `/_agent-native/env-status`       | Env key configuration status (requires `envKeys`) |
| POST   | `/_agent-native/env-vars`         | Save env vars to `.env` file (requires `envKeys`) |

#### Options

| Option            | Type             | Default                   | Description                            |
| ----------------- | ---------------- | ------------------------- | -------------------------------------- |
| `sseRoute`        | `string`         | `"/_agent-native/events"` | Path for the SSE endpoint              |
| `disableSSE`      | `boolean`        | `false`                   | Disable the SSE endpoint entirely      |
| `disableFileSync` | `boolean`        | `false`                   | Disable the file-sync status endpoint  |
| `disablePing`     | `boolean`        | `false`                   | Disable the ping health check          |
| `envKeys`         | `EnvKeyConfig[]` | —                         | Enables env-status and env-vars routes |

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
// server/routes/_agent-native/events.get.ts
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

| Option        | Type                               | Description                                                                        |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `cors`        | `Record<string, unknown> \| false` | CORS config. Pass `false` to disable.                                              |
| `pingMessage` | `string`                           | Health check response. Default: env `PING_MESSAGE` or `"pong"`                     |
| `disablePing` | `boolean`                          | Disable `/_agent-native/ping` endpoint.                                            |
| `envKeys`     | `EnvKeyConfig[]`                   | Enables `/_agent-native/env-status` and `/_agent-native/env-vars` settings routes. |

## mountAuthMiddleware(app, accessToken)

Mounts session-cookie authentication onto an H3 app. Serves a login page for unauthenticated browser requests and returns 401 for unauthenticated API requests.

```ts
import { mountAuthMiddleware } from "@agent-native/core";

mountAuthMiddleware(app, process.env.ACCESS_TOKEN!);
```

Adds two routes automatically: `POST /_agent-native/auth/login` and `POST /_agent-native/auth/logout`.

## createProductionAgentHandler(options)

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

### Options

| Option         | Type                          | Description                                         |
| -------------- | ----------------------------- | --------------------------------------------------- |
| `scripts`      | `Record<string, ScriptEntry>` | Map of script name → `{ tool, run }` entries        |
| `systemPrompt` | `string`                      | System prompt for the embedded agent                |
| `apiKey`       | `string`                      | Anthropic API key. Default: `ANTHROPIC_API_KEY` env |
| `model`        | `string`                      | Model to use. Default: `claude-sonnet-4-6`          |

## Resources

The resources system provides persistent, SQL-backed files for agent memory, instructions, and skills. Resources are accessible via the `/_agent-native/resources` API and appear in the AgentSidebar's files panel.

### Default resources

| Resource       | Scope             | Purpose                                                |
| -------------- | ----------------- | ------------------------------------------------------ |
| `AGENTS.md`    | shared + personal | Agent instructions and context                         |
| `LEARNINGS.md` | shared + personal | Preferences, corrections, patterns the agent remembers |
| `skills/*.md`  | shared + personal | Specialized agent skills with YAML frontmatter         |
| `jobs/*.md`    | shared + personal | Recurring jobs (see below)                             |

### Agent tools

The agent has built-in tools for managing resources:

- `resource-list` — List all resources
- `resource-read` — Read a resource by path
- `resource-write` — Create or update a resource
- `resource-delete` — Delete a resource

### Auto-memory

The agent proactively updates `LEARNINGS.md` when it learns something important during conversations — user corrections, preferences, patterns, or personal context. This happens automatically without needing to ask.

## Recurring Jobs

Recurring jobs let users set up scheduled tasks in natural language. The agent converts requests like "every weekday at 9am, check for overdue scorecards" into a job that runs automatically.

### How it works

1. **User asks** for something recurring in the agent chat
2. **Agent creates a job** — a resource file at `jobs/<name>.md` with cron schedule in YAML frontmatter
3. **Scheduler runs every 60 seconds**, checks for due jobs, and executes them via the same agent loop used for chat
4. **Job results** are saved as chat threads so users can review what happened

### Job file format

```markdown
---
schedule: "0 9 * * 1-5"
enabled: true
nextRun: 2026-04-07T16:00:00.000Z
---

Check if any scorecards are overdue using check-scorecards --section=overdue.
If there are overdue scorecards, send a Slack update via send-recruiter-update.
If none are overdue, do nothing.
```

### Frontmatter fields

| Field        | Type    | Description                                           |
| ------------ | ------- | ----------------------------------------------------- |
| `schedule`   | string  | Cron expression (5 fields: minute hour dom month dow) |
| `enabled`    | boolean | Whether the job runs on schedule                      |
| `lastRun`    | string  | ISO timestamp of last execution                       |
| `lastStatus` | string  | `success`, `error`, `running`, or `skipped`           |
| `lastError`  | string  | Error message from last failed run                    |
| `nextRun`    | string  | ISO timestamp of next scheduled run                   |

### Agent tools for jobs

- `create-job` — Create a recurring job with name, cron schedule, and instructions
- `list-jobs` — List all jobs and their status
- `update-job` — Update schedule, instructions, or toggle enabled/disabled
- Delete via `resource-delete --path jobs/<name>.md`

### Common cron patterns

| Schedule                | Cron expression |
| ----------------------- | --------------- |
| Every day at 9am        | `0 9 * * *`     |
| Weekdays at 9am         | `0 9 * * 1-5`   |
| Every hour              | `0 * * * *`     |
| Every 30 minutes        | `*/30 * * * *`  |
| Mondays at 9am          | `0 9 * * 1`     |
| Twice daily (9am & 5pm) | `0 9,17 * * *`  |

### UI

Jobs appear in the AgentSidebar resources panel under a `jobs/` folder. Each job file shows a colored status dot:

- **Green** — last run succeeded
- **Red** — last run failed
- **Blue (pulsing)** — currently running
- **Amber** — scheduled but hasn't run yet
- **Gray** — disabled

The resources panel toolbar includes a clock icon button for creating new recurring jobs via natural language.
