---
record_type: "capability"
spec_version: 2
id: "content.view.query"
name: "Database and Query Views"
user_promise: "A View is one stable presentation over exactly one Database or Query, with its own downstream filters, layout, and renderer"
primary_user_job: "Present and refine one collection for a particular workflow without changing the collection's identity or upstream meaning."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.query.object", "content.property.typed"]
related_features:
  [
    "content.feature.make-the-workspace-yours",
    "content.feature.see-your-information-your-way",
    "content.feature.understand-what-your-data-says",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Named Views retain stable identity and presentation over one owner input, bind configuration to stable fields, refine but never widen that input, and remain reusable without becoming collections or granting access."
proof_requirements:
  [
    "Stable View identity, one owning Database/Query, default selection, links, embeds, templates, deletion, and copying",
    "Renderer, visible fields, filters, sorts, groups, formatting, layout, and creation-seed ownership",
    "Stable field bindings plus atomic cleanup or truthful degraded state during schema evolution",
    "Access narrowing, shared Action parity, personal/effective state, accessibility, persistence, and recovery",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Database and Query Views

## Why this exists

The same collection can support very different work: quick List capture, a grouped Board, a Calendar, or an analytical Chart. People need to save those presentations without duplicating records, hiding a second collection beneath the screen, or confusing a temporary filter with the Query's meaning.

## Example workflow

A Projects Database has a shared Board grouped by Status and a private List showing only the current person's recent projects. Both are stable Views over the same Database. Changing the List filter does not change the Database or Board, and changing a project so it no longer matches simply moves it out of the List while preserving the record.

## Product contract

- A named View has stable identity and an addressable URL while belonging to exactly one Database or Query.
- A Database or Query selects one default View. A link, embed, template, sidebar pin, or agent may address another named View directly.
- The View owns renderer, visible fields, downstream filters, sorting, grouping, layout, formatting, collapsed state, and safe creation seeds.
- Query filters define the upstream result contract. View filters refine what this presentation shows and can never widen past that input.
- An ordinary View directly over a Database uses its implicit base Query; no hidden named Query is created.
- **Save as new View** creates another View over the same owner. **Save as Query** appears on Query-building surfaces, not as ordinary View promotion.
- **Create Query from this View** may prefill a builder with owner, filters, fields, and sorting, but the person confirms sources, output schema, variables, and write behavior before saving a separate Query.
- A View binds to stable Property and Query-output IDs. Local aliases and formatting remain View-owned; matching display names never create semantic equivalence.
- An embedding occurrence may select a named View and apply occurrence-local presentation overrides without mutating the saved View.
- Deleting a View deletes only its configuration. Copying a View to another input creates a new View and explicitly maps compatible stable fields; a View never silently retargets itself.

## Schema evolution and access

- Renaming a bound field preserves the View automatically.
- Before intentional deletion or incompatible type change, Content gives one compact impact summary. Confirmation applies the schema change and dependent cleanup as one attributable Revision.
- Intentional deletion removes only affected filter leaves, sorts, groups, columns, seeds, or renderer bindings; unaffected configuration remains. Nested groups simplify and empty groups disappear.
- Temporary source unavailability, permission loss, or stale provider schema is not deletion. The View preserves configuration and shows a typed degraded or Unavailable state rather than widening itself.
- A View may be shared or **Only me** and may narrow access below its owner, never widen it. Effective visibility intersects View, Database/Query, Source, row, field, and viewer access.
- Restricting a View protects the saved surface; it does not revoke access someone independently has to the underlying records elsewhere.
- Private View cleanup and impact counts never expose private configuration to a schema editor.

## Boundaries and non-goals

- A View does not own records, source schemas, canonical values, Query variables, or provider write authority.
- View filters control visibility, not validity. Database validation alone decides whether a mutation may commit.
- A View never grants row access or runs with its creator's authority.
- Sidebar is a navigation projection that may render a View; it is not a general View renderer owned here.
- Renderer-specific behavior belongs to each View-family Capability and the shared conformance contract.

## Acceptance stories

### Preserve upstream meaning

Given a Query that admits only published records and two Views with different downstream filters, when one View filter is removed, then it may reveal only other published Query results and never records excluded upstream.

### Survive schema change coherently

Given a View whose nested filter, grouping, and displayed column use one Property, when an authorized editor deletes that Property after one impact confirmation, then only the affected configuration is removed in the same Revision, unaffected settings remain, and Undo restores both schema and View.

### Narrow without granting access

Given an Only-me View over a shared Database and a shared link to another View, when readers open either, then each receives only the intersection they may already access and no View reveals private counts or records.

### Delete presentation without deleting data

Given a named View linked and embedded in several places, when it is deleted, then its configuration and references enter the normal broken/recovery state while the owner Database/Query and canonical records remain unchanged.

## Current evidence

Content already has useful saved Database Views, filters, sorting, grouping, and several renderers. The complete stable View identity, Database-or-Query ownership, private/shared alternatives, typed field bindings, schema-evolution cleanup, occurrence overrides, and renderer-conformance contract are not yet proven end to end. This Capability remains `approved_shape`.

## Proof plan

1. Create, link, embed, pin, copy, delete, restore, and select default named Views over both Databases and Queries.
2. Exercise every shared renderer setting, downstream filter, sort, group, layout, formatting, and occurrence override through UI and Actions.
3. Rename, delete, restore, and change types of local, custom, source, and Query-output fields; verify atomic cleanup versus degraded preservation.
4. Run shared, Only-me, and occurrence-local Views under changing record/field/source access; verify no widening or derived leaks.
5. Verify personal overrides, agent context, creation seeds, reload, concurrent shared edits, accessibility, export, and recovery.

## Open questions

The stable ID `content.view.query` sounds Query-specific even though the accepted concept is a general View over a Database or Query. Preserve the ID until a deliberate normalization provides a replacement. Exact ownership of named-View identity across this record, Shared Views, and Personal View State should remain this record for the generic primitive, with the others adding their focused policy.
