---
title: "Database"
description: "Connect a portable SQL database to your agent-native app and write provider-agnostic Drizzle code."
---

# Database

Agent-native apps use [Drizzle ORM](https://orm.drizzle.team) and support portable SQL backends. For anything beyond local development, connect a persistent SQL database — Postgres, libSQL/Turso, or another Drizzle-compatible backend — by setting `DATABASE_URL`. When that variable is unset, the app falls back to a zero-config local SQLite file so you can start developing immediately.

## Local default: SQLite file {#default-sqlite}

When `DATABASE_URL` is not set, the app creates a SQLite database at `data/app.db`. This is the zero-config default for local development — no setup required. It is meant for development only; for production, set `DATABASE_URL` to a persistent SQL database.

Do not rely on that local file for deployed apps. Containers, serverless functions, and preview environments may reset their filesystem, which means a local SQLite file can disappear between restarts. Set `DATABASE_URL` to a persistent hosted database before production use.

## Connecting a Production Database {#production}

Set `DATABASE_URL` in your `.env` file or deploy-provider environment to connect a hosted database. Turso is not required; use whichever Drizzle-compatible SQL backend fits your deployment:

```bash
# Neon Postgres
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase Postgres
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Plain Postgres
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
DATABASE_AUTH_TOKEN=your-token
```

The framework auto-detects the dialect from the URL and configures Drizzle accordingly. The built-in adapters cover Postgres URLs, libSQL/Turso URLs, SQLite file URLs, and Cloudflare D1 bindings. Common production choices include Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, and Builder.io-managed environments when available.

## Builder.io Managed Database {#builder-managed}

When connected to Builder.io, your app can use a managed database that is provisioned and scaled automatically. This is the simplest path to production — no connection strings or database admin required. Coming soon.

## Dialect-Agnostic Schema And Queries {#schema}

App database code should use Drizzle's schema and query DSL so it can run across providers. Never write SQLite-only syntax (`INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`) or Postgres-only syntax in product code.

Use the framework's schema helpers from `@agent-native/core/db/schema`:

```ts
import { table, text, integer, real, now } from "@agent-native/core/db/schema";

export const tasks = table("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  priority: integer("priority").notNull().default(0),
  weight: real("weight"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});
```

| Helper    | Purpose                                                         |
| --------- | --------------------------------------------------------------- |
| `table`   | Define a table — delegates to `pgTable` or `sqliteTable`        |
| `text`    | Text column, supports `{ enum: [...] }`                         |
| `integer` | Integer column, `{ mode: "boolean" }` maps to Postgres boolean  |
| `real`    | Float column — `real` on SQLite, `double precision` on Postgres |
| `now`     | Dialect-agnostic current timestamp for `.default(now())`        |

Never import from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` directly. Always use `@agent-native/core/db/schema`.

For reads and writes, use Drizzle's query builder and portable operators from `drizzle-orm`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../server/db/index.js";
import { tasks } from "../server/db/schema.js";

const db = getDb();

const openTasks = await db
  .select()
  .from(tasks)
  .where(and(eq(tasks.ownerEmail, userEmail), eq(tasks.done, false)))
  .orderBy(desc(tasks.createdAt));

await db.update(tasks).set({ done: true }).where(eq(tasks.id, taskId));
```

## Raw SQL Escape Hatches {#raw-sql}

Raw SQL is not the default app-code API. Use it only for additive migrations, health checks, carefully reviewed advanced queries that Drizzle cannot express, or one-off maintenance. Keep it parameterized and dialect-agnostic. For timestamps in Drizzle schemas, prefer `.default(now())`; for migration SQL, use `runMigrations()` so framework-supported compatibility rewrites and dialect-gated statements stay centralized.

For cases where you truly need raw SQL outside of Drizzle queries:

- `getDbExec()` — auto-converts `?` params to `$1` for Postgres
- `isPostgres()` — runtime dialect check
- `intType()` — returns the correct integer type for the current dialect

## Migrations and Schema Updates {#migrations}

In hosted environments, multiple deployment previews, branches, and the production server share the same underlying database. Therefore, database schema updates must follow strict constraints to avoid data loss and service disruption.

### The "Zero Destructive Changes" Rule

All database schema updates must be **strictly additive**.

- **Do not drop tables or columns.**
- **Do not rename tables or columns.** Renaming a column or table looks like a drop + create sequence to Drizzle, which will permanently delete your existing production data.
- If a column needs to be renamed or replaced, add the new column alongside the old one, update your application code to read from/write to both, migrate the data, and only retire the old column in a later release once no active deployments are referencing it.

> [!WARNING]
> **Never run `drizzle-kit push` against a production database.**
> Template database schemas only define app-specific domain tables; they do not define central framework tables (`user`, `session`, `application_state`, etc.). If you run `drizzle-kit push` against production, Drizzle will detect these framework tables as "not in schema" and attempt to drop them, causing immediate system-wide failure and data loss.

### Safe Migration Path

Instead of pushing directly, schema changes should be applied via SQL migrations executed at application startup. Implement additive migrations within a server plugin (e.g., `server/plugins/db.ts`) by invoking the framework's `runMigrations()` helper:

```ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,
    },
  ],
  { table: "my_app_migrations" },
);
```

## Environment Variables {#environment-variables}

| Variable              | Purpose                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Persistent SQL connection string (unset = local SQLite, which is only durable for local development) |
| `DATABASE_AUTH_TOKEN` | Auth token for providers that require a separate token, such as Turso/libSQL                         |
