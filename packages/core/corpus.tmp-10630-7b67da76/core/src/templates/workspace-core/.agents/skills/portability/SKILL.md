---
name: portability
description: >-
  How to keep template code database-agnostic and hosting-agnostic. Use when
  defining schemas, writing raw SQL, creating server routes, or anything that
  could leak a SQLite-only, Postgres-only, or Node-only assumption.
scope: dev
metadata:
  internal: true
---

# Portability

## Rule

**Never write code that only works on one database or one hosting platform.** Templates must run on portable SQL backends (SQLite, Postgres, D1, Turso/libSQL, Supabase, Neon, managed platform SQL environments when available) and any Nitro deploy target (Node, Cloudflare, Netlify, Vercel, Deno, Lambda, Bun) without code changes.

## Database Agnostic

Use the dialect-agnostic schema helpers from `@agent-native/core/db/schema` for schemas and Drizzle's query builder for reads/writes:

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
| `table`   | Delegates to `pgTable` or `sqliteTable` based on dialect                                  |
| `text`    | Works in both dialects, supports `{ enum: [...] }`                                        |
| `integer` | `{ mode: "boolean" }` maps to Postgres `boolean` automatically                            |
| `real`    | `real` on SQLite, `double precision` on Postgres                                          |
| `now`     | Dialect-agnostic current timestamp — use with `.default(now())` on text timestamp columns |
| `sql`     | Re-exported from `drizzle-orm` for raw SQL expressions                                    |

**Never import from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` directly in template code.** Always use `@agent-native/core/db/schema` instead.

Use Drizzle's portable query DSL for app code:

```ts
import { and, desc, eq } from "drizzle-orm";

const rows = await db
  .select()
  .from(meals)
  .where(and(eq(meals.ownerEmail, userEmail), eq(meals.archived, false)))
  .orderBy(desc(meals.createdAt));
```

Avoid `db.execute(...)`, `getDbExec()`, and handwritten SQL in actions, handlers, and stores when Drizzle can express the query. Raw SQL should be limited to additive migrations, health checks, carefully reviewed advanced queries, or one-off maintenance scripts. For timestamps in Drizzle schemas, use `.default(now())`; for migration SQL, use `runMigrations()` so framework-supported compatibility rewrites and dialect-gated statements stay centralized.

### Raw SQL helpers

- `getDbExec()` — auto-converts `?` params to `$1` for Postgres
- `isPostgres()` — runtime dialect check
- `intType()` — returns correct integer type for the dialect

### Never

Never write SQLite-only syntax in product code or docs examples: `INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`. When writing docs, say "SQL database" — not "SQLite".

Never write Postgres-only syntax in shared app code either: `ILIKE`, `::type` casts, `jsonb_*`, `RETURNING` assumptions, serial/identity syntax, `ON CONFLICT` upserts, or `ALTER ... TYPE` unless the code is inside a dialect-gated migration block. Prefer Drizzle APIs or framework helpers.

When giving deployment guidance, be precise about durability: local SQLite is the development fallback, while production needs a persistent `DATABASE_URL`. Do not steer users to Turso as the only path; it is one option among Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and managed platform SQL environments when available.

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
