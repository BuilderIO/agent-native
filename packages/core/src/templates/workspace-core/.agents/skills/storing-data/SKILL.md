---
name: storing-data
description: >-
  How to store application data in agent-native apps. All data lives in SQL.
  Use when adding data models, deciding where to store data, or reading/writing
  application data.
scope: dev
metadata:
  internal: true
---

# Storing Data — SQL is the Source of Truth

## Rule

All application data lives in **SQL** (SQLite locally, persistent database in production). The agent and UI share the same database. SQL stores structured records, metadata, references, and searchable text — not large raw file payloads. Do not store durable app data in the filesystem unless the app is explicitly running a Local File Mode artifact flow described below.

Large binary or file-like payloads (images, video/audio, PDFs, ZIPs, screenshots, session replay chunks, thumbnails, generated assets, `data:` URLs, and base64 file bodies) must go through configured file/blob storage such as `uploadFile()` or `putPrivateBlob()`. Persist only the returned URL, asset id, or opaque blob handle in SQL. If storage is unavailable in hosted or persistent-database mode, fail closed with setup guidance instead of falling back to base64 in `application_state`, `settings`, `resources`, or app tables. Local SQLite-only dev fallbacks may exist for tiny assets, but they must be capped, documented as dev-only, and kept off hot list/read paths.

**Local File Mode exception:** some artifact apps (Content, Plans, Slides, Dashboards, Designs, etc.) can intentionally use repo files as the source of truth for the artifact itself. This must be explicit via `agent-native.json`, `AGENT_NATIVE_MODE=local-files`, or an app-owned local-file action helper. In that mode, the UI and agent still go through app actions, but those actions read/write scoped files through `@agent-native/core/local-artifacts` instead of SQL rows. App state, auth, settings, credentials, collaboration metadata, and hosted database mode remain SQL. File-to-database or file-to-provider synchronization is an explicit sync step, not an implicit side effect of editing.

When you add a data model, a list, or a read path, also follow the `performance` skill: project only the columns a list renders, index the columns hot queries filter/sort on, and avoid query waterfalls — so apps stay fast as data grows.

## How It Works

Agent-native apps use Drizzle ORM over the configured SQL backend. Local development works out of the box with a SQLite file at `data/app.db`; production and shared preview deploys need a persistent `DATABASE_URL` because container/serverless filesystems can reset. The code should behave the same across backends, but the local SQLite file is not durable once deployed.

For app code, use Drizzle's schema/query DSL by default. Raw SQL is an escape hatch for additive migrations, health checks, or one-off maintenance, not the normal way to build features.

### Naming migrations

When you add an entry to a `runMigrations([...])` list (`@agent-native/core/db`), always give it a unique `name:` slug (e.g. `name: "analytics-alert-rules-table"`) alongside its `version`. Never renumber or reuse version numbers on existing entries.

Why: version numbers alone are not a safe identity. Two branches that each independently extend the same migration list can ship different DDL under the same version numbers — whichever branch deploys first "claims" those version numbers in the bookkeeping table, and the other branch's DDL is silently treated as already applied even though it never ran. This exact collision took down analytics: parallel branches both extended their migration list through v75-v83 with different DDL, so `analytics_alert_rules`, `analytics_alert_incidents`, and `session_recordings.network_error_count` never made it to production despite the bookkeeping table showing every version as applied. A `name:` slug is tracked independently of version numbers, so it applies exactly once per database regardless of what any other branch already recorded.

Existing unnamed migrations don't need to be renamed retroactively (the two gating strategies coexist), but any new entry should always carry a name.

### Core SQL Stores (auto-created, available in all templates)

| Store               | Purpose                                              | Access                                     |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `application_state` | Ephemeral UI state (compose windows, navigation)     | `readAppState()` / `writeAppState()`       |
| `settings`          | Persistent KV config (preferences, app settings)     | `getSetting()` / `putSetting()`            |
| `oauth_tokens`      | OAuth credentials                                    | `@agent-native/core/oauth-tokens`          |
| `sessions`          | Auth sessions                                        | `@agent-native/core/server`               |

### Domain Data (per-template)

Define schema with the framework Drizzle helpers in `server/db/schema.ts`. Get a database instance with `const db = getDb()` from `server/db/index.ts`. All queries are async.

```ts
import { eq } from "drizzle-orm";
import { table, text, integer, now } from "@agent-native/core/db/schema";

export const tasks = table("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  completed: integer("completed", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default(now()),
});

const rows = await db.select().from(tasks).where(eq(tasks.id, taskId));
```

Never import `sqliteTable` / `pgTable` or column helpers from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` in app templates. Use `@agent-native/core/db/schema` so the same schema can run against SQLite, Postgres, libSQL/Turso, D1, and other supported backends.

| Template     | Tables                                        |
| ------------ | --------------------------------------------- |
| **Mail**     | emails, labels (+ Gmail API when connected)   |
| **Calendar** | events, bookings                              |
| **Forms**    | forms, responses                              |
| **Content**  | documents                                     |
| **Slides**   | decks (JSON stored in SQL)                    |
| **Videos**   | compositions in registry + localStorage       |

### Agent Access

The agent uses app-specific actions to read/write the database. Core DB scripts are for inspection and maintenance, not for implementing normal product behavior:

- `pnpm action db-schema` — Show all tables, columns, types
- `pnpm action db-query --sql "SELECT * FROM forms"` — Run SELECT queries
- `pnpm action db-exec --sql "UPDATE ..."` — Last-resort ad-hoc maintenance for short columns, multi-column writes, or computed updates when no domain action exists. For several related writes, prefer `--statements '[{"sql":"...","args":[...]}]'` so they run sequentially in one transaction. Schema changes are blocked; use reviewed additive migrations/startup code instead.
- `pnpm action db-patch --table <t> --column <c> --where "<clause>" --find "<old>" --replace "<new>"` — **Surgical search/replace on a large text column.** Sends the diff instead of re-transmitting the whole value, so it's dramatically more token-efficient than `db-exec UPDATE` when editing multi-kilobyte documents, slide HTML, dashboard/form JSON, etc. Targets exactly one row per call — narrow `--where` by primary key. Supports `--edits '[{find,replace},...]'` for batch edits and `--all` to replace every occurrence.
- App-specific actions for domain operations — **always prefer these over raw SQL when one exists.** They encode business rules, power the client action hooks, and for editor-backed tables (documents, slides) also push live Yjs updates to open collaborative editors. `db-patch` is the generic fallback for tables without a dedicated edit action.

**For one-off maintenance, how to choose between `db-exec UPDATE` and `db-patch`:**

| Scenario                                                       | Use          |
| -------------------------------------------------------------- | ------------ |
| `SET status = 'published'` on one row                          | `db-exec`    |
| `SET calories = calories + 50`                                 | `db-exec`    |
| Updating several columns at once                               | `db-exec`    |
| Inserting/updating several rows as one logical operation        | `db-exec --statements` |
| Fixing a typo in a 50KB markdown document's `content` column   | `db-patch`   |
| Changing a single key in a dashboard's JSON blob               | `db-patch`   |
| Tweaking one paragraph of slide HTML stored in `decks.data`    | `db-patch`   |
| Any edit where you'd otherwise re-send thousands of characters | `db-patch`   |

All of these honor the per-user / per-org data scoping — you can't read or write rows outside the current user's data, regardless of which tool you choose.

### Frontend Access

The frontend calls actions using React Query hooks from the client API. The framework owns the HTTP transport behind these hooks, so components should not call action routes with raw `fetch`.

```ts
import { useActionQuery, useActionMutation } from "@agent-native/core/client";

// Read data
const { data } = useActionQuery("list-meals", { date: "2025-01-01" });

// Write data
const { mutate } = useActionMutation("log-meal");
```

Actions are the **preferred way** for the frontend to access data. You rarely need custom `/api/` routes — only for file uploads, streaming, webhooks, or OAuth callbacks.

### Production / Cloud Deployment

Local SQLite works out of the box for development. To deploy to production or any environment where data must survive restarts:

1. Set `DATABASE_URL` to a persistent SQL database.
2. Set `DATABASE_AUTH_TOKEN` only when the provider requires a separate token, such as Turso/libSQL.
3. No code changes should be needed when the schema and queries stay portable.

Turso is one valid option, not the required option. Common choices include Neon or Supabase Postgres, Turso/libSQL, plain Postgres, durable SQLite, Cloudflare D1 bindings, and managed platform SQL environments when available.

### Real-time Sync

Polling streams database changes to the UI. When the agent writes to the database via scripts, the UI updates automatically via `useDbSync()` which invalidates React Query caches.

## Do

- Use Drizzle ORM for structured domain data (forms, bookings, documents)
- Use Drizzle query builder methods (`select`, `insert`, `update`, `delete`) and portable operators from `drizzle-orm` (`eq`, `and`, `or`, `inArray`, `desc`, etc.) for app reads/writes
- Use framework schema helpers from `@agent-native/core/db/schema`, not dialect-specific Drizzle imports
- Use the `settings` store for app configuration and user preferences
- Use `application-state` for ephemeral UI state that the agent and UI share
- Use `oauth-tokens` for OAuth credentials
- Use `uploadFile()` or `putPrivateBlob()` for large files/blob data and store only URLs, ids, or handles in SQL
- Use core DB scripts (`db-schema`, `db-query`, `db-exec`, `db-patch`) for ad-hoc database operations
- Use `db-exec --statements` instead of several separate `db-exec` calls for related writes; it is faster and rolls back the whole batch if one statement fails
- Reach for `db-patch` instead of `db-exec UPDATE` whenever you're making a small change to a large text/JSON column — it's much cheaper on tokens

## Don't

- Don't store structured app data as JSON files
- Don't store app state in localStorage, sessionStorage, or cookies (except for UI-only preferences like sidebar width)
- Don't keep state only in memory (server variables, global stores)
- Don't use Redis or any external state store for app data
- Don't store large files, base64 blobs, `data:` URLs, screenshots, videos, audio, PDFs, ZIPs, or session replay chunks directly in SQL rows, `application_state`, `settings`, or `resources`
- Don't implement product features with raw SQL or `getDbExec()` when Drizzle can express the query
- Don't write SQLite-only or Postgres-only SQL in app code
- Don't interpolate user input directly into SQL queries — use Drizzle ORM's query builder

## Security

- **SQL injection** — Use Drizzle ORM's query builder, never raw string interpolation for SQL queries
- **Validate before writing** — Check data shape before writing, especially for user-submitted data

## Application State and Context Awareness

When storing app-state, include **navigation state** — the agent needs to know what the user is looking at. The `application_state` table holds ephemeral UI state that both the agent and UI share. Key patterns:

- **`navigation` key** — the UI writes current view and selection on every route change. The agent reads this before acting.
- **`navigate` key** — the agent writes one-shot commands to navigate the UI. The UI processes and deletes them.
- **Domain-specific keys** (e.g., `compose-{id}`) — bidirectional state for features like email drafts.

When adding a new data model or feature, also consider what navigation and selection state needs to be exposed via application-state. See the **context-awareness** skill for the full pattern.

## Related Skills

- **context-awareness** — How to expose navigation and selection state via application-state
- **real-time-sync** — Set up polling so the UI updates when the database changes
- **actions** — Create actions with `defineAction` to query the database
- **client-methods** — Keep route details behind named client helpers/hooks
- **self-modifying-code** — The agent can also modify the app's source code
