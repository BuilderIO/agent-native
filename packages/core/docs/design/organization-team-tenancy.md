# ADR: Opt-In Organization Teams With First-Class Resource Tenancy

Status: Proposed

Date: 2026-09-23

## Context

An organization currently defines the boundary for its data and access. Some organizations need teams. Organizations that do not use teams must keep their current behavior.

Do not phase the ownership model itself. A phased model would give persistent resources different placement rules. It would also make a later data update unclear.

Instead, enable resource families in phases. A resource family is a group of related persistent records. Each enabled family must define its ownership, access, and lifecycle rules.

## Decision

Add opt-in teams as a built-in part of organizations. Each enabled resource family defines its ownership, access, and lifecycle rules.

When an organization creates its first team, it opts into teams. Organizations without teams keep their current behavior.

Store `teams` and `team_members` as dedicated persistent records. The Authority Boundary Map defines governance, offboarding, resource placement, and access.

Do not use scheduling-domain teams or generic sharing groups as this tenancy model.

## Authority Boundary Map

| Surface | Authority | Boundary |
| --- | --- | --- |
| Organization and team membership | Organization owners/admins govern every team. Team leads manage membership in their own team. | Membership requires organization membership. A lead has no authority over another team. |
| Persistent resources and placement | Each resource belongs in exactly one place: personal, organization, or team. Each also has one human owner. | Placement remains separate from human ownership. |
| Resource visibility and sharing | Placement and specific permissions (grants) enforce shared access. | Placement does not change an existing access-control list (ACL). |
| Inherited organization resources | The organization resource remains the source record that governs access. | Team views can include organization-visible resources and private organization resources shared with that team. There are no copies or rules that subtract access. |
| Connections and integrations | The organization owns credentials. Owners/admins manage permissions for teams and apps. | Team use requires authorization for the current app, team, and execution scope (the organization or team context for the work), plus the actor (the person or process making the request). |
| Persistent runs and external effects | Current authority governs each point of work. | On resume, and before an external action, check authority again. An accepted external action cannot be cancelled. |
| Active team selection | The server validates the requested placement. | Selection filters lists and sets the default placement. It never grants permission. |
| Team archival | Organization admins archive teams. | Archival retains history, revokes team-derived authority, and never deletes inherited organization resources. |

## Team Governance

Team membership requires organization membership. A team member has either the `lead` or `member` role. Team membership never grants organization membership.

Users can belong to multiple organizations. Each user keeps one active-organization selection. Each team belongs to one organization. A user can belong to zero or more teams. That user must have active membership in each organization that contains one of those teams.

Organization owners and admins administer every team, including lead changes. Only they can invite a person to the organization or create or delete a team.

Within their own team, a lead can add existing organization members. A lead can remove ordinary members. A lead can promote members to lead. A lead cannot demote or remove another lead through the lead role alone. A lead has no authority over another team.

Teams can have zero or more leads. Organization owners and admins govern a team without a lead. Leaving, removing, or offboarding a lead never requires a replacement lead.

When a lead leaves, one all-or-nothing operation removes that person's team memberships. It also removes that person's access that came from the team. Existing organization offboarding safeguards remain in effect.

## Resource Scope

Each enabled family stores a persistent `ownershipScope`: `personal`, `organization`, or `team`. Scope states where the resource belongs.

Adding teams changes no pre-existing row. Its human owner stays unchanged. Its scope, or its effective legacy scope, stays unchanged. Legacy scope means the placement rules that applied before teams. Its organization association, visibility, ACL, and behavior also stay unchanged. Do not add an implicit data-update backfill or reclassification.

Personal scope can retain a nonnull `orgId`. This value records organization association for the existing personal-resource ACL. It does not create organization ownership or a new placement.

`orgId` alone records an existing organization association. It is not organization ownership or a new placement. Team membership and active-team selection do not alter existing ACLs.

Team-principal grants are permissions assigned to every current member of a team. They apply only in these cases:

- The resource was created in organization or team scope after family enablement.
- The resource was explicitly moved into one of those scopes under Scope Moves.

Pre-existing rows retain their legacy ACL until such a move. There is no team-wide permission under the legacy rules.

Organization and team scope require `orgId`. Only team scope has a nonnull `teamId`. That team must belong to the `orgId`.

A team-scoped resource is one organization-owned resource associated with a team. Its human owner remains separate. Team association alone does not give every organization member read access. Visibility and grants govern access. Existing organization visibility adds access but never removes it.

Scope is separate from the human owner (`owner_email` or the family equivalent). The creator is the initial human owner in every scope. Offboarding can transfer that owner without changing scope. A resource has one scope. It cannot have cross-team ownership. Access follows the visibility and grants below.

The departing creator's resources persist. Organization owners or admins can manage organization and team resources. The successor manages transferred personal resources.

Organization offboarding keeps the current ownership-transfer rule. If a departing member's personal resource has an `orgId` that matches that organization, transfer it to the designated active successor in that organization. Its `ownershipScope` stays unchanged. Its `orgId` stays unchanged. Personal resources with a null `orgId` stay with the departing member.

When a human owner transfers, organization- and team-scoped resources keep their scope. Historical creator attribution does not change. This owner transfer is not a resource-scope move.

### Create Grants

For each enabled family or action, creation requires permission to create and a validated target scope.

- A personal target requires the actor.
- An organization target requires an organization member.
- A team target requires team membership or organization owner/admin authority.

Team leads receive no special create grant.

If a family or action allows it, an ordinary team member can create a resource in that member's team. That member becomes the human owner.

### Scope Moves

Scope changes are explicit moves recorded in the audit history. They are never shares.

Generic Core moves exist only for resource families whose authors explicitly declare move support. This includes linked-data and share effects. Credentials, history and runs, team-bound context, and other operational records are excluded.

A personal owner can move into an organization or team only with target create access. An organization owner or admin must authorize every move out of organization or team scope. That owner or admin must also authorize moves between those scopes. Cross-organization moves are prohibited.

Team-bound records cannot move out of team scope. A move preserves the human owner.

For a move into an organization or team, an existing `orgId` must match the destination organization. A team target must belong to that organization. A personal destination belongs to that owner.

### Share Validation

Validate existing shares during a move. Reject incompatible permissions. Do not silently drop them.

## Resource Access

Every list and direct access path validates resource scope. This includes by-ID access. If the system cannot establish the scope, it denies access before checking human-owner, admin, public, organization, or share permissions.

Extend `accessFilter` and the share-principal model with a built-in `team` principal. A principal is the person or group that receives a permission. Team membership alone gives viewer access to team-scoped resources. It does not grant resource ownership or administration.

The human owner can read, edit, manage shares and visibility, and delete. An explicit editor can edit. An explicit resource admin can edit and manage shares and visibility. That admin cannot move scope through that grant alone. That admin cannot delete through that grant alone.

Organization owners and admins can read, edit, manage shares and visibility, and delete every organization or team resource. They can authorize moves only for supported authored resource families under the Scope Moves rules. They do not need team membership. Team leads keep only membership-management authority and their normal resource permissions.

Creator and explicit-share access to an organization or team resource requires current membership in its owning organization. All organization-derived access also requires current membership in the resource's owning organization. This applies to list and direct access. It includes organization visibility and organization-principal shares.

Direct explicitly shared cross-team readers work. Existing independent user-share behavior remains governed by its existing rules.

Team-principal access is checked again against current membership. It ends immediately when organization membership becomes inactive. This includes when `federationRemovalPendingAt` is set. It ends even if the team-membership row remains. This removes access. Membership-row cleanup can happen later and does not delay the removal.

Organization visibility gives read access to every organization member. This includes all team members, regardless of active team. Use team-principal grants on an eligible private organization resource for selected team readership. These permissions add the granted read or write role. They never remove organization visibility.

Check membership at access time. Team configuration can add or override its own configuration. It cannot mutate organization defaults.

### Connections

Only an organization owner or admin can grant team and app use of an organization-owned connection. Credential resolution checks connected status and app permission. It also checks the current team permission, execution scope, and actor authority.

Secrets never enter prompts, state, or logs. A cross-team resource share is not permission to use a connection. Removing permission stops later use. It cannot cancel an external request that was already accepted.

### Durable Runs and External Effects

Persistent user runs store the initiating actor and organization/team scope. Check current authority again at resume and before each external side effect. An external side effect is an action outside the system that changes something.

Organization- and team-scoped schedules use a separately governed automation identity whose permission can be removed. It has current scoped authority and grants. Personal creator-run schedules keep creator authority. Creator departure does not transfer schedule authority.

If a principal's authority is removed, stop with an explicit outcome. A blocked schedule requires organization-admin review or reassignment. An already accepted external effect cannot be cancelled.

### Active Team Selection

Selection filters lists and sets the default placement for new resources. Direct reads and edits use actual resource ownership and grants. They are independent of selection. Independent authorized resource links still work.

Creates and moves use an explicit, server-validated target scope. If a team selection is stale, belongs to another organization, or is archived, return an explicit failure. Never silently default placement. Without a team selection, keep existing personal and organization placement.

The canonical selection is in URLs and deep links. Mirror it in application state, which stores the current UI selection for agent context. Send it with action requests in a header or body. The request and application state do not prove permission.

## Team Archival

Team deletion is archival, which disables the team but retains its history. Retain a tombstone, which is an archival record that keeps the team's stable identifier and history.

Before archival, explicitly resolve live team resources, context, automations, and grants. Show the blockers. Archive is blocked until they are resolved.

An authorized operation recorded in the audit history can move only eligible authored resources. It must preserve compatible independent permissions on the moved resource. It must preserve organization or public visibility. It must preserve independent resource links. It never auto-moves or deletes an authored resource.

Remove or retain immovable team-bound records under their family policy. Stop or reassign automations. Revoke grants. Remove live team context and learning. Inherited organization resources are not blockers.

Recheck all blockers in one all-or-nothing operation before archival.

Archival revokes team-principal grants and team connection-use permissions. It disables new team-scoped work. Team-derived links and authority then fail. Immutable historical records can retain the archived stable team ID. Archival does not delete inherited organization resources.

Records defined by their team, such as team context or team learning, require team scope and a valid `teamId`. They cannot be personal or organization resources. This remains true even if their creator owns them as a human. A family can still have separate personal context or learning records.

## Resource-Family Enablement

Complete the Core implementation first. Then every template, including Content, implements team support and proves its full ownership, access, and lifecycle rules locally.

Team scope is opt-in for each family. It is disabled by default until that family's data update and complete checks pass.

Use this rollout inventory to assess phased enablement. It does not enable every item:

- chats, threads, runs, and artifacts
- activity, instructions, context, memory, skills and bundles, docs, dashboards, and saved artifacts
- automations and their history

Assess organization-owned connection visibility separately from resource families. Its team and app permissions continue to govern it.

Before enabling a family, complete its inventory and focused local tests. Cover every read, list, search, export, item, mutation, sharing, and existing HTTP path from before teams. Also cover background, agent, and automation paths.

Every flow must use the scope that the server has established. An action request and application state are inputs, not proof of permission.

Content must also prove document inclusion in another document (transclusion), traversal, embeds, derived views (projections), caches, snippets, counts, pagination, search, export, AI, and background surfaces.

The additive data update must be complete, and the scope of each resource must be known. It adds support without removing existing data.

Families with pre-existing rows retain their owner and effective legacy scope. They retain their organization association, visibility, ACL, and behavior. After the data update, only an explicit, supported move recorded in the audit history changes a resource's scope. Shared access preserves existing personal and organization behavior. No deployment or live-server compatibility gate is required to complete this work.

If the data update is unfinished, a resource type is not registered with the access system, or a resource has no known scope, deny access before checking anyone's permissions.

While a family is disabled:

- Deny access to records in team scope and permissions that come from team membership.
- Deny creation in team scope and moves into team scope.
- Do not treat existing records as personal or organization scope to make them fit the new rules.

## Consequences

- Explicit moves recorded in the audit history and share validation add product and operational work. They prevent sharing from silently changing ownership.
- Organization-owned credentials require separate team and app permissions. This adds coordination when permission is removed but keeps secrets out of team ownership.

## Deferred Work And Required Follow-ups

1. Map and secure ownership, sharing, background, and agent paths before enabling each resource family.
2. Build additive data updates plus resource-move UX and persistent audit history.
3. Build team administration, membership, navigation, active-team URL, and agent-context UI.
4. Add focused tests and guards that prevent unscoped resource access and verify organization, team, and inherited-resource visibility boundaries.

## Maintained Implementation Baseline

This appendix names the current implementation seams to inspect when updating this ADR. It is a baseline, not a task tracker.

- Organization roles and membership schema: `packages/core/src/org/types.ts`, `packages/core/src/org/schema.ts`
- Shared access filtering and share principals: `packages/core/src/sharing/access.ts`
- Resource HTTP handlers: `packages/core/src/resources/handlers.ts`
- Durable runs and resumption: `packages/core/src/agent/run-manager.ts`, `packages/core/src/agent/run-store.ts`, `packages/core/src/agent/run-loop-with-resume.ts`
- Organization-owned connections: `packages/core/src/workspace-connections/store.ts`

## Revisit Criteria

Reconsider this model only if product requirements need multi-team ownership, team-owned credentials, deny or hide inheritance semantics, or organization admin behavior scoped below the whole organization.
