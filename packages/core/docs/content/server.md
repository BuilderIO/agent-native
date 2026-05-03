---
title: "Server"
description: "Nitro server routes, plugins, framework-mounted routes, request context, and SQL-backed sync."
---

# Server

Agent-native apps use [Nitro](https://nitro.build) for server routes and plugins. Most product behavior should live in [Actions](/docs/actions); custom routes are for protocol surfaces that actions do not fit: uploads, streaming, public pages, webhooks, OAuth callbacks, and provider-specific APIs.

## File-Based Routes {#file-based-routes}

Routes live in `server/routes/` and Nitro maps filenames to methods and paths:

```text
server/routes/
  api/
    health.get.ts              -> GET  /api/health
    uploads.post.ts            -> POST /api/uploads
    webhooks/
      stripe.post.ts           -> POST /api/webhooks/stripe
  [...page].get.ts             -> SSR catch-all for public pages
```

Each route exports a `defineEventHandler`:

```ts
// server/routes/api/health.get.ts
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "my-template",
}));
```

### Route naming conventions {#route-naming-conventions}

| File name pattern  | HTTP method | Example path                |
| ------------------ | ----------- | --------------------------- |
| `index.get.ts`     | GET         | `/api/items`                |
| `index.post.ts`    | POST        | `/api/items`                |
| `[id].get.ts`      | GET         | `/api/items/:id`            |
| `[id].patch.ts`    | PATCH       | `/api/items/:id`            |
| `[id].delete.ts`   | DELETE      | `/api/items/:id`            |
| `[...slug].get.ts` | GET         | `/api/items/*` or catch-all |

## Prefer Actions For App Operations {#actions-first}

If the UI and agent both need to do something, define an action instead of a custom API route. Actions automatically become:

- Agent tools.
- Typed frontend hooks.
- HTTP endpoints under `/_agent-native/actions/:name`.
- MCP and A2A-callable tools.
- CLI commands for development.

Use custom `/api/*` routes only when you need a route-shaped protocol or binary/streaming behavior. See [Actions](/docs/actions).

## Request Context And Access {#request-context}

Actions mounted by the framework automatically run with request context. Custom routes do not. If a custom route reads or writes ownable resources, load the session and wrap the work:

```ts
import { defineEventHandler } from "h3";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { getDb } from "@agent-native/core/db";
import { accessFilter } from "@agent-native/core/access";
import * as schema from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.user?.email) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return runWithRequestContext(
    { userEmail: session.user.email, orgId: session.orgId },
    async () => {
      const db = getDb();
      return db
        .select()
        .from(schema.projects)
        .where(accessFilter(schema.projects, schema.projectShares));
    },
  );
});
```

Do not run unscoped `db.select().from(ownableTable)` in custom routes.

## Server Plugins {#server-plugins}

Plugins live in `server/plugins/` and run at startup. Use them for migrations, provider setup, recurring jobs, integration adapters, and framework plugin configuration.

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db/migrations";

export default runMigrations([
  {
    id: "001_create_projects",
    sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
]);
```

Migrations must be additive. Never put destructive SQL in startup plugins.

## Framework-Mounted Routes {#framework-routes}

The framework mounts its own routes under `/_agent-native/`. Treat that namespace as reserved.

| Route prefix                     | Purpose                              |
| -------------------------------- | ------------------------------------ |
| `/_agent-native/actions/:name`   | Action HTTP endpoints                |
| `/_agent-native/agent-chat`      | Agent chat loop                      |
| `/_agent-native/poll`            | SQL-backed UI sync                   |
| `/_agent-native/resources/*`     | Workspace resources                  |
| `/_agent-native/tools/*`         | Runtime tools and tool proxy         |
| `/_agent-native/integrations/*`  | Messaging/webhook integrations       |
| `/_agent-native/a2a`             | Agent-to-agent JSON-RPC              |
| `/_agent-native/mcp`             | MCP endpoint                         |
| `/_agent-native/onboarding/*`    | Setup checklist                      |
| `/_agent-native/observability/*` | Traces, feedback, evals, experiments |
| `/_agent-native/file-upload`     | File upload provider endpoint        |

Custom app routes should use `/api/*`, public app paths, or provider-specific callback paths that do not collide with `/_agent-native/`.

## SQL-Backed Sync {#sync}

Agent-native does not rely on filesystem watchers or sticky in-memory state. When actions or framework helpers mutate data, the database sync version increments. The client `useDbSync()` hook polls `/_agent-native/poll` and invalidates React Query caches.

This works across serverless and multi-instance deployments because the database is the coordination point. If you write custom mutations outside actions, use framework helpers or emit the appropriate sync invalidation so open UIs refresh.

## Webhooks {#webhooks}

Inbound webhooks should verify, persist, and return quickly. Long-running agent work should use the integration queue pattern:

1. Verify the platform signature or challenge.
2. Insert durable work into SQL.
3. Self-fire a signed processor route.
4. Return 200 immediately.
5. Let the fresh processor execution run the agent loop and post the result.

Do not rely on unawaited promises after returning a response. See [Messaging](/docs/messaging) for the canonical integration queue.

## Programmatic H3 Servers {#create-server}

For custom packages or tests that need an H3 app directly, `createServer()` returns a preconfigured app and router:

```ts
import { createServer } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

const { app, router } = createServer();

router.get(
  "/api/health",
  defineEventHandler(() => ({ ok: true })),
);
```

Most templates do not need this helper because Nitro file routes and framework plugins handle the app server.

## Production Agent Handler {#agent-handler}

The framework's agent chat plugin mounts the production agent handler for templates. Only call `createProductionAgentHandler()` directly when building a custom server integration outside the standard template plugin stack.

```ts
import { createProductionAgentHandler } from "@agent-native/core/server";

const handler = createProductionAgentHandler({
  scripts,
  systemPrompt: "You are the app agent...",
});
```

Standard templates should customize the agent through `AGENTS.md`, skills, actions, and the agent chat plugin rather than hand-mounting this route.
