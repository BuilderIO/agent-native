---
name: storing-data
description: >-
  How to store application data in agent-native apps. All data lives in SQL.
  Use when adding data models, deciding where to store data, or reading/writing
  application data.
---

> **Also known as:** `storing-data`. The skill table in AGENTS.md references this skill as `storing-data`.

# Storing Data — SQL is the Source of Truth

## Rule

All application data lives in **SQL** (SQLite locally, cloud database in production). The agent and UI share the same database. There is no filesystem dependency for data.

## How It Works

Agent-native apps use SQLite via Drizzle ORM + `@libsql/client`. This works locally out of the box and upgrades seamlessly to cloud databases (Turso, Neon, Supabase, D1) by setting `DATABASE_URL`. **Local and production behave identically.**

### Core SQL Stores (auto-created, available in all templates)

| Store               | Purpose                                              | Access                                     |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `application_state` | Ephemeral UI state (compose windows, navigation)     | `readAppState()` / `writeAppState()`       |
| `settings`          | Persistent KV config (preferences, app settings)     | `getSetting()` / `setSetting()`            |
| `oauth_tokens`      | OAuth credentials                                    | `@agent-native/core/oauth-tokens`          |
| `sessions`          | Auth sessions                                        | `@agent-native/core/server`               |

### Domain Data (per-template)

Define schema with Drizzle ORM in `server/db/schema.ts`. Get a database instance with `const db = getDb()` from `server/db/index.ts`. All queries are async.

| Template     | Tables                                        |
| ------------ | --------------------------------------------- |
| **Mail**     | emails, labels (+ Gmail API when connected)   |
| **Calendar** | events, bookings                              |
| **Forms**    | forms, responses                              |
| **Content**  | documents                                     |
| **Slides**   | decks (JSON stored in SQL)                    |
| **Videos**   | compositions in registry + localStorage       |

### Agent Access

The agent uses scripts to read/write the database:

- `pnpm action db-schema` — Show all tables, columns, types
- `pnpm action db-query --sql "SELECT * FROM forms"` — Run SELECT queries
- `pnpm action db-exec --sql "INSERT INTO ..."` — Run INSERT/UPDATE/DELETE
- App-specific scripts for domain operations

### Cloud Deployment

Local SQLite works out of the box. To deploy to production with a cloud database:

1. Set `DATABASE_URL` (e.g. `libsql://your-db.turso.io`)
2. Set `DATABASE_AUTH_TOKEN` for auth
3. No code changes needed — `@libsql/client` handles both local and remote

### Real-time Sync

Polling streams database changes to the UI. When the agent writes to the database via scripts, the UI updates automatically via `useDbSync()` which invalidates React Query caches.

## Do

- Use Drizzle ORM for structured domain data (forms, bookings, documents)
- Use the `settings` store for app configuration and user preferences
- Use `application-state` for ephemeral UI state that the agent and UI share
- Use `oauth-tokens` for OAuth credentials
- Use core DB scripts (`db-schema`, `db-query`, `db-exec`) for ad-hoc database operations

## Don't

- Don't store structured app data as JSON files
- Don't store app state in localStorage, sessionStorage, or cookies (except for UI-only preferences like sidebar width)
- Don't keep state only in memory (server variables, global stores)
- Don't use Redis or any external state store for app data
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
- **scripts** — Create scripts that query the database
- **self-modifying-code** — The agent can also modify the app's source code
