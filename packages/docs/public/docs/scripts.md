# Scripts

`@agent-native/core` provides a script dispatcher and utilities for building agent-callable scripts.

## Script Dispatcher

The script system lets you create scripts that agents can invoke via `pnpm script <name>`. Each script is a TypeScript file that exports a default async function.

```ts
// scripts/run.ts — dispatcher (one-time setup)
import { runScript } from "@agent-native/core";
runScript();
```

```ts
// scripts/hello.ts — example script
import { parseArgs } from "@agent-native/core";

export default async function hello(args: string[]) {
  const { name } = parseArgs(args);
  console.log(`Hello, ${name ?? "world"}!`);
}
```

```bash
# Run it
pnpm script hello --name Steve
```

## parseArgs(args)

Parse CLI arguments in `--key value` or `--key=value` format:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## Shared Agent Chat

`@agent-native/core` provides an isomorphic chat bridge that works in both browser and Node.js:

```ts
import { agentChat } from "@agent-native/core";

// Auto-submit a message
agentChat.submit("Generate a report for Q4");

// Prefill without submitting
agentChat.prefill("Draft an email to...", contextData);

// Full control
agentChat.send({
  message: "Process this data",
  context: JSON.stringify(data),
  submit: true,
});
```

In the browser, messages are sent via `window.postMessage()`. In Node.js (scripts), they use the `BUILDER_PARENT_MESSAGE:` stdout format that the harness host translates to postMessage.

## Utility Functions

| Function                | Returns   | Description                                        |
| ----------------------- | --------- | -------------------------------------------------- |
| `loadEnv(path?)`        | `void`    | Load .env from project root (or custom path)       |
| `camelCaseArgs(args)`   | `Record`  | Convert kebab-case keys to camelCase               |
| `isValidPath(p)`        | `boolean` | Validate relative path (no traversal, no absolute) |
| `isValidProjectPath(p)` | `boolean` | Validate project slug (e.g. "my-project")          |
| `ensureDir(dir)`        | `void`    | mkdir -p helper                                    |
| `fail(message)`         | `never`   | Print error to stderr and exit(1)                  |

## File Sync

For apps that need bidirectional file sync across instances (e.g. multi-user collaboration or cloud backup), agent-native provides a `createFileSync()` factory and adapters for **Firestore**, **Supabase**, and **Convex**. File sync is **opt-in** — it's a no-op unless `FILE_SYNC_ENABLED=true` is set.

### Environment Variables

| Variable                         | Required      | Description                                          |
| -------------------------------- | ------------- | ---------------------------------------------------- |
| `FILE_SYNC_ENABLED`              | No            | Set to `"true"` to enable sync                       |
| `FILE_SYNC_BACKEND`              | When enabled  | `"firestore"`, `"supabase"`, or `"convex"`           |
| `SUPABASE_URL`                   | For Supabase  | Project URL                                          |
| `SUPABASE_PUBLISHABLE_KEY`       | For Supabase  | Publishable (anon) key                               |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore | Path to service account JSON                         |
| `CONVEX_URL`                     | For Convex    | Deployment URL from `npx convex dev` (must be HTTPS) |

### createFileSync() — the factory (recommended)

`createFileSync()` reads env vars and initializes the right adapter automatically. It's wired into every template via a server plugin (`server/plugins/file-sync.ts`).

```ts
// server/plugins/file-sync.ts
import { defineNitroPlugin } from "@agent-native/core";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { setSyncResult, sseExtraEmitters } from "../lib/watcher.js";

export default defineNitroPlugin(async () => {
  const syncResult = await createFileSync({ contentRoot: "./data" });

  if (syncResult.status === "error") {
    console.warn(`[app] File sync failed: ${syncResult.reason}`);
  }

  setSyncResult(syncResult);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (syncResult.status === "ready") await syncResult.shutdown();
    process.exit(0);
  });
});
```

The watcher and SSE emitters are shared via `server/lib/watcher.ts`, and the SSE endpoint is a file-based route at `server/routes/api/events.get.ts`. See [Server](./server.md) for the full pattern.

### sync-config.json

Each template (and the default app) ships a `sync-config.json` that controls which files are synced:

```json
{
  "appId": "my-app",
  "ownerId": "default",
  "include": ["**/*.json", "**/*.md"],
  "exclude": ["application-state/**"]
}
```

`application-state/` is always excluded — it holds ephemeral per-session state, not shared data.

### Google Cloud Firestore

```ts
import { FirestoreFileSyncAdapter } from "@agent-native/core/adapters/firestore";
```

Requires `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account JSON. `createFileSync()` initializes firebase-admin automatically.

### Supabase

```ts
import { SupabaseFileSyncAdapter } from "@agent-native/core/adapters/supabase";
```

Requires `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Create the required table:

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  app TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  last_updated BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT
);
CREATE INDEX idx_files_app_owner ON files(app, owner_id);
```

### Convex

```ts
import { ConvexFileSyncAdapter } from "@agent-native/core/adapters/convex";
```

Requires `CONVEX_URL`. Add the `files` table to your Convex schema and define a `by_sync_id` index:

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  files: defineTable({
    syncId: v.string(),
    path: v.string(),
    content: v.string(),
    app: v.string(),
    ownerId: v.string(),
    lastUpdated: v.number(),
  }).index("by_sync_id", ["syncId"]),
});
```

### Custom Adapters

Implement the `FileSyncAdapter` interface from `@agent-native/core/adapters/sync` to build your own backend:

```ts
import type { FileSyncAdapter } from "@agent-native/core/adapters/sync";
```

All adapters support: startup sync, remote change listeners, three-way merge with LCS-based conflict resolution, and `.conflict` sidecar files for unresolvable conflicts.

## Production Scripts (run() export)

Scripts used by the embedded production agent must export a `tool` definition and a `run()` function alongside the standard `main()` CLI entry:

```ts
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description: "Archive an email by ID",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Email ID to archive" },
    },
    required: ["id"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  // same logic as main(), but returns a string result
  const result = await archiveEmail(args.id);
  return `Archived email ${args.id}`;
}

// CLI entry point — unaffected
export default async function main(args: string[]) {
  const { id } = parseArgs(args);
  await archiveEmail(id);
}
```

Register all production scripts in a registry file:

```ts
// scripts/registry.ts
import type { ScriptEntry } from "@agent-native/core";
import * as archiveEmail from "./archive-email.js";

export const scripts: Record<string, ScriptEntry> = {
  "archive-email": { tool: archiveEmail.tool, run: archiveEmail.run },
};
```

Pass the registry to `createProductionAgentHandler()` in a server plugin. See [Server](./server.md) for the full wiring.
