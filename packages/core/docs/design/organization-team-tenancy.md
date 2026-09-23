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

Organization owners and admins administer every team, including lead changes.
Only they can invite a person to the organization or create or delete a team.
Within their own team, a lead can add existing organization members. A lead can
remove ordinary members and promote members to lead. A lead cannot demote or
remove another lead using the lead role alone. A lead has no authority over
another team.

Members can leave. A lead can relinquish or leave only when another lead
remains. Removing the sole lead requires a replacement lead first.

Removing an organization member who is the sole lead in one or more teams
requires a replacement lead in each affected team first; replacements may
differ. The operation then atomically removes their team memberships and
revokes team-derived access. Existing organization offboarding safeguards
remain in effect.

## Resource Scope

Each family stores a durable `ownershipScope`: `personal`, `organization`, or
`team`. For families with legacy personal rows, the additive database default is
`personal`. No personal row backfill or reclassification occurs.

Personal scope can retain a nonnull `orgId`. That value records organization
association for the existing personal-resource ACL. It does not create
organization ownership or a new scope.

Adding teams does not change personal-resource access. Team membership and
active-team selection do not alter personal-resource ACLs. Team-principal
grants apply only to organization- and team-scoped resources. There is no
legacy team principal.

Organization and team scope require `orgId`. Only team scope has a nonnull
`teamId`. That team must belong to the `orgId`.

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

Scope changes are explicit audited moves. They are never shares. A personal
owner can move into an organization or team only with target create access. An
organization owner or admin must authorize any move out of or between
organization or team scopes. Cross-organization moves are prohibited.

Team-bound records cannot move out of team scope. A move preserves the human
owner. For a move into an organization or team, an existing `orgId` must match
the destination organization. A team target must belong to that organization.
A personal destination belongs to that owner.

### Share Validation

Validate existing shares during a move. Reject incompatible grants rather than
silently dropping them.

## Resource Access

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
current membership in its owning organization. Direct explicitly shared
cross-team readers work. Team-principal access is re-evaluated from current
membership. Team removal revokes team-derived access, not independent grants.

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
edits use actual resource ownership and grants, independent of selection. Deep
links and explicit cross-scope sharing still work. Creates and moves use an
explicit, server-validated target scope. The canonical selection is in URLs and
deep links, mirrored in application state for agent context, and sent with
action requests in a header or body.

## Team Archival

Team deletion is archival. Retain a tombstone with its stable identifier and
history. Delete live team context and learning before archival. Other live
team-scoped resources and automations must move where permitted or be deleted.
Immutable historical records may remain linked to the archived stable team ID
and do not block archival.

Archival revokes team-principal grants and team connection-use permissions. It
disables new team-scoped work. It does not delete inherited organization
resources.

Records defined by their team, such as team context or team learning, require
team scope and a valid `teamId`. They cannot be personal or organization
resources, even if their creator owns them as a human. A family can still have
separate personal context or learning records.

## Resource-Family Enablement

Resource families are enabled in phases. This is not a phased ownership model.
Each enabled family has a complete tenancy contract. Team scope is opt-in per
family and disabled by default.

Rollout inventory to assess for phased enablement; it does not enable every
item:

- chats, threads, runs, and artifacts
- activity, instructions, context, memory, skills and bundles, docs, dashboards,
  and saved artifacts
- automations and their history

Organization-owned connection visibility is assessed separately from resource
families and remains governed by its team and app grants.

Before enabling a family, complete its inventory and focused tests. They cover
every read, list, search, and export path. They cover item and mutation paths,
sharing paths, and legacy HTTP handlers. They also cover background, agent, and
automation paths. Every flow must apply the trusted scope; neither an action
request nor an application-state value is authority.

The additive migration must be complete and its scope known.

Families with pre-existing organization-owned rows must map those rows
explicitly before readiness. After migration, only explicit, audited moves
change a resource's scope. Shared access enforcement rejects an unknown or
mismatched scope. It does not fall back to personal or organization behavior.

A deployment-wide ready capability is separate from persisted feature flags.
It is present only after every live server and worker runs a team-compatible
build. Only then can a family flag enable team scope.

Missing readiness, incomplete migration, missing family registration, unknown
scope, or a partial deployment fails closed. While a family is disabled, deny
access to team-scoped rows and team-principal grants. Also deny team-scoped
creation and moves into team scope. Do not coerce existing team rows to personal
or organization scope.

Rollback must retain a tenancy-aware build. Older handlers cannot safely
process team rows.

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
