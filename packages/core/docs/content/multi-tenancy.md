---
title: "Multi-Tenancy"
description: "Every agent-native app is multi-tenant out of the box — organizations, team members, roles, and per-org data isolation with zero configuration."
---

# Multi-Tenancy

Every agent-native app is multi-tenant by default. Organizations, team members, role-based access, and per-org data isolation are built into the framework — there is nothing to configure or opt into.

## How it works {#how-it-works}

The framework uses [Better Auth](https://better-auth.com)'s organizations plugin to provide full multi-tenancy:

- **Organizations** — users create organizations and invite team members. Each org is a fully isolated tenant.
- **Roles** — every member has a role: `owner`, `admin`, or `member`. Actions can check roles for authorization.
- **Active organization** — the session tracks which org the user is currently working in (`session.orgId`). Switching orgs changes the data they see.
- **Data isolation** — SQL queries are automatically scoped to the active org via `org_id` columns. Data tagged with one org is invisible to users in another org, including the agent.

All first-party templates (Mail, Calendar, Content, Slides, Video, Analytics) are multi-tenant out of the box. If you're building on any of these, your app already supports teams with no extra work.

## Organizations and members {#organizations-and-members}

Users can create organizations, invite members by email, and assign roles:

```typescript
// Creating an org (from an action or the client)
const org = await auth.api.createOrganization({
  body: { name: "Acme Inc", slug: "acme" },
});

// Inviting a member
await auth.api.createInvitation({
  body: {
    organizationId: org.id,
    email: "alice@acme.com",
    role: "member", // "owner" | "admin" | "member"
  },
});
```

The agent can also manage organizations through actions — `create-organization`, `invite-member`, `update-member-role`, and `remove-member` are available in every template.

## Data scoping {#data-scoping}

Every table that holds tenant-specific data includes an `organization_id` foreign key. The framework scopes queries automatically:

```
session.orgId → AGENT_ORG_ID → SQL row scoping
```

When a user switches organizations, all queries, actions, and agent operations see only that org's data. This applies to both the UI and the agent — the agent cannot access data belonging to an organization the user isn't a member of.

For full details on how scoping works at the SQL level, see [Security & Data Scoping](/docs/security).

## Adding multi-tenancy to a new table {#new-tables}

When you add a new domain table, include `organization_id` to make it tenant-aware:

```typescript
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  organizationId: text("organization_id").notNull(),
  // ... other columns
});
```

Then scope your queries by the active org from the session. The framework's `accessFilter` helper and `assertAccess` guard handle this automatically when you follow the standard action patterns.

## No configuration needed {#zero-config}

Multi-tenancy is not a feature you enable — it's the default architecture. A fresh `agent-native create` scaffold already has:

- User registration and login
- Organization creation and management
- Member invitations with role assignment
- Per-org data isolation
- Org switching in the UI

If you're evaluating agent-native for a product like a CRM, project tracker, support inbox, or any team tool — the multi-tenant foundation is already there.

## Related docs {#related}

- [Authentication](/docs/authentication) — auth modes, social providers, session API
- [Security & Data Scoping](/docs/security) — SQL-level isolation, input validation, access guards
- [Enterprise Workspace](/docs/enterprise-workspace) — hosting multiple agent-native apps in one monorepo with shared auth and RBAC
