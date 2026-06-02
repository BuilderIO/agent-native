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

All first-party templates (Mail, Calendar, Content, Brain, Assets, Slides, Video, Analytics, Clips, Design, Forms, and Dispatch) are multi-tenant out of the box. If you're building on any of these, your app already supports teams with no extra work.

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

Org management is a **framework built-in**: the core org plugin auto-mounts REST routes under `/_agent-native/org/*` (create org, switch org, list/invite/remove members, change roles, set allowed email domain), and these back the org-switcher and members UI in every template with no extra code. Agent-callable actions with names like `create-organization` or `invite-member` are **template-authored** on top of this surface, not built-in tools — a template wires its own `defineAction` wrappers when it wants the agent to manage its specific membership model.

## Data scoping {#data-scoping}

Tenant data is isolated by an `org_id` column (added by `ownableColumns()`), and the framework scopes every query to the active org automatically — `session.orgId → AGENT_ORG_ID → SQL`. When a user switches organizations, the UI, actions, and agent all see only that org's data; the agent cannot reach data for an org the user isn't a member of.

This is the same pipeline used for per-user scoping. For the SQL-level mechanics, the `ownableColumns()` contract, and the `accessFilter` / `resolveAccess` / `assertAccess` guards, see [Security & Data Scoping](/docs/security#data-scoping).

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
- [Multi-App Workspace](/docs/multi-app-workspace) — hosting multiple agent-native apps in one monorepo with shared auth and RBAC
