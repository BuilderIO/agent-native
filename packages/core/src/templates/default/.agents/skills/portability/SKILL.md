---
name: portability
description: >-
  How to keep template code Postgres-compatible and hosting-agnostic. Use when
  defining schemas, writing raw SQL, or creating server routes.
scope: dev
metadata:
  internal: true
---

# Portability

## Rule

Templates use local PGlite and hosted Postgres. Keep database access behind the framework helpers and compatible with both environments.

## Database

Use the Postgres schema helpers from `@agent-native/core/db/schema` for schemas and Drizzle's query builder for reads/writes:

```ts
import {
  table,
  text,
  integer,
  real,
  now,
  sql,
} from "@agent-native/core/db/schema";

export const meals = table("meals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  calories: integer("calories").notNull(),
  weight: real("weight"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
});
```

| Helper    | Purpose                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `table`   | Defines a Postgres table                                       |
| `text`    | Defines a text column, with optional enum values              |
| `integer` | Defines an integer column; `{ mode: "boolean" }` uses BOOLEAN |
| `real`    | Defines a double-precision column                              |
| `now`     | Returns the current timestamp for `.default(now())`           |
| `sql`     | Re-exported from `drizzle-orm` for SQL expressions             |

Always use `@agent-native/core/db/schema` in template code so all schemas share
the framework's Postgres definitions.

Use Drizzle's portable query DSL for app code:

```ts
import { and, desc, eq } from "drizzle-orm";

const rows = await db
  .select()
  .from(meals)
  .where(and(eq(meals.ownerEmail, userEmail), eq(meals.archived, false)))
  .orderBy(desc(meals.createdAt));
```

Avoid `db.execute(...)`, `getDbExec()`, and handwritten SQL in actions, handlers, and stores when Drizzle can express the query. Raw SQL should be limited to additive migrations, health checks, carefully reviewed advanced queries, or one-off maintenance scripts. For timestamps in Drizzle schemas, use `.default(now())`; for migration SQL, use `runMigrations()`.

### Raw SQL helpers

- `getDbExec()` — executes parameterized Postgres SQL
- `intType()` — returns `BIGINT` for millisecond timestamps and counters

### Never

When writing docs, say "PostgreSQL" or "PGlite" precisely.

Use Postgres syntax deliberately in advanced queries and migrations, and prefer
Drizzle APIs or framework helpers for ordinary application code.

When giving deployment guidance, be precise about durability: local PGlite is for development, while shared and production environments need a persistent hosted PostgreSQL `DATABASE_URL`.

## Hosting Agnostic

The server runs on **Nitro** with **H3** as the HTTP framework. Templates must be deployable to any Nitro-supported target.

### Never use Express

All server code uses H3/Nitro: `defineEventHandler`, `readBody`, `getMethod`, `setResponseHeader`, etc. Express is not a dependency. If you see Express types or patterns anywhere, replace them with H3 equivalents.

### No platform-specific config in scaffolded template source

Files like `netlify.toml`, `wrangler.toml`, `vercel.json`, and `netlify/functions/` must NOT appear in the CLI scaffold source (`packages/core/src/templates/`) — apps generated for users stay hosting-agnostic, with platform configuration living in CI/hosting dashboards.

**Exception:** this monorepo's own first-party deployed apps (`templates/*/netlify.toml`, the root `wrangler-*.toml` files) are deployment artifacts of _this_ repo (mail.agent-native.com, etc.) and are expected to exist. Do not delete them as if they were accidental cruft — the rule above is about what gets scaffolded into a new app, not about this repo's deploy configs.

### No Node APIs in server routes/plugins

Never use `fs`, `child_process`, or `path` in server routes and plugins. Use Nitro abstractions. (Actions in `actions/` run in Node.js and can use Node APIs freely.)

### No persistent-process assumptions

Never assume a persistent server process. Use the SQL database for all state.

## Related Skills

- `storing-data` — Schema patterns and the core SQL stores
- `server-plugins` — Framework routes and H3 handler patterns
- `security` — SQL injection prevention via parameterized queries
