---
name: storing-data
description: >-
  How and where to store application data. Use when adding new data models,
  deciding between settings vs Drizzle tables, reading/writing app config,
  or working with application state.
---

# Storing Data

## Where Data Goes

All data lives in one SQLite database (`data/app.db`). In production, set `DATABASE_URL` to point to Turso, Neon, Supabase, or D1 — same code, no changes needed.

There are three storage layers, each for a different kind of data:

### 1. Settings — app configuration

Key-value store for persistent non-secret config that the user or agent can change. Theme, preferences, integration settings, availability schedules.

```ts
import { getSetting, putSetting } from "@agent-native/core/settings";

// Read (returns null if not set)
const prefs = await getSetting("user-preferences");

// Write (creates or replaces)
await putSetting("user-preferences", { theme: "dark", density: "comfortable" });
```

From scripts:
```ts
import { readSetting, writeSetting } from "@agent-native/core/settings";
const prefs = await readSetting("user-preferences");
```

SSE: writes automatically notify the UI via `{ source: "settings", type: "change", key }`.

### 2. Application State — ephemeral UI state

For state the agent and UI share in real-time: what the user is looking at, compose drafts, navigation commands. Scoped by session — cleared between sessions.

```ts
import { readAppState, writeAppState, deleteAppState, listAppState } from "@agent-native/core/application-state";

// Write state (UI updates instantly via SSE)
await writeAppState("navigate", { view: "inbox", threadId: "t-123" });

// Read state
const nav = await readAppState("navigation");

// List by prefix (e.g., all compose drafts)
const drafts = await listAppState("compose-");

// Delete (one-shot commands: UI reads, then agent or UI deletes)
await deleteAppState("navigate");
```

SSE: writes automatically notify the UI via `{ source: "app-state", type: "change", key }`.

### 3. Drizzle Tables — structured domain data

For data with schemas, relationships, and queries: forms, bookings, emails, compositions. Define tables in `server/db/schema.ts` using Drizzle ORM.

```ts
import { table, text, integer } from "@agent-native/core/db/schema";

export const bookings = table("bookings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  startTime: integer("start_time").notNull(),
  endTime: integer("end_time").notNull(),
});
```

Query via `getDb()` singleton from `server/db/index.ts`.

### 4. OAuth Tokens — credentials

For OAuth tokens acquired at runtime (Google, etc.). Never store these in settings — use the dedicated store.

```ts
import { saveOAuthTokens, getOAuthTokens, listOAuthAccounts } from "@agent-native/core/oauth-tokens";

await saveOAuthTokens("google", "user@gmail.com", { access_token: "...", refresh_token: "..." });
const tokens = await getOAuthTokens("google", "user@gmail.com");
const accounts = await listOAuthAccounts("google");
```

### 5. Secrets / Credentials — encrypted values

For API keys, service tokens, webhook secrets, and user/org/workspace
credentials. Register user-facing secrets with the secrets registry and read
them server-side with `readAppSecret`, or use `saveCredential` /
`resolveCredential` for scoped credential lookup. Never store these values in
settings, application state, source code, docs, examples, logs, or action
responses.

## Which Layer to Use

| Data | Layer | Why |
|------|-------|-----|
| User preferences, theme, config | Settings | Persistent KV, SSE notifications, simple read/write |
| What the user sees on screen | Application State | Ephemeral, real-time sync, agent ↔ UI bridge |
| Compose drafts, wizard steps | Application State | Temporary, deleted when done |
| Domain records (forms, bookings) | Drizzle table | Needs schema, queries, relationships |
| API keys, service tokens, webhook secrets | Secrets / credentials | Encrypted and scoped; never client-readable |
| OAuth refresh tokens | OAuth Tokens | Secure, per-provider, per-account |

## Environment Variables

Infrastructure config stays in `.env` — these differ per deployment:

- `DATABASE_URL` — database connection (default: `file:./data/app.db`)
- `DATABASE_AUTH_TOKEN` — for remote databases
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth app credentials
- `ACCESS_TOKEN` — production auth token

Everything else (user settings, app state, domain data) goes in SQL through the
appropriate store. User/org/workspace credential values go in the encrypted
secrets/credential stores, not plain settings rows.

## Security Rules

- **Never store API keys or secrets in Settings or Application State** — use the secrets registry / vault or `saveCredential` / `resolveCredential` for API keys and service tokens, deploy env vars only for deploy-level secrets, and `oauth_tokens` for OAuth credentials. Settings and application state are readable by the client.
- **Every Drizzle table with user data must have `owner_email`** — the framework auto-scopes queries in production so users only see their own data. Run `pnpm action db-check-scoping` to verify. See the `security` skill for the full model.
- **Never return secrets in action responses** — action responses may be visible in the agent chat or sent to the client. Keep credentials server-side only.
