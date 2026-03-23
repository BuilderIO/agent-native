---
name: sql-as-database
description: >-
  How to store and manage application data in SQL. Use when adding data models,
  deciding where to store data, using core stores (settings, application-state,
  oauth-tokens), or creating Drizzle schemas.
---

# SQL as Database

## Rule

All application state lives in SQL — the same SQLite database locally and in production (via Turso, Neon, Supabase, D1). No JSON files for data storage.

## Why

SQL is the shared interface between the AI agent and the UI. The agent reads and writes data via scripts and core store helpers. The UI reads data via API routes. SSE streams database changes to the UI in real-time. This works identically in local dev and cloud production — no filesystem dependency.

## Core SQL Stores

These tables are auto-created and available in all templates via `@agent-native/core`:

| Store | Import | Table | Use for |
|-------|--------|-------|---------|
| Application State | `@agent-native/core/application-state` | `application_state` | Ephemeral UI state (compose drafts, navigation, screen sync) |
| Settings | `@agent-native/core/settings` | `settings` | Persistent app config (user prefs, availability, theme) |
| OAuth Tokens | `@agent-native/core/oauth-tokens` | `oauth_tokens` | OAuth credentials (Google, etc.) |
| Sessions | (internal) | `sessions` | Auth sessions |

### Application State (ephemeral)

```ts
// From scripts
import { readAppState, writeAppState, deleteAppState, listAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "t-123" });
const nav = await readAppState("navigation");
const drafts = await listAppState("compose-");

// From server handlers
import { appStateGet, appStatePut, appStateDelete } from "@agent-native/core/application-state";
```

### Settings (persistent config)

```ts
// From scripts
import { readSetting, writeSetting } from "@agent-native/core/settings";

await writeSetting("mail-settings", { theme: "dark", density: "comfortable" });
const settings = await readSetting("mail-settings");

// From server handlers
import { getSetting, putSetting } from "@agent-native/core/settings";
```

### OAuth Tokens

```ts
import { saveOAuthTokens, getOAuthTokens, listOAuthAccounts } from "@agent-native/core/oauth-tokens";

await saveOAuthTokens("google", "user@gmail.com", { access_token: "...", refresh_token: "..." });
const tokens = await getOAuthTokens("google", "user@gmail.com");
const accounts = await listOAuthAccounts("google");
```

## Domain Data (Drizzle ORM)

For structured domain data (emails, forms, bookings, compositions), use Drizzle ORM tables in `server/db/schema.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const forms = sqliteTable("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  fields: text("fields").notNull(), // JSON
  status: text("status", { enum: ["draft", "published"] }).notNull(),
});
```

## Don't

- Don't store data as JSON files in `data/`
- Don't use `fs.readFileSync`/`fs.writeFileSync` for data (code modification is fine)
- Don't store app state in localStorage, sessionStorage, or cookies
- Don't keep state only in memory

## Environment Variables

Infrastructure config stays in `.env`:
- `DATABASE_URL` — database connection (defaults to `file:./data/app.db`)
- `DATABASE_AUTH_TOKEN` — for remote databases (Turso, etc.)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth app credentials
- `ACCESS_TOKEN` — production auth

Runtime data (user settings, OAuth tokens, app state) goes in SQL.
