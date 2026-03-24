---
title: "feat: SQLite-first data layer with cloud upgrade path"
type: feat
status: done
date: 2026-03-22
---

# SQLite-First Data Layer with Cloud Upgrade Path

## Overview

Rethink how templates store data. The current approach is inconsistent — some use SQLite (forms, calendar bookings), some use JSON files (slides, content, calendar events), and calendar syncs Google events to local files unnecessarily.

**New philosophy:**

- **SQLite via Drizzle** is the default data layer for app data (not files)
- **Local SQLite works out of the box** — no setup required for development
- **Cloud upgrade path** when you need public/shared access (deploy app + swap to cloud DB)
- **`application-state/`** stays as files — that pattern works well for ephemeral UI state
- **External APIs** (Google Calendar, Gmail) should be accessed directly via scripts, not synced to local files
- **Multiple cloud providers** — not locked to one (D1, Supabase, Neon, Turso, etc.)

## Per-Template Changes

| Template      | Current                                                        | New                                                                                                  |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Forms**     | SQLite (better-sqlite3)                                        | SQLite (@libsql/client) + cloud upgrade for sharing                                                  |
| **Calendar**  | SQLite for bookings + JSON files for events synced from Google | SQLite for bookings only. Events read directly from Google API via scripts. Stop syncing to files.   |
| **Content**   | Markdown/JSON files                                            | Keep files as default, but add cloud DB upgrade path for sharing pages + manual sync trigger anytime |
| **Slides**    | JSON files in data/decks/                                      | SQLite (local default, cloud optional)                                                               |
| **Videos**    | Files + localStorage                                           | SQLite (local default, cloud optional)                                                               |
| **Analytics** | JSON files for configs/dashboards                              | Keep as-is — configs are small, file-based works fine                                                |

### What stays as files

- `application-state/` — ephemeral UI state, agent-triggered state
- `data/settings.json` — app configuration
- Content template data — markdown files are the right format
- Analytics configs/dashboards — small, simple JSON files
- Auth tokens, sync configs — infrastructure files

### What moves to SQLite

- Forms + responses (already SQLite, just swap driver)
- Calendar bookings + booking links (already SQLite, just swap driver)
- Slide decks (currently JSON files → move to SQLite)
- Video compositions (currently files/localStorage → move to SQLite)

### What stops being synced to files

- Calendar events — stop syncing from Google to `data/events/`. Instead, agent uses scripts to query Google Calendar API directly. The UI reads events from Google API via server routes.

## Technical Approach

### Phase 1: Swap better-sqlite3 to @libsql/client (forms + calendar)

Both templates already use SQLite. Swap the driver so the same code works locally AND with cloud providers.

**Why @libsql/client instead of better-sqlite3:**

- Works with local `file:` URLs (identical to better-sqlite3 for local dev)
- Works with remote `libsql://` URLs (Turso)
- Works with other providers via their SQLite-compatible endpoints
- Same Drizzle schema, same SQL — just async instead of sync

#### `server/db/index.ts` (forms + calendar)

```typescript
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _db: LibSQLDatabase<typeof schema> | undefined;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL || "file:./data/app.db";
    _db = drizzle({
      connection: {
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      },
      schema,
    });
  }
  return _db;
}

export { schema };
```

Note: generic env var names `DATABASE_URL` and `DATABASE_AUTH_TOKEN` — not Turso-specific. Works with any provider.

#### `server/plugins/db.ts` (new, forms + calendar)

Schema init in a Nitro plugin with versioned migrations:

```typescript
import { defineNitroPlugin } from "@agent-native/core";
import { createClient } from "@libsql/client";

const MIGRATIONS = [
  { version: 1, sql: `CREATE TABLE IF NOT EXISTS forms (...)` },
  { version: 1, sql: `CREATE TABLE IF NOT EXISTS responses (...)` },
];

export default defineNitroPlugin(async () => {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  // Run versioned migrations
  await client.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`,
  );
  const { rows } = await client.execute(
    `SELECT MAX(version) as v FROM _migrations`,
  );
  const current = (rows[0]?.v as number) ?? 0;

  for (const m of MIGRATIONS.filter((m) => m.version > current)) {
    await client.batch([
      { sql: m.sql, args: [] },
      {
        sql: `INSERT OR IGNORE INTO _migrations VALUES (?)`,
        args: [m.version],
      },
    ]);
  }
});
```

#### All handlers and scripts — add `await`

Every Drizzle call becomes async. Change `db.select()...` to `await getDb().select()...` across:

- `templates/forms/server/handlers/forms.ts`
- `templates/forms/server/handlers/submissions.ts`
- `templates/forms/scripts/*.ts`
- `templates/calendar/server/handlers/bookings.ts`
- `templates/calendar/scripts/*.ts` (booking-related only)

#### `package.json` (forms + calendar)

```diff
- "better-sqlite3": "^11.9.1",
- "@types/better-sqlite3": "^7.6.14",
+ "@libsql/client": "^0.15.0",
```

#### `drizzle.config.ts` (forms + calendar)

```typescript
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL || "file:./data/app.db";
const isRemote = !url.startsWith("file:");

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: isRemote ? "turso" : "sqlite",
  dbCredentials: isRemote
    ? { url, authToken: process.env.DATABASE_AUTH_TOKEN! }
    : { url: "./data/app.db" },
});
```

### Phase 2: Calendar — stop syncing events to files

Currently `scripts/sync-google-calendar.ts` pulls events from Google and writes them as JSON files in `data/events/`. The UI reads these files via API routes. This is unnecessary — Google Calendar IS the database for events.

#### What to change:

- **Delete** `data/events/` pattern — no more syncing events to files
- **Keep** Google Calendar API client (`server/lib/google-calendar.ts`)
- **Update** event-reading server routes to query Google Calendar API directly (they already have the auth tokens)
- **Update** event scripts to query Google API, not read local files
- **Keep** SQLite for bookings and booking_links — these are app-owned data, not Google data

#### Calendar event scripts (updated):

| Script                 | Before                                        | After                                   |
| ---------------------- | --------------------------------------------- | --------------------------------------- |
| `sync-google-calendar` | Pull events → write JSON files                | Delete (no longer needed)               |
| `list-events`          | Read JSON files from data/events/             | Query Google Calendar API directly      |
| `create-event`         | Write JSON file + optionally create on Google | Create on Google Calendar directly      |
| `check-availability`   | Read JSON files, check slots                  | Query Google Calendar API for free/busy |

### Phase 3: Cloud upgrade flow (forms + calendar)

When a user tries to share a form link or create a public booking page, they need:

1. Deploy the app somewhere (Fly.io, Railway, Vercel, etc.)
2. Upgrade SQLite to a cloud database

#### `app/components/CloudUpgrade.tsx` (new, both templates)

Shown when user clicks "Publish" / "Share" / "Create booking link" and the app is running locally:

```
┌─────────────────────────────────────────┐
│  Share Your Forms Publicly              │
│                                         │
│  To make forms accessible to others,    │
│  you need to:                           │
│                                         │
│  1. Deploy your app                     │
│     Fly.io, Railway, Vercel, etc.       │
│                                         │
│  2. Connect a cloud database            │
│     Set DATABASE_URL in your deploy     │
│     environment to one of:              │
│                                         │
│     • Turso (libsql://...)              │
│     • Neon (postgres://...)             │
│     • Supabase (postgres://...)         │
│     • Cloudflare D1                     │
│                                         │
│  [Learn More →]                         │
│                                         │
│  ────────────────────────────────────── │
│                                         │
│  Already deployed? Enter your DB URL:   │
│  ┌───────────────────────────────────┐  │
│  │ DATABASE_URL                      │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │ DATABASE_AUTH_TOKEN (if needed)   │  │
│  └───────────────────────────────────┘  │
│  [Test & Connect]                       │
└─────────────────────────────────────────┘
```

This is NOT shown on app boot. The app works perfectly with local SQLite for development. It only appears when the user tries to do something that requires public access.

**Content template variant:** Content keeps files as default, but the cloud upgrade flow appears when:

- User tries to share/publish a page
- User manually triggers "Sync to cloud" from settings or a menu option
  When triggered, content is synced from local files into the cloud DB, and the shared link serves from the DB.

#### Detection: local vs deployed

```typescript
// Simple check — if DATABASE_URL is a file:// or not set, we're local
export function isLocalDb(): boolean {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  return url.startsWith("file:");
}
```

#### `server/routes/api/db-health.get.ts`

```typescript
export default defineEventHandler(async () => {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return { ok: true, local: isLocalDb() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
```

### Phase 4: Core DB scripts update

Update `packages/core/src/scripts/db/` to use `@libsql/client`:

- `query.ts` — replace `better-sqlite3` with `@libsql/client`
- `exec.ts` — replace `stmt.reader` with try/catch pattern
- `schema.ts` — replace `.pragma()` with `client.execute("PRAGMA ...")`
- Read `DATABASE_URL` from env, fall back to `file:./data/app.db` for `--db` flag

Keep `better-sqlite3` in the Drizzle file-sync adapter — it's infrastructure, not app data.

### Phase 5: Security hardening

1. **Sanitize env var values** in `upsertEnvFile` — reject newlines/CR/null bytes
2. **Whitelist submission fields** — only accept keys matching form field IDs
3. **Enforce input size limits** — max string length per field type, H3 body size limit
4. **Stored XSS prevention** — ensure responses viewer renders as text, not HTML

### Phase 6: Performance

1. **Cache public form definitions** — in-memory Map with 60s TTL for `getPublicForm`
2. **Submission notifications** — after public form submission, write to `application-state/new-submission.json` so SSE notifies admin UI
3. **Calendar available slots** — query Google Calendar free/busy API directly instead of scanning local event files

### Phase 7: Agent scripts

| Script       | Template        | Purpose                                         |
| ------------ | --------------- | ----------------------------------------------- |
| `db-status`  | forms, calendar | Check DB connection (local vs cloud, reachable) |
| `db-connect` | forms, calendar | Write DATABASE_URL + token to `.env`            |

### Phase 8: Env + config updates

- Update `.env.example` for forms + calendar with `DATABASE_URL` and `DATABASE_AUTH_TOKEN`
- Update calendar `.gitignore` (remove `data/events/` since we're not syncing anymore)
- Remove `data/app.db*` from forms `.gitignore` since local SQLite files should still be gitignored

## Acceptance Criteria

- [x] Forms: `better-sqlite3` → `@libsql/client`, all queries async
- [x] Calendar: `better-sqlite3` → `@libsql/client`, all queries async
- [x] Calendar: events read from Google API directly, not synced to files
- [x] Calendar: `sync-google-calendar` script removed, event scripts use Google API
- [x] Core DB scripts work with `@libsql/client` (both `file:` and `libsql://` URLs)
- [x] Cloud upgrade UI shown only when user tries to share/publish while on local SQLite
- [x] `isLocalDb()` helper detects local vs cloud mode
- [x] `db-health` endpoint returns `{ ok, local }` with real query test
- [x] Versioned migration system via `_migrations` table
- [x] Env var sanitization in `upsertEnvFile` (reject newlines/CR/null)
- [x] Form submission field whitelisting + size limits
- [x] Public form definition caching (60s TTL)
- [x] Submission notifications via `application-state/`
- [x] Agent scripts: `db-status`, `db-connect`
- [x] `.env.example` updated with `DATABASE_URL`, `DATABASE_AUTH_TOKEN`
- [x] Generic env var names (not Turso-specific)

### Phase 9: Slides — migrate from JSON files to SQLite

Currently stores decks as JSON files in `data/decks/{id}.json`. Move to SQLite via Drizzle.

#### Schema (`templates/slides/server/db/schema.ts`)

```typescript
export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(), // Full deck JSON (slides, layouts, animations, styling)
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
```

- Add `@libsql/client` + `drizzle-orm/libsql` deps
- Create `server/db/index.ts` with `getDb()` lazy singleton
- Create `server/plugins/db.ts` with migration
- Update all API routes that read/write `data/decks/` to use DB instead
- Update scripts to use DB queries
- Add cloud upgrade flow for sharing presentations

### Phase 10: Videos — migrate from files to SQLite

Currently stores composition data in files + localStorage. Move app-owned data to SQLite.

#### Schema (`templates/videos/server/db/schema.ts`)

```typescript
export const compositions = sqliteTable("compositions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(), // composition type
  data: text("data").notNull(), // Full composition JSON
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
```

- Add `@libsql/client` + `drizzle-orm/libsql` deps
- Create `server/db/` with schema, index, plugin
- Migrate composition CRUD from file reads/writes to DB queries
- Add cloud upgrade flow for sharing videos

### Phase 11: Content — add cloud sync layer for sharing

Content keeps files as the default (markdown is git-friendly). But add a cloud DB sync layer that:

1. **On-demand sync** — user can trigger "Sync to cloud" anytime from settings
2. **Share flow** — when user tries to share a page, prompt cloud upgrade if not connected
3. **Sync mechanism** — reads local files, writes content + metadata to cloud DB
4. **Shared pages served from DB** — public URLs read from cloud DB, not local files

#### Schema (`templates/content/server/db/schema.ts`)

```typescript
export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  workspace: text("workspace").notNull(),
  project: text("project").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(), // Markdown content
  metadata: text("metadata"), // JSON project metadata
  publishedAt: text("published_at"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
```

- Only used when cloud DB is connected — local dev stays file-based
- Sync script: reads `content/projects/`, writes to DB
- Public route: serves published pages from DB

### Phase 12: Provider-specific setup guidance

The `CloudUpgrade.tsx` component shows provider-specific instructions based on selection:

```typescript
const PROVIDERS = [
  {
    id: "turso",
    name: "Turso",
    description: "SQLite at the edge",
    urlPrefix: "libsql://",
    needsAuthToken: true,
    steps: [
      "Install CLI: curl -sSfL https://get.tur.so/install.sh | bash",
      "Login: turso auth login",
      "Create DB: turso db create my-app",
      "Get URL: turso db show my-app --url",
      "Get token: turso db tokens create my-app",
    ],
  },
  {
    id: "neon",
    name: "Neon",
    description: "Serverless Postgres",
    urlPrefix: "postgres://",
    needsAuthToken: false,
    steps: [
      "Create project at neon.tech",
      "Copy connection string from dashboard",
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Open source Firebase alternative",
    urlPrefix: "postgres://",
    needsAuthToken: false,
    steps: [
      "Create project at supabase.com",
      "Go to Settings → Database → Connection string",
      "Copy the URI connection string",
    ],
  },
  {
    id: "d1",
    name: "Cloudflare D1",
    description: "SQLite on Cloudflare's edge",
    urlPrefix: "d1://",
    needsAuthToken: true,
    steps: [
      "Create D1 database in Cloudflare dashboard",
      "Copy database ID and API token",
    ],
  },
];
```

User picks a provider, sees tailored setup instructions, pastes credentials. The `CloudUpgrade` component is shared across all templates.

## Updated Acceptance Criteria

- [x] Forms: `better-sqlite3` → `@libsql/client`, all queries async
- [x] Calendar: `better-sqlite3` → `@libsql/client`, all queries async
- [x] Calendar: events read from Google API directly, not synced to files
- [x] Calendar: `sync-google-calendar` script removed, event scripts use Google API
- [x] Slides: data moved from JSON files to SQLite via Drizzle
- [x] Videos: data moved from files to SQLite via Drizzle
- [x] Content: fully SQLite-backed (exceeded plan — no files at all, all in SQL)
- [x] Core DB scripts work with `@libsql/client`
- [x] Cloud upgrade UI with provider-specific instructions (Turso, Neon, Supabase, D1)
- [x] Cloud upgrade shown on publish/share, not on boot
- [x] Content: SQL is the only source of truth (no file sync needed)
- [x] `isLocalDb()` helper detects local vs cloud mode
- [x] `db-health` endpoint with real query test
- [x] Versioned migration system via `_migrations` table
- [x] Env var sanitization in `upsertEnvFile`
- [x] Form submission field whitelisting + size limits
- [x] Public form definition caching (60s TTL)
- [x] Submission notifications via `application-state/`
- [x] Agent scripts: `db-status`, `db-connect`
- [x] Generic env var names: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`

## Out of Scope

- Postgres support via Drizzle (Neon/Supabase use Postgres, would need schema translation — for now SQLite-compatible providers only)
- Real-time sync between local files and cloud DB (content sync is manual/on-demand)
- Analytics template changes (configs stay as files)

## Sources

- Forms DB: `templates/forms/server/db/index.ts`, `templates/forms/server/db/schema.ts`
- Calendar DB: `templates/calendar/server/db/index.ts`, `templates/calendar/server/db/schema.ts`
- Calendar Google API: `templates/calendar/server/lib/google-calendar.ts`
- Calendar event sync: `templates/calendar/scripts/sync-google-calendar.ts`
- Core DB scripts: `packages/core/src/scripts/db/query.ts`, `schema.ts`, `exec.ts`
- Env var management: `packages/core/src/server/create-server.ts`
- File-sync adapter (keep on better-sqlite3): `packages/core/src/adapters/drizzle/adapter.ts`
