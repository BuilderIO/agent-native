---
title: "Database"
description: "Connect any SQL database to your agent-native app — SQLite for local dev, Postgres for production."
---

# Database

Agent-native apps use [Drizzle ORM](https://orm.drizzle.team) and support any SQL database. By default, apps use SQLite with a local file — set `DATABASE_URL` to connect a production database.

## Default: SQLite {#default-sqlite}

When `DATABASE_URL` is not set, the app creates a SQLite database at `data/app.db`. This is great for local development — no setup required.

## Connecting a Production Database {#production}

Set `DATABASE_URL` in your `.env` file to connect a hosted database:

```bash
# Neon Postgres
DATABASE_URL=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb?sslmode=require

# Supabase Postgres
DATABASE_URL=postgres://postgres.xxxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Plain Postgres
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# Turso (libSQL)
DATABASE_URL=libsql://my-db-org.turso.io
TURSO_AUTH_TOKEN=your-token
```

The framework auto-detects the dialect from the URL and configures Drizzle accordingly.

## Builder.io Managed Database {#builder-managed}

When connected to Builder.io, your app can use a managed database that is provisioned and scaled automatically. This is the simplest path to production — no connection strings or database admin required. Coming soon.

## Dialect-Agnostic Schema {#schema}

All SQL must work on both SQLite and Postgres. Never use SQLite-only syntax (`INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`) or Postgres-only syntax.

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

## Raw SQL Helpers {#raw-sql}

For cases where you need raw SQL outside of Drizzle queries:

- `getDbExec()` — auto-converts `?` params to `$1` for Postgres
- `isPostgres()` — runtime dialect check
- `intType()` — returns the correct integer type for the current dialect

## Environment Variables {#environment-variables}

| Variable           | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `DATABASE_URL`     | Database connection string (unset = local SQLite) |
| `TURSO_AUTH_TOKEN` | Auth token for Turso (libSQL) databases           |
