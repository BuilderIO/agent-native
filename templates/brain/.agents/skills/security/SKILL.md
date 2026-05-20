---
name: security
description: >-
  Data security model, user/org scoping, and auth patterns. Use when adding
  tables with user data, implementing multi-user features, setting up A2A
  cross-app calls, or reviewing data access patterns.
---

# Security & Data Scoping

The framework gives you two layers of isolation. Use both — they cover
different surfaces and read the same identity.

| Layer                                            | Where it runs                                                            | What it protects                                |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- |
| `accessFilter` / `resolveAccess` / `assertAccess` | Drizzle helpers used inside actions and `/api/` handlers                 | List, read, and write of **ownable resources** |
| `owner_email` / `org_id` view scoping            | The agent's `db-query` / `db-exec` raw-SQL CLI (`pnpm action db-query`)  | Ad-hoc SQL the agent runs from the terminal     |

Identity comes from the auth session via
`runWithRequestContext({ userEmail, orgId }, fn)`; raw-SQL agent scripts
read it from `AGENT_USER_EMAIL` / `AGENT_ORG_ID`, which the framework
sets automatically when actions and CLI scripts execute.

## Auth (Better Auth by default)

The framework uses **Better Auth** for authentication. New users create an
account on first visit; sessions feed `getSession(event)` server-side and
`useSession()` client-side. The full mode matrix (`AUTH_MODE=local`,
`ACCESS_TOKEN`, `AUTH_DISABLED`, BYOA via custom `getSession`) lives in
the `authentication` skill — read it before changing how visitors sign in.

**Key environment variables** (see `authentication` skill for the full list):

- `BETTER_AUTH_SECRET` — signing key, auto-generated in dev if not set
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — enable Google OAuth
- `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` — enable GitHub OAuth
- `AUTH_MODE=local` — explicit local-only escape hatch
- `ACCESS_TOKEN` / `ACCESS_TOKENS` — simple shared-token auth (no per-user identity)
- `AUTH_DISABLED=true` — skip auth (apps behind infrastructure auth like Cloudflare Access)

## Make a resource ownable

For anything a user creates (notes, projects, dashboards, …), use
`ownableColumns()` + `createSharesTable()`. This is the canonical shape —
the framework's share dialog, list filtering, and the CI guard
(`scripts/guard-no-unscoped-queries.mjs`) all key off it. See the
`sharing` skill for the full registration pattern.

```ts
import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  ...ownableColumns(), // adds owner_email, org_id, visibility
});

export const noteShares = createSharesTable("note_shares");
```

`ownableColumns()` adds three columns: `owner_email` (creator), `org_id`
(the owner's active org at creation time), and `visibility`
(`'private' | 'org' | 'public'`, default `'private'`).

## Use the access helpers in every server-side query

Auto-mounted action routes (`/_agent-native/actions/...`) get a request
context wired automatically. Hand-written `/api/*` Nitro routes do **not** —
you must wrap your work in `runWithRequestContext` after reading the
session yourself.

```ts
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  accessFilter,
  resolveAccess,
  assertAccess,
} from "@agent-native/core/sharing";

// List
db.select()
  .from(schema.notes)
  .where(accessFilter(schema.notes, schema.noteShares));

// Read by id (returns null when no access — return 404 to avoid existence leak)
const access = await resolveAccess("note", id);

// Write / delete (throws ForbiddenError if the role isn't met)
await assertAccess("note", id, "editor");
```

The CI guard fails the build if any file in `templates/*/server/`,
`templates/*/actions/`, or `packages/*/src/` queries an ownable table
without one of these helpers. Last-resort opt-out is the marker comment
`// guard:allow-unscoped — <reason>`; only use it for the sharing
primitives themselves and share-token-public viewer endpoints.

## Auto-scoping for `db-query` / `db-exec`

When the agent runs `pnpm action db-query --sql "SELECT ..."`, the
framework creates temporary views that shadow real tables with
`WHERE owner_email = <current user> [AND org_id = <current org>]`.
INSERT statements auto-fill `owner_email` / `org_id`; UPDATE / DELETE
statements are scoped the same way. This is the agent's escape hatch
for ad-hoc SQL — application code should still go through the helpers
above.

Auto-scoping uses the same column convention `ownableColumns()` produces,
so following the pattern above means raw-SQL scoping just works.
Run `pnpm action db-check-scoping` to verify (use `--require-org` for
multi-org apps).

## A2A Security

When apps call each other via A2A, set the same `A2A_SECRET` on every
app that needs to trust each other. Outbound calls are signed JWTs with
`sub: "<email>"`; inbound calls verify the signature and set
`AGENT_USER_EMAIL` from the verified `sub` claim — the access helpers
above then keep the call scoped to that user.

Without `A2A_SECRET`, A2A calls are unauthenticated (fine for local dev,
not production).

## Rules for Agents

1. Every new user-data table uses `ownableColumns()` (which provides
   `owner_email`, `org_id`, and `visibility`).
2. Every list / read-many query goes through `accessFilter`.
3. Every read-by-id goes through `resolveAccess`.
4. Every write / delete-by-id goes through `assertAccess`.
5. Hand-written `/api/*` handlers that touch ownable data wrap their
   work in `runWithRequestContext({ userEmail, orgId }, fn)` after
   reading the session via `getSession(event)`.
6. Don't put per-user data in `application_state` — it's session-scoped,
   not user-scoped. Use SQL tables with `ownableColumns()`.
7. Don't hardcode `local@localhost` as a fallback — the
   `guard-no-localhost-fallback` CI guard rejects it. Throw / 401 when
   there's no session instead.
8. Test isolation with two real accounts before shipping.

## Related Skills

- `sharing` — full pattern for ownable resources, share rows, and the share dialog
- `authentication` — auth modes, sessions, organizations, BYOA
- `storing-data` — SQL patterns and the agent's db tools
- `actions` — `defineAction` (auto-protected by the auth guard)
