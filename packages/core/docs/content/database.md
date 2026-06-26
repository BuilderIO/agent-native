---
title: "Database"
description: "Connect a portable SQL database to your agent-native app and write provider-agnostic Drizzle code."
---

# Database

Agent-native apps use [Drizzle ORM](https://orm.drizzle.team) and support portable SQL backends. For anything beyond local development, connect a persistent SQL database — Postgres, libSQL/Turso, or another Drizzle-compatible backend — by setting `DATABASE_URL`. When that variable is unset, the app falls back to a zero-config local SQLite file so you can start developing immediately. For local development that should behave like Postgres without running a separate database server, opt into PGlite with `DATABASE_URL=pglite:./data/pglite`.

```an-diagram title="One schema, many backends" summary="App code uses the framework's dialect-agnostic helpers. The dialect is auto-detected from DATABASE_URL at runtime; unset means a local SQLite file."
{
  "html": "<div class=\"diagram-db\"><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">@agent-native/core/db/schema</span><small class=\"diagram-muted\">table · text · integer · real · now</small><small class=\"diagram-muted\">+ Drizzle query DSL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>DATABASE_URL<br><small class=\"diagram-muted\">dialect auto-detected</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Postgres<br><small class=\"diagram-muted\">Neon · Supabase</small></span><span class=\"diagram-pill\">libSQL / Turso</span><span class=\"diagram-pill\">Cloudflare D1</span><span class=\"diagram-pill warn\">SQLite file<br><small class=\"diagram-muted\">unset = local dev only</small></span><span class=\"diagram-pill warn\">PGlite<br><small class=\"diagram-muted\">local Postgres opt-in</small></span></div></div>",
  "css": ".diagram-db{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-db .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-db .diagram-arrow{font-size:22px;line-height:1}.diagram-db .diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}"
}
```

## Local default: SQLite file {#default-sqlite}

When `DATABASE_URL` is not set, the app creates a SQLite database at `data/app.db`. This is the zero-config default for local development — no setup required. It is meant for development only; for production, set `DATABASE_URL` to a persistent SQL database.

Do not rely on that local file for deployed apps. Containers, serverless functions, and preview environments may reset their filesystem, which means a local SQLite file can disappear between restarts. Set `DATABASE_URL` to a persistent hosted database before production use.

## Local Postgres Opt-In: PGlite {#local-pglite}

Install the optional PGlite package, then set `DATABASE_URL=pglite:./data/pglite` to run the app against [PGlite](https://pglite.dev/), a local WASM Postgres database:

```bash
pnpm add @electric-sql/pglite@^0.5.3
```

This keeps local development on the Postgres dialect, including Postgres schema helpers and migrations, without requiring Docker or a hosted database.

PGlite is still local development storage. Treat it like the SQLite fallback for durability and sharing: use it to test Postgres-shaped behavior on your machine, then set `DATABASE_URL` to a persistent hosted database for production, previews, or any shared environment.

## Connecting a Production Database {#production}

Set `DATABASE_URL` in your `.env` file or deploy-provider environment to connect a hosted database. Turso is not required; use whichever Drizzle-compatible SQL backend fits your deployment:

```bash
# Neon Postgres
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase Postgres
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Plain Postgres
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Local PGlite (Postgres dialect, local development only)
DATABASE_URL=pglite:./data/pglite

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
DATABASE_AUTH_TOKEN=your-token
```

The framework auto-detects the dialect from the URL and configures Drizzle accordingly. The built-in adapters cover Postgres URLs, local PGlite URLs, libSQL/Turso URLs, SQLite file URLs, and Cloudflare D1 bindings. Common production choices include Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, and Builder.io-managed environments when available.

## Builder.io Managed Database {#builder-managed}

_Planned (not yet available):_ when connected to Builder.io, your app will be able to use a managed database provisioned automatically, with no connection strings required.

## Where the DB Client Lives {#db-client}

Each template creates a lazy, singleton Drizzle client by calling `createGetDb(schema)` from `@agent-native/core/db`. The canonical location is `server/db/index.ts`:

```ts
// server/db/index.ts
import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
```

Import `getDb` from this template-local path — `../../server/db/index.js` in routes, `../server/db/index.js` in actions — rather than from `@agent-native/core` directly. The core export returns a generic untyped instance; the template's `getDb()` carries your schema types. See [Server](/docs/server#request-context) for how actions and custom routes each import it.

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

The `tasks` table above defines the same columns on every backend:

```an-schema title="The tasks table" summary="Defined once with the framework helpers; the dialect is chosen at runtime from DATABASE_URL."
{
  "entities": [
    {
      "id": "tasks",
      "name": "tasks",
      "note": "Domain table. Add owner_email (or ...ownableColumns()) so SQL-level scoping can filter rows to the authenticated user.",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "nullable": false },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "priority", "type": "integer", "nullable": false, "note": "default 0" },
        { "name": "weight", "type": "real", "nullable": true },
        { "name": "done", "type": "integer (boolean mode)", "nullable": false, "note": "default false; maps to a Postgres boolean" },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "enables data scoping" },
        { "name": "created_at", "type": "text", "nullable": false, "note": "default now()" }
      ]
    }
  ]
}
```

Never import from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` directly. Always use `@agent-native/core/db/schema`.

Tables that store user-facing data must include an `owner_email` column so the framework's SQL-level scoping can filter rows to the authenticated user — see [Security](/docs/security#data-scoping). Tables that also support sharing with other users or orgs should spread `...ownableColumns()` instead, which adds `owner_email`, `org_id`, and `visibility` in one call — see [Sharing](/docs/sharing#building).

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

```an-annotated-code title="An additive migration plugin"
{
  "filename": "server/plugins/db.ts",
  "language": "ts",
  "code": "import { runMigrations } from \"@agent-native/core/db\";\n\nexport default runMigrations(\n  [\n    {\n      version: 1,\n      sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,\n    },\n    {\n      // Dialect-gated: runs only on the matching backend. Omit the other key\n      // to make it a no-op on that dialect.\n      version: 2,\n      sql: {\n        postgres: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tsv tsvector`,\n        sqlite: `SELECT 1`, // no-op; tsvector is Postgres-only\n      },\n    },\n  ],\n  { table: \"my_app_migrations\" },\n);",
  "annotations": [
    { "lines": "6-7", "label": "Additive only", "note": "`ADD COLUMN IF NOT EXISTS` is safe to re-run and never drops data. Renames look like drop+create to Drizzle, so add-then-migrate instead." },
    { "lines": "13-16", "label": "Dialect gating", "note": "Pass an object keyed by dialect to run different SQL per backend. Make the other key a no-op (`SELECT 1`) for Postgres-only or SQLite-only features." },
    { "lines": "19", "label": "Per-app version table", "note": "Each app tracks its own applied versions so migrations are idempotent across restarts and instances." }
  ]
}
```

## Environment Variables {#environment-variables}

| Variable              | Purpose                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Persistent SQL connection string (unset = local SQLite; `pglite:./data/pglite` = local Postgres opt-in) |
| `DATABASE_AUTH_TOKEN` | Auth token for providers that require a separate token, such as Turso/libSQL                            |
