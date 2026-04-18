# Org Model — Scheduling Template

This document describes how the Scheduling template uses the framework's
multi-tenant **organization** primitive together with Cal.com-style **teams**
and the framework **sharing** system.

## TL;DR — teams under orgs

Scheduling uses **two layers**:

1. **Organization** (top-level tenant) — the framework's
   `@agent-native/core/org` model. Tables: `organizations`, `org_members`,
   `org_invitations`. Owned at `org_members.role = 'owner' | 'admin' | 'member'`.
   This is the boundary every user-authored resource is scoped to via the
   `org_id` column added by `ownableColumns()`.
2. **Team** (sub-grouping inside an org) — Cal.com's notion of a team:
   a slugged collection of users (`teams`, `team_members`) that own a public
   booking page (`/team/:slug`), team event types, and team workflows / forms.
   Teams **always live inside one org** (the creator's active org at create
   time, persisted to `teams.org_id`).

This matches Cal.com's hierarchy (organizations → teams → event types) while
plugging into the standard agent-native multi-tenant rails the rest of the
framework uses.

## Why two layers (and not just one)

We considered three options:

- (a) Drop framework orgs and use only `teams` — rejected. Other parts of the
  framework (org-aware sharing, settings scoping, agent teams, the
  `OrgSwitcher` UX, the `org_id` column convention) all assume the canonical
  `organizations` table exists.
- (b) Drop `teams` and treat each Cal.com team as its own framework org —
  rejected. Cal.com users routinely belong to one company (org) with multiple
  internal teams (Sales, Support, Engineering). Modeling each team as a
  separate top-level tenant breaks org-wide settings, billing, and member
  invites.
- (c) **Teams are nested inside orgs** — chosen. Standard org rails for
  identity, sharing, and tenant scoping; teams stay as a Cal.com-shaped
  sub-grouping for round-robin / collective event types and team booking
  pages.

## Table relationships

```
organizations (framework)              ← top-level tenant
  org_members
  org_invitations
  ↑
  │ org_id
  │
teams                                  ← Cal.com team within an org
  team_members
  team_shares
  ↑
  │ team_id (nullable — null = personal)
  │
event_types, schedules, workflows,     ← user-authored resources
routing_forms, bookings
  + ownerEmail (creator)
  + orgId      (creator's active org)
  + visibility ('private' | 'org' | 'public')
  + companion {*}_shares table
```

Every user-authored resource that uses `ownableColumns()` carries:

- `owner_email` — the creator (ground truth for ownership).
- `org_id` — the creator's active org **at the time of creation**.
  Resources do **not** move between orgs; if a user switches orgs they
  create new resources in the new org.
- `visibility` — `'private'` (owner only) | `'org'` (anyone in `org_id`) |
  `'public'` (anyone, including unauthenticated booker traffic).

Plus the companion `{resource}_shares` table for explicit per-user / per-org
grants (`viewer | editor | admin`).

## How it composes — read paths

`accessFilter(resourceTable, sharesTable)` admits a row when ANY of:

- `resource.owner_email = currentUser` (ownership)
- `resource.visibility = 'public'`
- `resource.visibility = 'org'` AND `resource.org_id = currentOrg`
- An explicit share row exists for `(currentUser, resource)` or
  `(currentOrg, resource)` with the required role

All `list-*` actions in the scheduling package now use `accessFilter` so a
user sees:

- their own event types, schedules, bookings, workflows, routing forms;
- anything explicitly shared with them or with their active org;
- anything `org`-visible scoped to their active org.

Switching orgs (via `OrgSwitcher`) flips `currentOrg` and re-runs every list
query (the `useSwitchOrg()` mutation invalidates the whole React Query
cache).

## How it composes — write paths

`assertAccess(resourceType, resourceId, minRole)` is called at the top of
every mutate action that operates on a specific resource id:

| Action                     | Required role   |
| -------------------------- | --------------- |
| `update-event-type`        | `editor`        |
| `delete-event-type`        | `admin`         |
| `toggle-event-type-hidden` | `editor`        |
| `set-event-type-location`  | `editor`        |
| `set-event-type-hosts`     | `editor`        |
| `add-private-link`         | `editor`        |
| `reorder-event-types`      | `editor` (each) |
| `update-schedule`          | `editor`        |
| `delete-schedule`          | `admin`         |
| `update-workflow`          | `editor`        |
| `toggle-workflow`          | `editor`        |
| `delete-workflow`          | `admin`         |
| `update-routing-form`      | `editor`        |
| `delete-routing-form`      | `admin`         |

The owner always satisfies any role; share rows can grant non-owners
`editor` or `admin`. `assertAccess` throws `ForbiddenError` (HTTP 403) on a
miss.

Team-level mutations (`set-team-branding`, `update-member-role`,
`invite-team-member`, `remove-team-member`) continue to use
`assertTeamAdmin()` — that's a distinct concept (role on the `teams`
sub-grouping, not on the org).

## Public booking — outside the access model

The slug-based public URLs (`/:user`, `/:user/:slug`, `/team/:slug`,
`/d/:hash/:slug`, `/forms/:formId`) intentionally do **not** go through
`accessFilter`. They serve unauthenticated visitors who need to BOOK a
meeting; they only check the resource is published (`hidden = false`) and
applicable per-link rules (hashed link expiry, single-use, etc.). The
sharing system is for managing access to **edit** a resource — booking
via the public URL is a separate axis.

## Switching orgs

The sidebar renders `<OrgSwitcher />` (from `@agent-native/core/client/org`).
On switch:

- The user's `active-org-id` setting is updated.
- All React Query caches are invalidated.
- Every `list-*` action re-runs, scoped to the new org via
  `getRequestOrgId()` → `accessFilter`.

## Migration

No new tables are required. Every scheduling resource table already includes
`ownableColumns()` (`owner_email`, `org_id`, `visibility`) and a companion
`{name}_shares` table — the missing piece was the read/write pipelines
honoring those columns. That's now wired through:

- list/read actions go through `accessFilter`;
- update/delete actions go through `assertAccess`;
- create actions stamp `org_id = currentOrgId()`.

The framework's `org` plugin (`@agent-native/core/org/plugin.ts`) is
auto-mounted by `createCoreRoutesPlugin()` (already used in
`server/plugins/core-routes.ts`), so the `/_agent-native/org/*` routes that
power `OrgSwitcher` work out of the box.
