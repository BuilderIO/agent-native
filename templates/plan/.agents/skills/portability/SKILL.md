---
name: portability
description: >-
  How to keep template code PostgreSQL-specific and hosting-agnostic. Use when
  defining schemas, writing raw SQL, or creating server routes.
scope: dev
metadata:
  internal: true
---

# Portability

## Rule

Templates use one PostgreSQL schema and query contract. Local PGlite and hosted
PostgreSQL share the same SQL semantics.

## Database

Use Drizzle's PostgreSQL exports directly for schemas and its query builder for reads/writes:

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

export const meals = pgTable("meals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  calories: integer("calories").notNull(),
  weight: doublePrecision("weight"),
  archived: boolean("archived").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`now()`),
});
```

| Export            | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `pgTable`         | Defines a PostgreSQL table                   |
| `text`            | Defines a text column, with optional enum values |
| `integer`         | Defines an integer column                    |
| `boolean`         | Defines a boolean column                     |
| `doublePrecision` | Defines a double-precision column            |
| `sql`             | Builds SQL expressions such as `now()`       |

Use `@agent-native/core/db/schema` only for framework-owned sharing helpers such
as `ownableColumns()` and `createSharesTable()`.

Use Drizzle's PostgreSQL query builder for app code:

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

- `getDbExec()` — executes parameterized PostgreSQL SQL
- Use PostgreSQL types such as `BIGINT` directly in raw SQL.

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

This monorepo's own first-party deployed apps keep platform configuration in app-specific hosting manifests such as `templates/*/netlify.toml`; this rule only applies to the CLI scaffold source.

### No Node APIs in server routes/plugins

Never use `fs`, `child_process`, or `path` in server routes and plugins. Use Nitro abstractions. (Actions in `actions/` run in Node.js and can use Node APIs freely.)

### No persistent-process assumptions

Never assume a persistent server process. Use the SQL database for all state.

## Related Skills

- `storing-data` — Schema patterns and the core SQL stores
- `server-plugins` — Framework routes and H3 handler patterns
- `security` — SQL injection prevention via parameterized queries
