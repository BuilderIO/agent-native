---
name: portability
description: >-
  How to keep template code database-agnostic and hosting-agnostic. Use when
  defining schemas, writing raw SQL, creating server routes, or anything that
  could leak a SQLite-only, Postgres-only, or Node-only assumption.
---

# Portability

## Rule

**Never write code that only works on one database or one hosting platform.** Templates must run on any SQL database (SQLite, Postgres, D1, Turso, Supabase, Neon) and any Nitro deploy target (Node, Cloudflare, Netlify, Vercel, Deno, Lambda, Bun) without code changes.

## Database Agnostic

Use the dialect-agnostic schema helpers from `@agent-native/core/db/schema`:

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

### Raw SQL helpers

- `getDbExec()` — auto-converts `?` params to `$1` for Postgres
- `isPostgres()` — runtime dialect check
- `intType()` — returns correct integer type for the dialect

### Never

Never write SQLite-only syntax: `INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`. When writing docs, say "SQL database" — not "SQLite".

## Hosting Agnostic

The server runs on **Nitro** with **H3** as the HTTP framework. Templates must be deployable to any Nitro-supported target.

### Never use Express

All server code uses H3/Nitro: `defineEventHandler`, `readBody`, `getMethod`, `setResponseHeader`, etc. Express is not a dependency. If you see Express types or patterns anywhere, replace them with H3 equivalents.

### No platform-specific config in templates

Files like `netlify.toml`, `wrangler.toml`, `vercel.json`, and `netlify/functions/` do not belong in template source. Platform configuration lives in CI/hosting dashboards or in deployment-specific repos.

### No Node APIs in server routes/plugins

Never use `fs`, `child_process`, or `path` in server routes and plugins. Use Nitro abstractions. (Actions in `actions/` run in Node.js and can use Node APIs freely.)

### No persistent-process assumptions

Never assume a persistent server process. Use the SQL database for all state.

## Related Skills

- `storing-data` — Schema patterns and the core SQL stores
- `server-plugins` — Framework routes and H3 handler patterns
- `security` — SQL injection prevention via parameterized queries
