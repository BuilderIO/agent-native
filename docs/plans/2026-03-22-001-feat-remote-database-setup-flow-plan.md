---
title: "feat: Remote database setup flow for forms & calendar"
type: feat
status: active
date: 2026-03-22
---

# Remote Database Setup Flow for Forms & Calendar

## Enhancement Summary

**Deepened on:** 2026-03-22
**Research agents used:** TypeScript reviewer, architecture strategist, security sentinel, performance oracle, simplicity reviewer, frontend races reviewer, data integrity guardian, agent-native architecture, framework docs researcher

### Key Improvements
1. Eliminated local SQLite entirely — Turso is the only DB, no dual-mode
2. Simplified from 5 phases to 2 phases, 5-step wizard to 2-field form
3. Added security hardening (env var sanitization, captcha gating, input validation)
4. Fixed module initialization pattern (`drizzle()` is synchronous, no top-level await needed)

## Overview

Forms and calendar templates need remote databases to be useful — shareable form links and public booking pages don't work without one. Today both templates use local `better-sqlite3` which serves no purpose (local files are preferred for local state per the agent-native philosophy).

**This plan removes all local SQLite code and makes Turso the only database.** No backwards compatibility, no migration, no dual-mode. The app requires Turso to function — the setup wizard is the entry point.

## Problem Statement

- Forms and calendar use local SQLite, but shareable links are the whole point of these apps
- Local SQLite adds complexity without value (files are preferred for local state)
- Users have no guided path to connect a remote database
- No indication that the app needs a remote DB to be useful

## Proposed Solution

### Delete local SQLite, require Turso

Remove `better-sqlite3` entirely from both templates. Use `@libsql/client` + `drizzle-orm/libsql` pointing at Turso only. If `TURSO_DATABASE_URL` is not set, the app shows the setup wizard instead of the main UI.

### Simple setup form

Not a 5-step wizard — just a setup card with instructions and 2 input fields:

1. Brief instruction block with Turso CLI commands and link to docs
2. Database URL input field
3. Auth token input field
4. "Test & Connect" button (validates connection before saving)

## Technical Approach

### Phase 1: Replace better-sqlite3 with @libsql/client

#### `server/db/index.ts` (both templates)

`drizzle()` is synchronous — no top-level await needed. The connection is established lazily on first query. Use a lazy singleton that throws if env vars aren't set:

```typescript
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _db: LibSQLDatabase<typeof schema> | undefined;

export function getDb() {
  if (!_db) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    if (!process.env.TURSO_AUTH_TOKEN) {
      throw new Error("TURSO_AUTH_TOKEN is required");
    }
    _db = drizzle({
      connection: { url, authToken: process.env.TURSO_AUTH_TOKEN },
      schema,
    });
  }
  return _db;
}

export { schema };
```

#### `server/plugins/db.ts` (new, both templates)

Schema initialization in a Nitro plugin, not at import time:

```typescript
import { defineNitroPlugin } from "@agent-native/core";
import { createClient } from "@libsql/client";

export default defineNitroPlugin(async () => {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return; // No DB configured — wizard will handle this

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  await client.execute(`CREATE TABLE IF NOT EXISTS forms (...)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS responses (...)`);
});
```

#### All handlers and scripts — add `await`

Every `db.select()`, `db.insert()`, `db.update()`, `db.delete()` becomes awaited. Use `getDb()` instead of importing `db` directly. TypeScript strict mode catches most missing `await`s since `Promise<T>` is not assignable to `T`.

**Migration audit approach:**
1. Do the driver swap
2. Run `tsc --noEmit` — fix every type error
3. Grep for `getDb().select|insert|update|delete` not preceded by `await` or `return`

#### `package.json` (both templates)

```diff
- "better-sqlite3": "^11.9.1",
- "@types/better-sqlite3": "^7.6.14",
+ "@libsql/client": "^0.15.0",
```

#### `drizzle.config.ts` (both templates)

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
```

#### Core DB scripts (`packages/core`)

The `db-query`, `db-exec`, `db-schema` scripts use `better-sqlite3` directly with better-sqlite3-specific APIs (`.pragma()`, `stmt.reader`). These need restructuring:

- Replace `new Database(path)` with `createClient({ url })` from `@libsql/client`
- Replace `.pragma("table_info(...)")` with `client.execute("PRAGMA table_info(...)")`
- Replace `stmt.reader` detection with try/catch or separate SELECT vs statement handling
- Read `TURSO_DATABASE_URL` from env, fall back to `file:` URL for `--db` flag

**Note:** Keep `better-sqlite3` in the Drizzle file-sync adapter (`packages/core/src/adapters/drizzle/`) — it's infrastructure for local file sync, not app data. The "remove better-sqlite3" scope is templates only.

### Phase 2: Setup wizard UI + env routes

#### Env var configuration

Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the existing env key config used by `GET /api/env-status` and `POST /api/env-vars`. No new `db-status` route needed — reuse the existing env-status infrastructure.

**Security: sanitize env var values before writing.** The `upsertEnvFile` function in `packages/core` must reject values containing newlines, carriage returns, or null bytes to prevent env var injection.

#### `server/routes/api/db-health.get.ts` (new, both templates)

A real health check that actually queries the DB (not just checking if env var is set):

```typescript
export default defineEventHandler(async () => {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
```

Used by the setup wizard to confirm connection after saving credentials.

#### `client/components/DatabaseSetup.tsx` (new, both templates)

Simple setup card — not a multi-step wizard. Shown as the main content when DB isn't configured:

- Instruction block: "Run these commands to set up Turso" with CLI commands and docs link
- Two input fields: Database URL, Auth Token
- "Test & Connect" button:
  1. POST to `/api/env-vars` to save credentials
  2. Poll `GET /api/db-health` until `{ ok: true }` (server needs restart to pick up new env vars)
  3. Max 30 retries at 1s intervals, then show error
  4. On success, reload page
- Use a ref-based guard to prevent double-click on save

#### `client/hooks/useDbStatus.ts` (new, both templates)

```typescript
export function useDbStatus() {
  return useQuery<{ configured: boolean }>({
    queryKey: ["db-status"],
    queryFn: async () => {
      const res = await fetch("/api/env-status");
      const data = await res.json();
      const tursoUrl = data.keys?.find(
        (k: any) => k.key === "TURSO_DATABASE_URL"
      );
      return { configured: !!tursoUrl?.configured };
    },
    staleTime: Infinity, // doesn't change within a session
  });
}
```

#### Integration points

**Forms app:** If `!configured`, render `<DatabaseSetup />` instead of the forms list/builder UI.

**Calendar app:** If `!configured`, render `<DatabaseSetup />` instead of the calendar/booking UI.

#### Agent scripts for DB management

Every UI action must have a corresponding agent script:

| Script | Purpose |
|--------|---------|
| `db-connect` | Write TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to `.env` |
| `db-status` | Check if Turso is configured and reachable |

These are simple scripts — the agent can also use the existing `db-query`, `db-exec`, `db-schema` core scripts once connected.

#### Update `.env.example` (both templates)

```env
# Remote Database (Turso) — required
TURSO_DATABASE_URL=libsql://your-db-your-org.turso.io
TURSO_AUTH_TOKEN=your-token-here
```

## Performance Considerations

### Cache public form definitions

Published form definitions rarely change. Add a simple in-memory cache with 60s TTL for the `getPublicForm` handler to avoid 20-50ms Turso edge latency on every public page load.

### Submission notifications via application-state

After a public form submission, write a notification file to `application-state/new-submission.json`. The SSE file watcher picks it up and notifies the admin UI — no polling needed. This keeps the existing agent-native architecture intact.

### Booking transaction optimization

The calendar `createBooking` handler uses a transaction for conflict checking. With Turso, verify that Drizzle's libsql driver batches transaction statements into a single HTTP request. If not, rewrite as a single `INSERT ... WHERE NOT EXISTS` to reduce round trips.

## Security Requirements

Before shipping:

1. **Sanitize env var values** — reject newlines/CR/null bytes in `upsertEnvFile` to prevent injection
2. **Validate connection before saving** — test query (`SELECT 1`) before persisting Turso credentials
3. **Require captcha for published forms** — when Turso is connected, require `TURNSTILE_SECRET_KEY` before allowing form publishing (public endpoints are internet-facing)
4. **Whitelist submission fields** — only accept keys matching the form definition's field IDs, strip everything else
5. **Enforce input size limits** — max string length per field, H3 body size limit on submission endpoint
6. **Stored XSS prevention** — ensure responses viewer renders user-submitted data as text, never HTML

## Schema Evolution

Use a simple version-tracked migration system instead of bare `CREATE TABLE IF NOT EXISTS`:

```typescript
const MIGRATIONS = [
  { version: 1, up: `CREATE TABLE IF NOT EXISTS forms (...)` },
  { version: 1, up: `CREATE TABLE IF NOT EXISTS responses (...)` },
];

async function migrate(client: Client) {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`
  );
  const { rows } = await client.execute(
    `SELECT MAX(version) as v FROM _migrations`
  );
  const current = (rows[0]?.v as number) ?? 0;
  for (const m of MIGRATIONS.filter((m) => m.version > current)) {
    await client.batch([
      { sql: m.up, args: [] },
      { sql: `INSERT INTO _migrations VALUES (?)`, args: [m.version] },
    ]);
  }
}
```

This runs in the Nitro `db.ts` plugin at startup. Future schema changes just add entries to `MIGRATIONS`.

## Acceptance Criteria

- [ ] `better-sqlite3` removed from both templates (forms + calendar)
- [ ] `@libsql/client` + `drizzle-orm/libsql` used with Turso only
- [ ] App shows setup form when `TURSO_DATABASE_URL` is not set
- [ ] Setup form validates connection before saving credentials
- [ ] After connecting, app reloads and main UI is available
- [ ] All handlers and scripts use `await` with async Drizzle calls
- [ ] Core `db-query`/`db-exec`/`db-schema` scripts work with Turso
- [ ] Agent can run `pnpm script db-connect` and `pnpm script db-status`
- [ ] Schema versioning via `_migrations` table
- [ ] Env var values sanitized against injection
- [ ] Public form submissions write notification to `application-state/`
- [ ] Published form definitions cached with TTL

## Sources

- Google Connect Banner pattern: `templates/mail/client/components/GoogleConnectBanner.tsx`
- Current DB init: `templates/forms/server/db/index.ts`, `templates/calendar/server/db/index.ts`
- Env var management: `packages/core/src/server/create-server.ts`
- Public path auth: `templates/forms/server/plugins/auth.ts` (publicPaths already configured)
- Drizzle + LibSQL: `drizzle-orm/libsql` driver, `@libsql/client` package
- Core DB scripts: `packages/core/src/scripts/db/query.ts`, `schema.ts`, `exec.ts`
- File-sync adapter (keep on better-sqlite3): `packages/core/src/adapters/drizzle/adapter.ts`
