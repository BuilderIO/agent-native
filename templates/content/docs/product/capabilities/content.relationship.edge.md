---
record_type: "capability"
spec_version: 2
id: "content.relationship.edge"
name: "Typed Relationships"
user_promise: "One typed edge substrate powers relation Properties, inline typed Page references, backlinks, Info, graph queries, and Graph editing"
primary_user_job: "Connect two Pages once, give that connection a useful meaning, and manage it consistently from any Content surface."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.object.page",
    "content.object.reference",
    "content.property.typed",
    "content.access.page-database",
    "content.event.committed",
  ]
related_features:
  [
    "content.feature.living-references",
    "content.feature.run-projects-your-way",
    "content.feature.plan-work-across-time",
    "content.feature.sketch-connections-keep-whats-true",
  ]
roadmap_boundary: "feature"
acceptance_summary: "People can create, inspect, edit, bulk-remove, restore, and query one canonical Relationship through every authorized surface without duplicated truth, silent partial mutation, access leaks, or lost concurrent history."
proof_requirements:
  [
    "Canonical identity and projection parity across Relation Properties, Connections, inline references, Graph, Canvas promotion, agents, Rules, imports, and Sources",
    "Directional cardinality, uniqueness, local-to-governed lifecycle, deletion, bulk mutation, and causal concurrency behavior",
    "Access-first traversal and aggregation plus identical permission decisions through UI and Actions",
    "Real-interface keyboard, accessibility, recovery, and Undo workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Typed Relationships

## Why this exists

People encounter connections in many places: a Relation column, an `@` mention, a backlink, a project dependency, a Graph edge, or a line drawn on a Canvas. If each surface stores its own version of the connection, the workspace develops several incompatible kinds of truth.

Content instead stores one canonical typed Relationship between stable Page identities. Relation Properties, Info, Queries, Graph, Canvas, agents, Rules, imports, and source adapters are projections and editing routes over that same edge.

## Example workflow

A team has a Tasks Database and a Projects Database. Adding a `Project` Relation Property to Tasks creates a local Relationship type and its first visible projection. A task editor connects a task to a project from the cell. The project immediately shows the inverse connection in **Info → Connections**, and an optional inverse Relation Property can expose the same edge as an editable `Tasks` column.

Later, the team selects several tasks and assigns the same project in one bulk edit. Removing the `Project` column does not erase those relationships. If the team truly wants to remove both the column and its knowledge, the removal dialog offers **Remove Property and its N relationships**, reports the exact authorized impact, commits one Revision, and supports Undo.

## Product contract

### One relationship, many projections

- Every semantic Relationship is one durable edge between stable Page IDs.
- Both directions are always access-scoped and queryable. Content has no semantically one-way relationship whose inverse disappears from the system; people decide only where each direction is displayed and editable.
- A directional Relationship type has a forward label and an optional inverse label. A symmetric type such as `Related to` has one canonical unordered edge, not two mirrored writable values.
- A Relationship type and a visible Relation Property have separate stable identities. The type owns meaning, labels, per-direction cardinality, target constraints, provenance policy, and governing scope. The Property is one Database's editable projection of that type in one direction.
- Databases own Relation Properties, not Relationships. Pages may be related without belonging to a Database, and removing a Property does not make the underlying edge anonymous or inaccessible.
- Every editing surface invokes the same typed Relationship Action. No UI, agent, Rule, import, provider, Graph, or Canvas receives a private mutation engine.

### Where people manage relationships

- Adding an ordinary Relation column creates a local Relationship type and its first Property projection. It feels like adding any other column; no catalog ceremony is required.
- **Info → Connections** is the universal relationship surface. It shows every accessible incoming and outgoing connection, including types not exposed as columns.
- A Relation picker may use a Database or Query to narrow candidates, but the stored endpoint is the selected Page's stable ID. The edge remains if that Page later leaves the picker Query.
- Ordinary Page mentions and transclusions create system-managed structural edges with their own mutation rules. An advanced inline action may create a semantic typed reference. Removing one anchored mention does not delete an independently asserted semantic Relationship.
- In freeform Canvas mode, a drawn connector is view-local brainstorming state until someone explicitly promotes it to a Relationship type. In semantic Graph mode, the active edge tool requires a Relationship type before drawing commits an edge.
- Existing relationships may be projected as Graph or Canvas lines. Deleting the visual occurrence or removing an object from one View never deletes the canonical Relationship.

### Local and governed definitions

- A local Relationship type belongs to the Content space where it was created and remains resolvable in Connections after its last visible Property is removed.
- **Save as Custom Property** promotes the definition into the governed Custom Properties catalog at an allowed Personal, Workspace, or Organization scope.
- Another Database may adopt the governed Property, creating another projection of the same Relationship type rather than copying its semantic identity.
- Each projection may choose a local display alias, formatting, renderer, and visibility without changing the shared definition.
- **Detach to local Property** preserves the projected data while creating an independent local definition.
- Shared definitions are version-pinned. Label, cardinality, constraint, or inverse changes are proposed as readable updates that consuming Database owners adopt explicitly; catalog edits never silently rewrite every relationship system.
- Provider-backed Relation fields use the same projection model while retaining source identity and synchronization authority.

## Cardinality and identity

- Cardinality is defined independently in each direction. A Task may have one Parent task while a parent has many children; a symmetric `Related to` type may be many-to-many.
- Requiredness is separate Database/Property validation. `At most one` does not mean `must have one`.
- Selecting a new target in a single-value Relation Property replaces the observed existing edge as one atomic change.
- Moving a one-to-one target that is already related elsewhere requires an explicit replacement confirmation and permission to remove the old edge as well as create the new one.
- Tightening a type from many to one never deletes existing edges. Existing violations become **Needs attention**; new mutations cannot worsen them, and authorized owners can resolve a filtered set.
- A directional type permits at most one live edge for the same type, source, and target. Adding it again is idempotent. Symmetric types treat `(A, B)` and `(B, A)` as the same pair.
- Different Relationship types remain independent, and reversed directional edges may coexist. Cycle rules are explicit validation on types or workflows, not deduplication and not a universal ban.
- Self-relationships are disabled by default and can be enabled as an advanced Relationship-type option.
- Repeated anchored citations or mentions retain their own occurrences and history while Connections may summarize them as one Page-to-Page relationship.
- A connection that needs several independent instances with dates, roles, or state becomes an intermediate Page with Properties rather than several indistinguishable parallel edges.

## Permissions and authority

- Editing a forward Relation Property requires **Can edit entries** in the Database owning that projection, access to the target Page, permission to use the Relationship type, and satisfaction of its constraints.
- An explicitly editable inverse Relation Property grants the matching inverse-side editing route. An inverse shown only in Connections remains read-only from that side.
- On an ordinary Page, **Can edit** permits outgoing directional Relationship changes through Connections. Incoming directional edges remain read-only unless the actor also has an authorized source-side or editable-inverse route.
- A symmetric Relationship may be changed through an authorized edit route on either endpoint.
- Seeing an endpoint or an incoming edge never grants authority to sever it. Owning a Relationship type does not grant access to every private edge that uses it.
- Same-Organization cross-Workspace edges may be allowed by policy. Cross-Organization canonical edges are prohibited by default until federation can preserve both organizations' access, deletion, and governance guarantees.
- Source-managed edges additionally obey the Source's **View only**, **Keep in sync**, or **Review before write-back** policy and provider capabilities. A local relationship pointing to a source-backed Page does not automatically become provider-owned.
- Counts, rollups, graph degree, Queries, expressions, agents, inverse projections, exports, and graph traversal are computed only over edges and endpoints the viewer may access. Physical inverse indexes may improve performance but never become a second truth.

## Bulk operations, deletion, and concurrency

- Multi-cell selection, row bulk edit, paste/fill, and filtered selection may add Relationships. Delete/Backspace, **Clear relationships**, target removal, and filtered bulk editing remove the exact selected edges.
- Bulk mutation preflights the complete selection. Ambiguous input or mixed permissions never produces a silent partial commit. Content identifies conflicts or locked items and lets the person narrow explicitly; an agent may narrow only when that remains faithful to the request and must report skipped scope.
- A filtered bulk removal resolves exact edge IDs and activation states when the selection is made. New concurrent matches are not swept in later.
- Removing a Relation Property preserves its Relationships by default. The destructive dialog offers **Remove Property** or **Remove Property and its N relationships**, with an access-scoped impact count, one attributable Revision, and Undo. **Manage relationships** opens a filterable collection before removal.
- Removing an edge removes the activation state the operation observed. A genuinely concurrent authorized addition that the remover did not observe survives. A later removal made after observing that addition wins.
- Re-adding a removed Relationship continues one stable lineage with another activation period. Concurrent duplicate additions converge on that same live lineage.
- Successful single-value replacements serialize through committed-event order so only one target remains live; history and Undo preserve the displaced choices.
- Trashing a Page suspends its active Relationships and restoring it restores them. Permanent deletion retains only inaccessible audit/history evidence.
- Relationship definitions archive rather than cascading deletion across their edges.

## Failure behavior

- Constraint, permission, access, source-authority, and cardinality failures are typed failures, never successful empty results.
- A bulk operation with ambiguous values, mixed authority, or an invalid cardinality change does not half-commit.
- When a one-to-one move cannot remove the old edge, Content leaves both prior states unchanged and explains the required authority.
- Broken, trashed, inaccessible, and permanently deleted endpoints remain distinguishable according to the viewer's authority without leaking private identity.
- Ordinary concurrent convergence does not interrupt people with a conflict dialog. Intervention appears only when no valid authorized state can be committed.

## Boundaries and non-goals

- Relationships do not create a parallel graph datastore, permission model, Action surface, or task-dependency engine.
- Relation Properties are projections, not the owners of the underlying knowledge.
- Graph owns semantic graph layout and editing; Canvas owns intentional spatial arrangement and draft connectors; Queries own access-scoped traversal and result contracts.
- Schedule constraints may interpret dependency Relationships, but this Capability does not calculate critical paths or repair dates.
- Merely drawing a freeform Canvas line does not assert semantic truth.
- A relationship never grants access to either endpoint.
- Provider synchronization is proven separately for each adapter and cannot stand in for the generic Relationship contract.

## Acceptance stories

### Create once and edit from either direction

Given two authorized Pages and a directional Relationship type with forward and inverse projections, when an editor creates the edge from the forward Relation Property and later removes it through the editable inverse projection, then Info, both Properties, Queries, Graph, and the shared Action surface show one canonical edge and one coherent history.

### Preserve knowledge when a column disappears

Given a Relation Property containing several Relationships, when a Database editor removes only the Property, then the Relationships remain visible in authorized Connections and Queries. When the editor instead chooses **Remove Property and its N relationships**, the exact authorized edges are removed in one reversible Revision and newer concurrent edges are preserved.

### Enforce directional cardinality atomically

Given a one-parent Relationship and a bulk paste containing several proposed parents for one Task, when the edit is submitted, then no subset commits and Content identifies the conflicting input. Given one valid replacement, the observed prior parent is replaced atomically and the inverse projection updates.

### Keep authority attached to the route

Given a person who may view both endpoints but may edit only the target Page, when they inspect an incoming directional edge in Connections, then they can see it but cannot remove it unless an editable inverse Property or other authorized route exists. Graph, Canvas, agents, and Rules return the same decision.

### Converge without inventing history

Given one client removes the edge it observed while another concurrently re-adds it, when both commits settle, then the unseen addition remains live, no duplicate appears, and Versions shows the actual removal and re-add. A subsequent informed removal makes the edge inactive.

### Protect private neighborhoods

Given an authorized Page related to an endpoint the viewer cannot access, when the viewer opens Connections, runs a Query, inspects Graph, calculates counts or rollups, or exports the Page, then the private endpoint and its existence do not leak. A known direct reference returns an honest access denial.

## Current evidence

Current code can model and display some relation values, which is useful donor substrate. Relation is not yet a generally user-creatable Property, and the current Notion path treats relations as unsupported. No evidence currently proves the shared type identity, universal Connections editor, bulk/deletion semantics, cardinality, access closure, source policy, or causal concurrency contract. This Capability therefore remains `approved_shape`.

## Proof plan

Proof requires deterministic Action and persistence tests plus real-interface workflows:

1. Create local, governed, symmetric, directional, self-enabled, and source-backed Relationship types; rename and version them without changing stable identity.
2. Create, edit, and remove the same edge through forward and inverse Properties, Connections, inline typed references, Graph, Canvas promotion, agents, Rules, and imports; verify identical permission and Event behavior.
3. Exercise one-to-one, one-to-many, many-to-many, replacement, tightening, cycle validation, duplicate addition, and invalid-target cases.
4. Exercise bulk add/remove, mixed permissions, filtered selection, property-only removal, destructive property-plus-edge removal, Undo, and new concurrent matches.
5. Race add/add, add/remove, replacement/replacement, deletion/restoration, and definition updates; verify one valid live state and complete causal history.
6. Re-run cells, Connections, backlinks, Queries, traversal, Graph, counts, rollups, aggregates, exports, public output, and agent reads under changing access; verify access is applied before computation.
7. Verify keyboard and assistive-technology paths for relation pickers, Connections, impact dialogs, bulk selection, and repair states.

## Open questions

The core product behavior above is settled. Implementation may still choose storage layout, index strategy, causal metadata representation, and exact control placement provided those choices satisfy this contract. Federation must be separately designed before enabling canonical cross-Organization Relationships.
