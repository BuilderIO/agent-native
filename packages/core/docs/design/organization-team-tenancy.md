# ADR: Opt-In Organization Teams With First-Class Resource Tenancy

Status: Proposed

Date: 2026-09-23

## Context

An organization defines the boundary for its data and access. Some organizations need teams. Organizations without teams must keep their current behavior.

Tenancy defines where a persistent resource belongs. Do not phase in the ownership model. A phased model would give persistent resources different placement rules. It would also make later data updates unclear.

Instead, enable resource families in phases. A resource family is a group of related persistent records. Each enabled family must define ownership, access, and rules throughout each record's lifetime.

Personal scope places a resource with a person. Organization scope places it with an organization. Team scope places an organization-owned resource with one team. Each resource also has a human owner, the person responsible for it. Placement and human ownership are separate.

## Decision

Add opt-in teams as a built-in part of organizations. Each enabled resource family defines ownership, access, and rules throughout each record's lifetime.

When an organization creates its first team, it opts into teams. Organizations without teams keep their current behavior.

Store `teams` and `team_members` as dedicated persistent records. The table below defines who can manage teams, what happens when a member leaves (offboarding), resource placement, and access.

Do not use scheduling-domain teams or generic sharing groups as this tenancy model.

## Who Can Act And Their Limits

| Surface | Who can act | Limits |
| --- | --- | --- |
| Organization and team membership | Organization owners and admins manage every team. Team leads manage members in their own team. | A person must belong to the organization before joining a team. A lead has no permission to manage another team. |
| Persistent resources and placement | Each resource belongs in one place: personal, organization, or team. Each resource also has one human owner, which is the person responsible for it. | Placement and the human owner are separate. |
| Resource visibility and sharing | Placement and specific permissions, called grants, control shared access. | Placement does not change an existing access-control list (ACL), which records who can access a resource. |
| Inherited organization resources | The organization resource remains the source record that controls access. | A team view can include organization-visible resources. It can also include private organization resources shared with that team. The system does not copy resources or subtract access. |
| Connections and integrations | The organization owns credentials. Owners and admins manage permissions for teams and apps. | Team use requires authorization for the app, team, execution scope, and actor. Execution scope is the organization or team context for the work. An actor is the person or process that makes the request. |
| Persistent runs and external effects | Current permissions control each step. | On resume and before an external action, check current permissions again. The system cannot cancel an external action after another system accepts it. |
| Active team selection | The server validates the requested placement. | Selection filters lists and sets the default placement. It never grants permission. |
| Team archival | Organization admins archive teams. | Archival keeps history, removes authority that comes from the team, and never deletes inherited organization resources. |

## Who Can Manage Teams

Team membership requires organization membership. A team member has the `lead` or `member` role. Team membership never grants organization membership.

Users can belong to more than one organization. Each user has one active organization selection. Each team belongs to one organization. A user can belong to zero or more teams. The user must actively belong to each organization that contains one of those teams.

Organization owners and admins administer every team, including lead changes. Only they can invite a person to the organization. Only they can create or delete a team.

Within their own team, a lead can add existing organization members. A lead can remove ordinary members. A lead can promote members to lead. A lead cannot demote or remove another lead through the lead role alone. A lead has no authority over another team.

Teams can have zero or more leads. Organization owners and admins manage a team without a lead. A replacement lead is not required when a lead leaves, is removed, or is offboarded.

When a lead leaves, one operation removes that person's team memberships. It also removes access that came from those teams. If the operation fails, it makes no changes. Existing organization offboarding safeguards remain in effect.

## Resource Scope

Each enabled family stores a persistent `ownershipScope`: `personal`, `organization`, or `team`. Scope states where the resource belongs.

Adding teams does not change resources that already exist. They keep their human owner and placement. Some older records have no stored scope. For those records, keep the placement rules that applied before teams. They also keep their organization association, visibility, ACL, and behavior. Do not automatically update or reclassify them.

Even when a resource belongs to a person, its `orgId` can name an organization. That value records an association used by existing access rules for personal resources. It does not make the organization the owner or change the resource's placement.

`orgId` alone records an existing organization association. It does not mean organization ownership or a new placement. Team membership and active-team selection do not change existing ACLs.

A principal is the person or group that receives a permission. A team-principal grant assigns permission to every current member of a team. These grants apply only in these cases:

- The resource was created in organization or team scope after family enablement.
- The resource was explicitly moved into one of those scopes under Scope Moves.

Existing resources keep their ACL until such a move. Those access rules do not include team-wide permission.

Organization and team scope require `orgId`. Only team scope has a `teamId` with a value. That team must belong to the `orgId`.

A team-scoped resource is an organization-owned resource linked to one team. Its human owner remains separate. The team link does not give every organization member read access. Visibility and grants control access. Existing organization visibility can add access. It never removes access.

Scope is separate from the human owner (`owner_email` or the family equivalent). The creator is the first human owner in every scope. Offboarding can transfer the human owner without changing scope. A resource has one scope. It cannot have cross-team ownership. Visibility and grants control access, as described below.

The departing creator's resources remain. Organization owners or admins can manage organization and team resources. The successor manages transferred personal resources.

Organization offboarding keeps the current ownership-transfer rule. If a departing member's personal resource has an `orgId` for that organization, transfer it to the designated active successor in that organization. Keep its `ownershipScope` unchanged. Keep its `orgId` unchanged. Personal resources with a null `orgId` stay with the departing member.

When a human owner transfers, organization- and team-scoped resources keep their scope. Historical creator attribution remains unchanged. An owner transfer is not a resource-scope move.

### Create Grants

For each enabled family or action, creation requires permission to create and a validated target scope.

- A personal target requires the actor as the target.
- An organization target requires an organization member.
- A team target requires team membership or organization owner or admin authority.

Team leads receive no special create grant.

If a family or action allows it, an ordinary team member can create a resource in that member's team. That member becomes the human owner.

### Scope Moves

Scope changes are explicit moves in the audit history. They are never shares.

Generic Core moves exist only for resource families whose authors declare move support. The family declaration describes what a move does to related data and existing shares. Credentials, history and runs, team-bound context, and other operational records are excluded.

A personal owner can move a resource into an organization or team only with permission to create a resource in the destination. An organization owner or admin must authorize every move out of organization or team scope. That owner or admin must also authorize moves between those scopes. Cross-organization moves are prohibited.

Team-bound records cannot move out of team scope. A move preserves the human owner.

For a move into an organization or team, an existing `orgId` must match the destination organization. A team target must belong to that organization. A personal destination belongs to the resource's human owner.

### Share Validation

Validate existing shares during a move. Reject incompatible permissions. Do not silently remove them.

## Resource Access

Every list and direct access path validates resource scope. This includes access by ID. If the system cannot establish scope, it denies access before checking human-owner, admin, public, organization, or share permissions.

Extend `accessFilter`, the shared access filter, and the share-principal model with a built-in `team` principal. Team membership gives viewer access to team-scoped resources. It does not grant resource ownership or administration.

The human owner can read, edit, manage shares and visibility, and delete. An explicit editor can edit. An explicit resource admin can edit and manage shares and visibility. That admin cannot move scope through that grant alone. That admin cannot delete through that grant alone.

Organization owners and admins can read, edit, manage shares and visibility, and delete every organization or team resource. They can authorize moves only for supported resource families under Scope Moves. They do not need team membership. Team leads have only membership-management authority and their normal resource permissions.

Creator and explicit-share access to an organization or team resource requires current membership in its owning organization. All access that comes from the resource's owning organization also requires current membership in that organization. This applies to list and direct access. It includes organization visibility and organization-principal shares.

Directly shared readers from another team can read when the explicit share allows it. Existing independent user-share behavior keeps its existing rules.

Check team-principal access against current membership each time. It ends when organization membership becomes inactive. This includes when `federationRemovalPendingAt` is set. It ends even when the team-membership row remains. This removes access. Membership-row cleanup can happen later. It does not delay access removal.

Organization visibility gives read access to each organization member. This includes team members, regardless of their active team. Use team-principal grants on an eligible private organization resource for selected team readers. These permissions add the granted read or write role. They never remove organization visibility.

Check membership at access time. A team can add or change its own team-specific configuration. It cannot change organization defaults.

### Connections

Only an organization owner or admin can grant a team or app permission to use an organization-owned connection. The system checks the connection's connected status, app permission, current team permission, execution scope, and the requesting actor's permission.

Secrets never enter prompts, state, or logs. Sharing a resource across teams does not permit connection use. Removing permission stops later use. It cannot cancel an external request that another system already accepted.

### Persistent Runs and External Effects

Persistent user runs store the initiating actor and organization or team scope. Check current permissions again when a run resumes and before each external side effect. An external side effect is an action outside the system that changes something.

Organization- and team-scoped schedules use a separate automation identity with its own permissions. Its permission can be removed. It has only its current permissions for its scope and grants. Personal creator-run schedules keep creator authority. Creator departure does not transfer schedule authority.

If a principal loses authority, stop with an explicit outcome. A blocked schedule requires organization-admin review or reassignment. The system cannot cancel an external effect after another system accepts it.

### Active Team Selection

Selection filters lists and sets the default placement for new resources. Direct reads and edits use the resource's actual ownership and grants. They do not depend on selection. Independent authorized resource links still work.

Creates and moves use an explicit target scope that the server validates. If a team selection is stale, from another organization, or archived, return an explicit failure. Never silently use a default placement. Without a team selection, keep existing personal and organization placement.

URLs and deep links hold the canonical selection. Mirror it in application state, which stores the current UI selection for agent context. Send it with action requests in a header or body. The request and application state do not prove permission.

## Team Archival

Team deletion is archival. Archival disables the team but keeps its history. Retain a tombstone, an archived team record with the team's stable identifier and history.

Before archival, resolve live team resources, context, automations, and grants. Show the blockers. Do not archive the team until they are resolved.

An authorized operation in the audit history can move only eligible authored resources. These resources come from families that declare move support. It must keep compatible permissions that do not depend on the archived team. It must keep resource links that do not depend on that team. It must keep organization or public visibility. It never moves or deletes an authored resource automatically.

Remove or retain immovable team-bound records under their family policy. Stop or reassign automations. Revoke grants. Remove live team context and learning. Inherited organization resources are not blockers.

Recheck all blockers in one operation before archival. If the operation fails, it makes no changes.

Archival revokes team-principal grants and team connection-use permissions. It disables new team-scoped work. Links and authority that depend on the team then fail. Immutable historical records can retain the archived stable team ID. Archival does not delete inherited organization resources.

Records defined by their team, such as team context or team learning, require team scope and a valid `teamId`. They cannot be personal or organization resources. This remains true when their creator is their human owner. A family can still have separate personal context or learning records.

## Resource-Family Enablement

Complete the Core implementation first. Then every template, including Content, implements team support. Each template proves its own rules for ownership, access, and the lifetime of each record locally.

Team scope is opt-in for each family. It is disabled by default until that family's data update and complete checks pass.

Use this rollout inventory to assess phased enablement. It does not enable every item:

- chats, threads, runs, and artifacts
- activity, instructions, context, memory, skills and bundles, docs, dashboards, and saved artifacts
- automations and their history

Assess organization-owned connection visibility separately from resource families. Team and app permissions still govern it.

Before enabling a family, complete its inventory and focused local tests. Cover every read, list, search, export, item, mutation, sharing, and existing HTTP path from before teams. Also cover background, agent, and automation paths.

Every flow must use the scope that the server establishes. An action request and application state are inputs. They do not prove permission.

Content must also prove document inclusion in another document, called transclusion. It must cover traversal, embeds, derived views called projections, caches, snippets, counts, pagination, search, export, AI, and background surfaces.

The additive data update must be complete. The scope of each resource must be known. It adds support without removing existing data.

Families with older records keep their owner and the placement rules that applied before teams. They also keep their organization association, visibility, ACL, and behavior. After the data update, only an explicit supported move in the audit history changes a resource's scope. Shared access keeps existing personal and organization behavior. This work does not require a deployment or live-server compatibility gate.

If the data update is unfinished, deny access before checking permissions. Do the same if the access system does not recognize a resource type. Do the same if a resource has no known scope.

While a family is disabled:

- Deny access to records in team scope and permissions from team membership.
- Deny creation in team scope and moves into team scope.
- Do not treat existing records as personal or organization scope to fit the new rules.

## Consequences

- Explicit moves in the audit history and share validation add product and operational work. They prevent sharing from silently changing ownership.
- Organization-owned credentials require separate team and app permissions. This adds coordination when permission is removed. It keeps secrets out of team ownership.

## Deferred Work And Required Follow-ups

1. Map and secure ownership, sharing, background, and agent paths before enabling each resource family.
2. Build additive data updates, resource-move UI, and persistent audit history.
3. Build team administration, membership, navigation, the active-team URL, and agent-context UI.
4. Add focused tests and guards. They must prevent unscoped resource access and verify organization, team, and inherited-resource visibility boundaries.

## Maintained Implementation Baseline

This appendix names the current implementation seams to inspect when updating this ADR. It is a baseline, not a task tracker.

- Organization roles and membership schema: `packages/core/src/org/types.ts`, `packages/core/src/org/schema.ts`
- Shared access filtering and share principals: `packages/core/src/sharing/access.ts`
- Resource HTTP handlers: `packages/core/src/resources/handlers.ts`
- Durable runs and resumption: `packages/core/src/agent/run-manager.ts`, `packages/core/src/agent/run-store.ts`, `packages/core/src/agent/run-loop-with-resume.ts`
- Organization-owned connections: `packages/core/src/workspace-connections/store.ts`

## Revisit Criteria

Reconsider this model only if product requirements need multi-team ownership, team-owned credentials, rules that deny or hide inherited resources, or organization-admin behavior below the whole organization.
