---
title: "Multi-Tenancy"
description: "Every agent-native app is multi-tenant out of the box — organizations, team members, roles, and per-org data isolation, with zero configuration."
---

# Multi-Tenancy

Every agent-native app is multi-tenant out of the box. Organizations, team members, role-based access, and per-org data isolation are built into the framework with zero configuration.

## What you get for free {#free}

A fresh `npx @agent-native/core@latest create` scaffold already ships with:

- **User registration and login** — see [Authentication](/docs/authentication).
- **Organizations** — users create orgs and invite members by email. Each org is a fully isolated tenant.
- **Roles** — every member is an `owner`, `admin`, or `member`; actions can check the role for authorization.
- **Org switching** — the session tracks the active org (`session.orgId`), and switching it changes the data the user and agent see.
- **Per-org data isolation** — every query is automatically scoped to the active org.

If you're evaluating agent-native for a CRM, project tracker, support inbox, or any team tool, the multi-tenant foundation is already there. All first-party templates are multi-tenant — see [Cloneable SaaS templates](/docs/cloneable-saas) for the list.

## The org switcher UI {#org-switcher}

The org-switcher and members UI render in every template with no extra code. They drive the core org REST routes under `/_agent-native/org/*` (create org, switch org, list/invite/remove members, change roles, set allowed email domain). Users pick the active org from the switcher; the members panel handles invitations and role changes.

This is the framework's own `org/` module, not Better Auth's organization plugin (which is intentionally not registered). The full org-management surface — `createOrganization`, the REST routes, and template-authored `defineAction` wrappers like `invite-member` — is documented in [Authentication → Organizations](/docs/authentication#organizations).

## How isolation works {#isolation}

Tenant data is isolated by an `org_id` column (added by `ownableColumns()`), and the framework scopes every query to the active org automatically: `session.orgId → AGENT_ORG_ID → SQL`. When a user switches organizations, the UI, actions, and agent all see only that org's data — the agent cannot reach data for an org the user isn't a member of.

This is the same pipeline used for per-user scoping. For the SQL-level mechanics, the `ownableColumns()` contract, and the `accessFilter` / `resolveAccess` / `assertAccess` guards, see [Security → Data Scoping](/docs/security#data-scoping) — the single source of truth for the scoping pipeline.

## Related docs {#related}

- [Authentication](/docs/authentication#organizations) — sessions, social providers, and the org-management surface
- [Security → Data Scoping](/docs/security#data-scoping) — SQL-level isolation, the `ownableColumns()` contract, and access guards
- [Multi-App Workspace](/docs/multi-app-workspace) — hosting multiple agent-native apps in one monorepo with shared auth and RBAC
