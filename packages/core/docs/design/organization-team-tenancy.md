# ADR: Opt-In Organization Teams With First-Class Resource Tenancy

Status: Proposed

Date: 2026-09-23

## Context

Organizations are the current tenancy boundary. Some organizations need teams
without changing organizations that do not use teams.

A phased ownership model would give durable resources incompatible scope rules.
It would also make later migration ambiguous. Resource-family enablement can be
phased instead. Each enabled family needs a complete tenancy contract.

## Decision

Add opt-in, first-class teams inside organizations. Each enabled resource family
has a complete tenancy contract. Creating the first team opts an organization
into teams. Organizations without teams retain current behavior.

`teams` and `team_members` are dedicated durable records. Governance,
offboarding, resource scope, and access are defined in the Authority Boundary
Map.

Do not use scheduling-domain teams or generic sharing groups as this tenancy
model.

## Authority Boundary Map

| Surface | Authority | Boundary |
| --- | --- | --- |
| Organization and team membership | Organization owners/admins govern every team; team leads manage membership in their own team. | Membership requires organization membership; a lead has no authority over another team. |
| Durable resources and scope | One personal, organization, or team scope; one human owner. | Scope is durable and distinct from human ownership. |
| Resource visibility and sharing | Scope and grants enforce shared access. | Scope does not change existing ACL. |
| Inherited organization resources | The organization resource remains authoritative. | Team views can include organization-visible resources and private organization resources shared with that team; there are no copies or deny overrides. |
| Connections and integrations | Organization owns credentials; owners/admins manage team and app grants. | Team use requires current app, team, execution-scope, and actor authorization. |
| Durable runs and external effects | Current authority governs each point of work. | Resume and external effects revalidate authority; accepted external effects cannot be cancelled. |
| Active team selection | The server validates requested scope. | Selection filters lists and defaults placement; it never grants authority. |
| Team archival | Organization admins archive teams. | Archival retains history, revokes team-derived authority, and never deletes inherited organization resources. |

## Team Governance

Team membership requires organization membership and has `lead` and `member`
roles. Team membership never grants organization membership.

Users may belong to multiple organizations and retain one active-organization
selection. Each team belongs to one organization. A user may belong to zero or
more teams across organizations where they have active membership.

Organization owners and admins administer every team, including lead changes.
Only they can invite a person to the organization or create or delete a team.
Within their own team, a lead can add existing organization members. A lead can
remove ordinary members and promote members to lead. A lead cannot demote or
remove another lead using the lead role alone. A lead has no authority over
another team.

Teams may have zero or more leads. Organization owners and admins govern a
leadless team. Leaving, removing, or offboarding a lead never requires a
replacement lead. The operation atomically removes that person's team
memberships and revokes their team-derived access. Existing organization
offboarding safeguards remain in effect.

## Resource Scope

Each enabled family stores a durable `ownershipScope`: `personal`,
`organization`, or `team`. Adding teams changes no pre-existing row. Its human
owner, scope or effective legacy scope, organization association, visibility,
ACL, and behavior remain unchanged. No implicit migration backfill or
reclassification occurs.

Personal scope can retain a nonnull `orgId`. That value records organization
association for the existing personal-resource ACL. It does not create
organization ownership or a new scope.

`orgId` alone records an existing organization association. It is not
organization ownership or a new scope. Team membership and active-team
selection do not alter existing ACLs. Team-principal grants apply only to new
organization- and team-scoped resources. There is no legacy team principal.

Organization and team scope require `orgId`. Only team scope has a nonnull
`teamId`. That team must belong to the `orgId`.

A team-scoped resource is one organization-owned resource associated with that
team. Its human owner remains separate. Team association alone does not grant
every organization member read access; visibility and grants govern access, and
existing organization visibility remains additive.

Scope is distinct from the human owner (`owner_email` or the family equivalent).
The creator is the initial human owner in every scope. Offboarding can transfer
that owner without changing scope. A resource has one scope and no cross-team
ownership. Access follows the visibility and grants below.

The departing creator's resources persist. Organization and team resources
remain manageable by an organization owner or admin. The successor manages
transferred personal resources.

Organization offboarding retains the current ownership-transfer rule. A
departing member's personal resource transfers when its `orgId` matches that
organization. It transfers to the designated active successor in that
organization. Its `ownershipScope` and `orgId` stay unchanged. Personal
resources with a null `orgId` stay with the departing member.

Organization- and team-scoped resources retain their scope when their human
owner transfers to the successor. Historical creator attribution does not
change. This owner transfer is not a resource-scope move.

### Create Grants

For each enabled family or action, creates require create authorization and a
validated target scope. A personal target requires the actor. An organization
target requires an organization member. A team target requires a team member.
Organization owners and admins can also target teams. Team leads receive no
special create grant.

Ordinary team members can create resources in their team when that family or
action allows it. They become the human owner.

### Scope Moves

Scope changes are explicit audited moves. They are never shares. Generic Core
moves exist only for authored resource families that explicitly declare move
support, including linked-data and share effects. Credentials, history and
runs, team-bound context, and other operational records are excluded. A
personal owner can move into an organization or team only with target create
access. An organization owner or admin must authorize any move out of or
between organization or team scopes. Cross-organization moves are prohibited.

Team-bound records cannot move out of team scope. A move preserves the human
owner. For a move into an organization or team, an existing `orgId` must match
the destination organization. A team target must belong to that organization.
A personal destination belongs to that owner.

### Share Validation

Validate existing shares during a move. Reject incompatible grants rather than
silently dropping them.

## Resource Access

Every list and direct access path, including by-ID access, validates resource
scope and fails closed before evaluating human-owner, admin, public,
organization, or share grants.

Extend `accessFilter` and the share-principal model with a first-class `team`
principal. Team membership alone gives viewer access to team-scoped resources.
It does not grant resource ownership or administration.

The human owner can read, edit, manage shares and visibility, and delete. An
explicit editor can edit. An explicit resource admin can edit and manage shares
and visibility. That admin cannot move scope or delete using that grant alone.

Organization owners and admins can read, edit, manage shares and visibility,
delete, and move every organization or team resource. They do not need team
membership. Team leads retain only membership-management authority and normal
resource grants.

Creator and explicit-share access to an organization or team resource requires
current membership in its owning organization. All organization-derived access,
including organization visibility and organization-principal shares, requires
current membership in the resource's owning organization for both list and
direct access. Direct explicitly shared cross-team readers work. Existing
independent user-share behavior remains governed by its existing rules.
Team-principal access is re-evaluated from current membership. It ends
immediately when organization membership becomes inactive, including when
`federationRemovalPendingAt` is set, even if the team-membership row remains.
This is revocation; membership-row cleanup may happen later and does not delay
revocation.

Organization visibility gives read access to every organization member. This
includes all team members, regardless of active team. Selected team readership
uses team-principal grants on a private organization resource. These grants add
their granted read or write role. They never subtract organization visibility.

Membership is checked at access time. Team configuration can add or override
its own configuration. It cannot mutate organization defaults.

### Connections

Only an organization owner or admin can grant team and app use of an
organization-owned connection. Credential resolution checks connected status,
app grant, current team grant, execution scope, and actor authority. Secrets
never enter prompts, state, or logs. A cross-team resource share is not a
connection grant. Revocation stops later use; it cannot cancel an external
request already accepted.

### Durable Runs and External Effects

Durable user runs persist the initiating actor and organization/team scope.
Revalidate current authority at resume and before each external side effect.

Organization- and team-scoped schedules use a separately governed, revocable
automation identity with current scoped authority and grants. Personal
creator-run schedules retain creator authority; creator departure does not
transfer schedule authority.

On revoked principal authority, stop with an explicit outcome. A blocked
schedule requires organization-admin review or reassignment; an already
accepted external effect cannot be cancelled.

### Active Team Selection

Selection filters lists and defaults new-resource placement. Direct reads and
edits use actual resource ownership and grants, independent of selection.
Independent authorized resource links still work. Creates and moves use an
explicit, server-validated target scope. A stale, foreign, or archived team
selection fails explicitly and never silently defaults placement. No team
selection preserves existing personal and organization placement. The canonical
selection is in URLs and deep links, mirrored in application state for agent
context, and sent with action requests in a header or body.

## Team Archival

Team deletion is archival. Retain a tombstone with its stable identifier and
history. Archive is blocked until live team resources, context, automations,
and grants are explicitly resolved and blockers are shown. An authorized,
audited operation can move only eligible authored resources. It must preserve
the moved resource's compatible independent grants, organization or public
visibility, and independent resource links. It never auto-moves or deletes an
authored resource. Remove or retain immovable team-bound records by their
family policy. Stop or reassign automations, revoke grants, and remove live
team context and learning. Inherited organization resources are not blockers.
Atomically recheck all blockers before archival.

Archival revokes team-principal grants and team connection-use permissions. It
disables new team-scoped work. Team-derived links and authority then fail.
Immutable historical records may retain the archived stable team ID. It does
not delete inherited organization resources.

Records defined by their team, such as team context or team learning, require
team scope and a valid `teamId`. They cannot be personal or organization
resources, even if their creator owns them as a human. A family can still have
separate personal context or learning records.

## Resource-Family Enablement

Core implementation completes first. Then every template, including Content,
implements team support and proves its complete contract locally. Team scope is
opt-in per family and disabled by default until that family's migration and
complete checks pass.

Rollout inventory to assess for phased enablement; it does not enable every
item:

- chats, threads, runs, and artifacts
- activity, instructions, context, memory, skills and bundles, docs, dashboards,
  and saved artifacts
- automations and their history

Organization-owned connection visibility is assessed separately from resource
families and remains governed by its team and app grants.

Before enabling a family, complete its inventory and focused local tests. They
cover every read, list, search, export, item, mutation, sharing, and legacy
HTTP path. They also cover background, agent, and automation paths. Every flow
must apply the trusted scope. Neither an action request nor application state is
authority. Content additionally proves transclusion, traversal, embeds,
projections, caches, snippets, counts, pagination, search, export, AI, and
background surfaces.

The additive migration must be complete and its scope known.

Families with pre-existing rows retain their owner, effective legacy scope,
organization association, visibility, ACL, and behavior. After migration, only
an explicit, audited supported move changes a resource's scope. Shared access
preserves existing personal and organization behavior. No deployment or
live-server compatibility gate is required to complete this work.

Incomplete migration, missing family registration, or unknown scope fails
closed before grants are evaluated. While a family is disabled, deny access to
team-scoped rows and team-principal grants. Also deny team-scoped creation and
moves into team scope. Do not coerce existing rows to personal or organization
scope.

## Consequences

- Explicit audited moves and share validation add product and operational work,
  but prevent sharing from silently changing ownership.
- Organization-owned credentials require separate team and app grants, which
  adds revocation coordination but keeps secrets out of team ownership.

## Deferred Work And Required Follow-ups

1. Map and secure ownership, sharing, background, and agent paths before
   enabling each resource family.
2. Build additive migrations plus resource-move UX and durable audit history.
3. Build team administration, membership, navigation, active-team URL, and
   agent-context UI.
4. Add focused tests and guards that prevent unscoped resource access and
   verify organization, team, and inherited-resource visibility boundaries.

## Maintained Implementation Baseline

This appendix names the current implementation seams to inspect when updating
this ADR. It is a baseline, not a task tracker.

- Organization roles and membership schema: `packages/core/src/org/types.ts`,
  `packages/core/src/org/schema.ts`
- Shared access filtering and share principals:
  `packages/core/src/sharing/access.ts`
- Resource HTTP handlers: `packages/core/src/resources/handlers.ts`
- Durable runs and resumption: `packages/core/src/agent/run-manager.ts`,
  `packages/core/src/agent/run-store.ts`,
  `packages/core/src/agent/run-loop-with-resume.ts`
- Organization-owned connections:
  `packages/core/src/workspace-connections/store.ts`

## Revisit Criteria

Reconsider this model only if product requirements need multi-team ownership,
team-owned credentials, deny or hide inheritance semantics, or organization
admin behavior scoped below the whole organization.
