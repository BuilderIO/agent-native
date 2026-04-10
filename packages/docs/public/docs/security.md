---
title: "Security & Data Scoping"
description: "Per-user and per-org data isolation enforced at the SQL level, plus A2A identity verification."
---

# Security & Data Scoping

In production, the framework automatically restricts agent SQL queries to the current user's data. This is enforced at the SQL level — agents cannot bypass it.

## Data Scoping {#data-scoping}

Data scoping ensures each user only sees their own data. It works by creating temporary SQL views that filter tables before the agent's query runs. Two scoping dimensions are supported:

- **`owner_email`** — per-user data isolation (required for all user-facing tables)
- **`org_id`** — per-organization data isolation (for multi-user/team apps)

## Per-User Scoping {#per-user-scoping}

Every table with user-specific data **must** have an `owner_email` text column:

```typescript
import { table, text, integer } from "@agent-native/core/db/schema";

export const notes = table("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  owner_email: text("owner_email").notNull(), // REQUIRED
});
```

The current user's email comes from `AGENT_USER_EMAIL`, which is automatically set from the auth session before any agent script runs.

## Per-Org Scoping {#per-org-scoping}

For apps where teams share data within an organization, add an `org_id` column:

```typescript
export const projects = table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  owner_email: text("owner_email").notNull(),
  org_id: text("org_id").notNull(),
});
```

When both columns are present, queries are scoped by **both**: `WHERE owner_email = ? AND org_id = ?`.

The `org_id` is automatically resolved from the user's active organization in Better Auth. Templates can override this with a custom `resolveOrgId` callback in `createAgentChatPlugin()`.

## How Scoping Works {#how-scoping-works}

When an agent runs `db-query`, `db-exec`, or `db-patch` in production mode:

1. The framework discovers all tables and their columns via schema introspection
2. For each table with `owner_email` and/or `org_id`, a temporary view is created:

```sql
-- Temporary view replaces the real table name
CREATE TEMPORARY VIEW "notes" AS
  SELECT * FROM main."notes"
  WHERE "owner_email" = 'alice@example.com'
  AND "org_id" = 'org-123';
```

3. The agent's query runs against the views (not the real tables)
4. Views are dropped after the query completes

This means agents write normal SQL — no WHERE clauses needed for ownership. The framework handles it transparently.

## INSERT Auto-Injection {#insert-auto-injection}

When an agent runs an INSERT via `db-exec`, the framework automatically injects ownership columns:

```sql
-- Agent writes:
INSERT INTO notes (title, content) VALUES ('My Note', 'Hello')

-- Framework transforms to:
INSERT INTO notes (title, content, owner_email, org_id)
  VALUES ('My Note', 'Hello', 'alice@example.com', 'org-123')
```

This only happens when the columns aren't already present in the INSERT statement.

## A2A Identity Verification {#a2a-identity}

When apps call each other via the A2A protocol, they can verify the caller's identity using JWT tokens signed with a shared secret:

```bash
# Set the same secret on all apps that need to trust each other
A2A_SECRET=your-shared-secret-at-least-32-chars
```

How it works:

1. App A signs a JWT with `A2A_SECRET` containing `sub: "steve@example.com"`
2. App B receives the call and verifies the JWT signature with the same secret
3. App B sets `AGENT_USER_EMAIL` from the verified `sub` claim
4. Data scoping applies — App B only shows Steve's data

Without `A2A_SECRET`, A2A calls are unauthenticated. This is fine for local development but should not be used in production.

## Schema Validation {#validation}

Run the scoping check to verify all tables have proper ownership columns:

```bash
# Check all tables have owner_email
pnpm action db-check-scoping

# Also require org_id for multi-org apps
pnpm action db-check-scoping --require-org
```

Tables without scoping columns are flagged. Core framework tables (`settings`, `application_state`, `sessions`) use their own scoping mechanisms and are excluded from the check.

## Production Checklist {#production-checklist}

- Every user-facing table has `owner_email`
- Multi-user tables also have `org_id`
- `BETTER_AUTH_SECRET` is set to a random 32+ character string
- `A2A_SECRET` is set on all apps that call each other
- `AUTH_MODE` is **not** set to `local` in production
- Run `pnpm action db-check-scoping` to validate schema
- Test with two user accounts to verify data isolation
