---
name: security
description: >-
  Data security model, user/org scoping, and auth patterns. Use when adding
  tables with user data, implementing multi-user features, setting up A2A
  cross-app calls, or reviewing data access patterns.
---

# Security & Data Scoping

## How Data Isolation Works

In production, the framework enforces data isolation at the SQL level. Agents and users can only see and modify data they own. This is automatic — you don't write WHERE clauses yourself.

### Per-User Scoping (`owner_email`)

Every table with user-specific data **must** have an `owner_email` text column.

```ts
import { table, text, integer } from "@agent-native/core/db/schema";

export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  owner_email: text("owner_email").notNull(), // REQUIRED for user data
});
```

**What happens automatically:**
- `db-query` creates temporary views with `WHERE owner_email = <current user>`
- `db-exec` INSERT statements get `owner_email` auto-injected
- `db-exec` UPDATE/DELETE statements are scoped to the current user's rows
- The current user comes from `AGENT_USER_EMAIL` (set from the auth session)

### Per-Org Scoping (`org_id`)

For multi-user apps where teams share data, add an `org_id` column:

```ts
export const projects = table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner_email: text("owner_email").notNull(), // who created it
  org_id: text("org_id").notNull(),           // which org it belongs to
});
```

When both columns are present, queries are scoped by **both**: `WHERE owner_email = ? AND org_id = ?`.

The `org_id` comes from `AGENT_ORG_ID` which is automatically set from the user's active organization in Better Auth.

### Validation

Run `pnpm action db-check-scoping` to verify all tables have proper ownership columns. Use `--require-org` for multi-org apps.

## Auth Model

### Better Auth (Default)

The framework uses Better Auth for authentication. It's always on by default — users create an account on first visit.

**Environment variables:**
- `BETTER_AUTH_SECRET` — signing key (auto-generated if not set)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — enable Google OAuth
- `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` — enable GitHub OAuth
- `AUTH_MODE=local` — disable auth for solo local dev (escape hatch)

### Organizations

Better Auth's organization plugin is built-in. Every app supports:
- Creating organizations
- Inviting members (owner/admin/member roles)
- Switching active organization
- Per-org data scoping via `org_id`

The active organization ID flows from `session.orgId` → `AGENT_ORG_ID` → SQL scoping automatically.

### ACCESS_TOKEN (Legacy)

For simple deployments, set `ACCESS_TOKEN` or `ACCESS_TOKENS` (comma-separated) as environment variables. This provides a shared token for all users — no per-user identity.

## A2A Security

### Cross-App Identity

When apps call each other via A2A, they need to verify identity. Set the same `A2A_SECRET` on all apps that need to trust each other:

```bash
# On both apps
A2A_SECRET=your-shared-secret-at-least-32-chars
```

**How it works:**
1. App A signs a JWT with `A2A_SECRET` containing `sub: "steve@builder.io"`
2. App B receives the call, verifies the JWT signature
3. App B sets `AGENT_USER_EMAIL` from the verified `sub` claim
4. Data scoping applies — App B only shows steve's data

Without `A2A_SECRET`, A2A calls are unauthenticated (fine for local dev, not production).

## Rules for Agents

1. **Every new table with user data must have `owner_email`.** No exceptions.
2. **Never bypass scoping** — don't raw-query tables without going through `db-query`/`db-exec`.
3. **Don't expose user data in application state** — application state is per-session, not per-user. Use SQL tables with `owner_email` for persistent user data.
4. **Don't hardcode emails** — use `AGENT_USER_EMAIL` environment variable.
5. **Test with multiple users** — create two accounts and verify data isolation.
