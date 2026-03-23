---
name: files-as-database
description: >-
  How to store and manage application state in SQL via settings API and Drizzle ORM.
  Use when adding data models, deciding where to store data, or reading/writing
  application data.
---

# SQL-Backed Data

## Rule

All application state must be stored in the SQL database — either as Drizzle ORM tables for structured data, or via the settings API (`getSetting`/`putSetting`) for configuration. The database file lives at `data/app.db` (SQLite via @libsql/client).

## Why

SQL is the shared interface between the AI agent, the UI, and remote deployments. The agent reads and writes data via scripts and SQL helpers. The UI reads data via API routes. SSE streams DB change events to the UI in real-time. Using `DATABASE_URL`, the same database can be accessed locally or from a cloud provider (Turso, Neon, etc.) without any code changes.

## How

- **Structured data** (dashboards, configs): Define Drizzle ORM tables in `server/db/schema.ts`. Use `getDb()` for queries.
- **Settings/config** (app preferences, theme): Use `getSetting(key)` / `putSetting(key, value)` from `@agent-native/core/settings`.
- **Application state** (ephemeral UI state): Use `getAppState(key)` / `putAppState(key, value)` from `@agent-native/core/application-state`. Stored in the `application_state` SQL table.
- **OAuth tokens**: Use `@agent-native/core/oauth-tokens` for storing/retrieving OAuth credentials.
- **Sessions**: Stored in the `sessions` SQL table automatically by the auth system.
- API routes use `getDb()` or the settings/app-state helpers to read and return data.
- The agent uses scripts with SQL helpers (`readSetting()`, `writeSetting()`, `db-query`, `db-exec`) to read/write data.
- SSE streams DB change events to the client, which invalidates React Query caches.

## Don't

- Don't store app state as JSON files in `data/` (use the settings API or Drizzle tables instead)
- Don't store app state in localStorage, sessionStorage, or cookies
- Don't keep state only in memory (server variables, global stores)
- Don't use `fs.readFileSync`/`fs.writeFileSync` for application data
- Don't store OAuth tokens or sessions as JSON files

## Example

```ts
import { getSetting, putSetting } from "@agent-native/core/settings";

// Writing a setting (agent, script, or API route)
await putSetting("analytics-theme", {
  primaryColor: "#2563eb",
  darkMode: true,
});

// Reading a setting
const theme = await getSetting("analytics-theme");
```

```ts
import { getSetting, putSetting } from "@agent-native/core/settings";

// Dashboard configs use keyed settings
const dashboard = await getSetting("dashboard-weekly-signups");
await putSetting("dashboard-weekly-signups", { ...dashboard, title: "Updated Title" });

// Explorer configs
const config = await getSetting("config-revenue-explorer");
```

## Creating a New Data Model

When adding a new data entity:

1. **For structured/queryable data** (e.g., records, items):
   - Define the table in `server/db/schema.ts`
   - Add a migration or let auto-migration handle it
   - Use `getDb()` + Drizzle queries in API routes and scripts

2. **For configuration/settings** (e.g., dashboard configs, theme, preferences):
   - Use `getSetting(key)` / `putSetting(key, value)`
   - Define the type in `shared/` so both client and server can import it

3. **For ephemeral UI state** (e.g., active filters, selected dashboard):
   - Use `getAppState(key)` / `putAppState(key, value)` from `@agent-native/core/application-state`

4. **Wire SSE invalidation** — Add the query key to `useSSE()` so the UI refreshes on changes

## Judgment Criteria

| Question                             | Settings API              | Drizzle table                   |
| ------------------------------------ | ------------------------- | ------------------------------- |
| Is it a single config/preference?    | Yes — use settings        | No                              |
| Are items independently queryable?   | No                        | Yes — use a table               |
| Will there be >50 items?             | No — settings for singles | Yes — use a table               |
| Do items need filtering/sorting?     | No                        | Yes — SQL is ideal              |

## Security

- **Validate before writing** — Check data shape before writing, especially for user-submitted data.
- **Parameterize queries** — Always use Drizzle's query builder or parameterized SQL. Never interpolate user input into raw SQL strings.

## Related Skills

- **sse-db-watcher** — Set up real-time sync so the UI updates when data changes
- **scripts** — Create scripts that read/write data via SQL helpers
- **self-modifying-code** — The agent writes data as Tier 1 (auto-apply) modifications
