# Automation Sharing Design

**Date:** 2026-08-05  
**Status:** Approved

## Summary

Automations become individually shareable without changing their underlying `jobs/*.md` resource definitions or execution model. The Automations page presents one access-aware list instead of separate Personal and Organization sections. Each row explains who can access the automation and which operations the current user may perform.

Sharing is private by default, supports organization-wide view access or grants to specific existing accounts, and never creates a public link. A collaborator can edit and operate an automation, but the automation always executes as its immutable creator. Only the owner can delete the automation or change its sharing.

## Product Decisions

### One unified Automations list

The Automations page has one list containing every automation the signed-in account may access:

- automations the account owns;
- organization-visible automations for any organization of which the account is a current member;
- automations explicitly shared with the account;
- legacy recurring jobs admitted by the compatibility rules below.

There are no Personal and Organization sections. Trigger type, enabled state, run status, and next/last run remain visible as they are today.

### Row-level access labels

Every row explains access independently of its trigger and status badges:

- **Personal** — owned by the current user and not shared.
- **Organization** — visible to all current members of the owning organization with View access.
- **Shared with you · View** — explicitly shared with the current user as View.
- **Shared with you · Collaborate** — explicitly shared with the current user as Collaborate.
- **Specific people** for an owned automation — show the number of grantees and a compact avatar group when profile data is available. The count remains authoritative when avatars are unavailable or exceed the displayed limit.

The row does not imply execution identity. A shared row may be operated by a collaborator, but execution remains creator-bound.

### Sharing choices in create and edit

Create and edit include a **Sharing** section with three mutually exclusive choices:

1. **Personal** — only the owner can access the automation.
2. **Organization** — every current member of the selected owning organization receives View access through visibility; organization membership alone never grants edit, pause/resume, run-now, delete, or sharing management.
3. **Specific people** — the owner selects one or more existing accounts and assigns each View or Collaborate.

Changing the selected mode replaces the prior sharing state atomically:

- Personal stores private visibility and no grants.
- Organization stores organization visibility and no specific-user grants.
- Specific people stores private visibility plus the submitted user grants.

A validation or write failure leaves both the job definition and the previous sharing state unchanged. The UI keeps the dialog open and shows an inline error.

### Roles and permissions

| Capability | View | Collaborate | Owner |
| --- | ---: | ---: | ---: |
| Appear in unified list | Yes | Yes | Yes |
| Open details and instructions | Yes | Yes | Yes |
| View enabled state, status, next/last run, errors, and run history | Yes | Yes | Yes |
| Edit definition | No | Yes | Yes |
| Pause or resume | No | Yes | Yes |
| Run now | No | Yes | Yes |
| Delete | No | No | Yes |
| Change visibility, users, or roles | No | No | Yes |

Organization visibility is always View. It does not inherit an organization admin's current legacy mutation authority. The sharing model intentionally has no share-admin role: ownership is the only authority for deletion and sharing management.

### Specific-user eligibility

A specific user may be any existing Agent Native account, whether or not that account belongs to the owner's active organization.

- Search results clearly mark accounts outside the owning organization.
- An outside-organization View grant may be saved normally.
- An outside-organization Collaborate grant requires an explicit acknowledgement in the current save attempt. The acknowledgement explains that the person can edit, pause/resume, and run the automation while it continues to execute with the creator's identity and connected capabilities.
- The acknowledgement is not persisted as a durable bypass; changing the selected outside collaborator or changing View to Collaborate requires a fresh acknowledgement.
- Unknown emails and nonexistent accounts fail validation. Sharing does not silently create or invite an account.

There are no public links and no public visibility option. Direct URLs still require authentication and an access decision.

## Data and Storage Design

### Keep `jobs/*.md` as the definition source of truth

Automation definitions remain markdown resources under `jobs/` with their existing YAML frontmatter and body. Sharing does not move, duplicate, or rewrite trigger definitions into a new domain table. Schedule, event, and manual acquisition continue to read the same resources.

The resource id is the stable key for access. Name and owner remain compatibility locators, but permissions must not be keyed by a mutable or reusable path alone.

### Add a job-specific sharing overlay

Add core-owned, dialect-portable SQL storage keyed by `resources.id`:

- one overlay row per job resource, containing private/organization visibility and the organization used for organization visibility;
- zero or more user-grant rows, each containing the resource id, normalized account email, and `view` or `collaborate` role;
- uniqueness on resource id for the overlay and on `(resource_id, user_email)` for grants;
- indexes for visibility/organization listing and user-grant listing.

The overlay is specific to `jobs/*.md`. It must not reinterpret the generic resource `visibility` field, which currently distinguishes workspace resources from agent scratch resources, and it must not force resource definitions through the Drizzle shareable-resource registry designed for ownable app tables.

Initialization is additive and idempotent for SQLite, Postgres, and D1 through the existing `getDbExec()`, `ensureTableExists`, `ensureColumnExists`, and `ensureIndexExists` patterns. No resource row or frontmatter migration is required.

### Effective owner and creator

The access service resolves the owner from the existing resource and parsed job frontmatter:

- a personal resource is owned by its resource-owner email;
- an organization-owned resource is owned by its immutable `createdBy` account;
- a malformed resource whose creator cannot be determined fails closed for mutation and execution;
- sharing never changes `createdBy`, `runAs`, resource owner, organization id, or run-history ownership.

New definitions continue to persist `createdBy` and `runAs: creator`. Shared run-now, schedule, and event execution all resolve the creator exactly as the current background runner does.

### Legacy compatibility

Existing organization-owned jobs that do not yet have an overlay row retain their current organization-visible behavior. They are listed to current members as Organization and are treated as a compatibility state rather than being rewritten eagerly.

On the first owner-managed sharing update, an explicit overlay is written. There is no destructive or bulk migration. Legacy personal jobs without an overlay remain Personal. Existing `__shared__` compatibility resources continue to follow the current legacy acquisition rules until separately retired; this feature does not broaden their execution identity.

## Access Service

Introduce one job-specific access boundary used by all list, read, and mutation paths. It returns an explicit effective role (`owner`, `collaborate`, or `view`) and sharing summary instead of overloading the current `canUpdate` boolean.

### Listing

The unified list reads all candidate `jobs/*.md` resources and admits only resources for which one of these is true:

- caller is the owner;
- caller is a current member of the overlay's organization and visibility is Organization;
- caller has a specific user grant;
- the resource qualifies for legacy organization-visible compatibility.

Listing must batch overlay rows, grants, membership checks, and profiles rather than issue one SQL request per automation. It returns only fields the list needs plus the sharing summary. Full details and run history remain on-demand reads.

### Authorization

Every operation re-resolves access on the server; UI affordances are not an authorization boundary.

- list/details/status/run-history require View;
- edit and pause/resume require Collaborate;
- run-now requires Collaborate and still dispatches as the creator;
- delete requires Owner;
- replace sharing requires Owner.

Resource-not-found and inaccessible-resource reads should not leak existence. Membership and account lookups fail closed when unreadable. Revoked grants and removed organization membership take effect on the next action call and list refresh.

### Atomic writes

Create and edit validate the complete definition and sharing request before any write. Definition and sharing changes commit in one database transaction. The implementation must not report success when only one side was persisted.

Delete removes the resource, run history, overlay, and grants in one transaction or with an equivalent fail-loud atomic boundary supported by the shared database abstraction. Name reuse must not inherit stale sharing or run history.

The save contract accepts the intended complete sharing state rather than a sequence of independent client-side add/remove requests. This prevents intermediate access states and makes mode changes atomic.

## Actions and Agent/UI Parity

### Agent surface

`manage-automations` remains the canonical conversational tool. It gains the same unified, resource-id-aware access behavior and sharing vocabulary as the UI:

- `list` returns all accessible automations with effective access and sharing summary;
- `define` accepts Personal, Organization, or Specific people sharing after confirmation;
- `update`, pause/resume behavior, and `run-now` require Collaborate;
- `delete` and sharing changes require Owner;
- outside-organization Collaborate requires an explicit acknowledgement argument tied to that requested write.

The tool description must teach the permission model, public-sharing exclusion, and creator-bound execution. The agent must not claim that sharing transfers credentials or execution ownership.

### Direct UI actions

The Agent page continues to call frontend-only actions discovered through the core action registry. Replace the split-scope reads with one unified access-aware list action and use stable resource ids for reads and mutations. The direct UI action surface must enforce the same access service as `manage-automations`; it must not duplicate authorization rules.

Action responses expose capability booleans or the effective role needed to render controls:

- View rows show Details only.
- Collaborate rows show Edit, Run now, and Pause/Resume.
- Owner rows additionally show Delete and sharing management.

Run-history reads become access-aware by resource id. Compatibility inputs using name/scope may remain where existing integrations require them, but they resolve to a resource before authorization and never infer permission from caller-selected scope.

### Acquisition remains unchanged

Automatic schedule acquisition, event acquisition, and manual run acquisition remain separate. Sharing changes who can discover or request an operation; it does not change when triggers fire or which identity executes them.

- schedules continue to scan due `jobs/*.md` resources;
- events continue to match registered events, conditions, and creator-owned event metadata;
- run-now continues through the durable run queue and shared background runner;
- every accepted run resolves and revalidates the immutable creator identity.

## UI Design

### Unified list

Remove the Personal and Organization section headers, duplicated loading states, and section-specific create buttons. Keep one page-level **New automation** action and one list sorted consistently by the existing product rule selected during implementation.

Each row contains:

- name, trigger, enabled/paused state, last status, schedule/event summary, instruction preview, and next/last run;
- one access label from the row-level visibility rules;
- a specific-user count and compact avatars for owned Specific people rows;
- only the actions permitted by the server-returned effective role.

List errors are inline and must distinguish an unreadable list from a valid empty list.

### Editor sharing section

The Sharing section appears in both create and edit:

- radio/card choices for Personal, Organization, and Specific people;
- Organization explains that all members receive View only;
- Specific people uses an account picker, not a free-form invite field;
- each selected account has a View/Collaborate role picker;
- outside-organization accounts have a clear label;
- selecting Collaborate for any outside-organization account reveals the required acknowledgement;
- no Public option, copy-link tab, or unauthenticated access copy is shown.

Only the owner can edit the Sharing section. A collaborator opening Edit sees definition fields only, with sharing either summarized read-only or omitted from the editable controls.

### Optimistic behavior and errors

List mutations are optimistic:

- pause/resume updates the row immediately;
- edits update the cached row on success and retain the prior row for rollback;
- sharing updates immediately refresh the row's access badge, avatars, and capabilities;
- delete removes an owner row optimistically only after destructive confirmation.

Every optimistic mutation stores an exact prior cache snapshot and restores it on error. The active dialog or row shows the server error inline. A failed save does not close the editor, clear selected users, or display a success-like empty state.

## Security and Privacy

- Public sharing is intentionally excluded in both UI and server validation.
- The server verifies that every specific-user target is an existing account.
- Account search returns only the minimum fields needed by the picker and requires authentication.
- Outside-organization Collaborate is rejected without explicit acknowledgement.
- Organization membership grants View only and is checked against actual membership, not merely the caller's active organization selection.
- Collaborators cannot delete, change grants, change visibility, replace `createdBy`, change `runAs`, or retarget run history.
- Run-now authorization is evaluated for the caller, then execution identity is independently resolved from the resource creator.
- Revoked users cannot retain access through stale name/scope inputs.
- Share and definition writes use parameterized, dialect-portable SQL and transactions.
- Notifications, if added later, are a separate product decision; this design does not require invitation email delivery.

## Localization and Documentation

All new visible copy belongs in the core English message catalog and the existing supported locale catalogs. Placeholders and plural/count variants must stay aligned, and the account picker and acknowledgement must be RTL-safe.

Update the canonical automations skill and automation documentation to describe:

- the unified list;
- Personal, Organization, and Specific people;
- View and Collaborate permissions;
- outside-organization acknowledgement;
- no public links;
- creator-bound execution;
- legacy organization-visible compatibility.

Matching localized automation docs must be updated when the English source meaning changes.

## Acceptance Criteria

1. One list shows owned, organization-visible, and specifically shared automations without Personal/Organization sections.
2. Each row has the correct Personal, Organization, Shared with you role, or owned specific-user summary.
3. View users can list and inspect details/status/history but cannot mutate.
4. Collaborate users can edit, pause/resume, and run now but cannot delete or manage sharing.
5. Owners can perform all operations, including delete and sharing management.
6. Organization visibility grants View to current members only.
7. Specific-user search supports any existing account and labels outside-organization accounts.
8. Outside-organization Collaborate cannot be saved without explicit acknowledgement.
9. Public visibility and public links are unavailable and rejected server-side.
10. Definitions remain in `jobs/*.md`; sharing is stored in a resource-id overlay.
11. Automatic, event, and manual acquisition behavior is unchanged.
12. All runs, including collaborator-requested run-now, execute as the immutable creator.
13. Legacy organization-owned jobs remain organization-visible without destructive migration.
14. `manage-automations` and direct UI actions return and enforce identical access decisions.
15. Definition and sharing writes are atomic; failed optimistic updates roll back and surface inline errors.
