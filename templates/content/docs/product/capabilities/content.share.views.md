---
record_type: "capability"
spec_version: 2
id: "content.share.views"
name: "Shared Views"
user_promise: "A shared View gives collaborators a dependable starting presentation while preserving each viewer's existing access and personal exploration."
primary_user_job: "Share a useful way of seeing a collection without changing the records, exposing private rows, or trapping collaborators in my arrangement."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query", "content.access.page-database"]
related_features: ["content.feature.make-the-workspace-yours"]
roadmap_boundary: "feature"
acceptance_summary: "Shared named Views preserve one reusable presentation over a Database or Query; every viewer sees only their authorized intersection, may retain one automatic personal arrangement, and can create explicit named alternatives without forking data or granting source rows."
proof_requirements:
  [
    "Stable shared and Only-me View identity, links, embeds, defaults, revisions, deletion, and personal-arrangement lifecycle",
    "Viewer-specific access intersection across View, owner input, Source, row, field, and current authorization",
    "UI and Action workflows for personal changes, reset, save-as-new, permitted shared updates, and access-safe degraded states",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Shared Views

## Why this exists

Teams need a dependable shared starting point, but a collaborator's filter,
sort, grouping, density, or column choice should not accidentally rearrange
everyone else's work. Sharing a presentation must also never smuggle access to
the records behind it; a polished View is not a diplomatic passport.

## Example workflow

A team shares a Board over a Database. One person privately filters it to work
assigned to them and changes column widths. Content remembers that one personal
arrangement and marks **Viewing with personal changes**. They can reset to the
shared View, save an explicit Only-me alternative, or—if authorized—update the
shared default. A teammate follows the ordinary shared link and receives the
saved Board definition, not the first person's unnamed arrangement, and sees
only rows they can already access.

## Product contract

### One shared definition, personal exploration

- A shared saved View owns its Database or Query input, renderer, visible
  fields, downstream filters, sorts, groups, layout, formatting, and permitted
  creation behavior. It never owns the input records or Query output contract.
- Each person has at most one unnamed automatically remembered personal
  arrangement for a shared View. It may alter presentation and downstream
  refinement without mutating the shared definition or other viewers' state.
- The focused View Instance carries the immediate effective state while someone
  works. Content quietly indicates when it differs from the shared default.
- **Reset to shared View** removes the personal arrangement. **Save as new
  View** creates a named Only-me or otherwise permitted shared alternative.
  **Update shared View** requires the owning input's relevant edit authority
  and records one reversible attributable Revision.
- Agents may inspect the shared definition, personal arrangement, effective
  View, and delta; they may explore with ephemeral typed Queries without
  changing UI state. They change personal, named, or shared state only when the
  person explicitly asks and authority permits it.

### Sharing narrows or intersects; it never grants rows

- A named View may be shared or **Only me** and may narrow access below its
  owning Database or Query, never widen it.
- Effective visibility is the intersection of View access, Database/Query
  access, Source and row access, field access, and the current viewer's
  authorization. The View never runs with its creator's authority.
- Counts, groups, aggregates, search, source state, field visibility, embeds,
  agents, exports, and creation choices use that same intersection. A View does
  not reveal inaccessible rows by their count or failure shape.
- Restricting a View protects its configuration and surface. It does not revoke
  independent access to the underlying Database, Query, or records elsewhere.
- A fixed output for recipients is a separate explicitly published or
  materialized snapshot capability, not a shared View that grants access.

## Boundaries and non-goals

- Database and Query Views owns generic View identity and presentation;
  Personal View State owns detailed local persistence; this Capability owns the
  shared/personal collaboration policy over that primitive.
- Queries derive collections and output contracts; Views refine and render
  them. A shared View cannot widen a Query or become a second collection.
- This Capability does not define access-granting Views, snapshot publication,
  a second sharing model, or copied private data.

## Acceptance stories

### Share a starting point without sharing a private arrangement

Given a shared View and one viewer's saved personal filters, grouping, and
column sizes, when another authorized viewer follows the ordinary View link,
then they receive the shared definition and their own effective state, never
the first viewer's unnamed arrangement.

### Preserve row access under a shared link

Given two people with different access to rows and fields of a shared View's
input, when each opens the View, searches it, inspects group counts, asks an
agent, or exports it, then each sees only their authorized intersection and no
inaccessible item is exposed through metadata or aggregates.

### Save an alternative without forking work

Given a person changes a shared View's arrangement, when they choose **Save as
new View** with **Only me**, then the new View has its own stable configuration
over the same input, the shared default remains unchanged, and canonical rows
and source authority are not copied or widened.

## Current evidence

Saved Database Views, filters, sorting, grouping, several renderers, and
ordinary access checks are useful substrate. They do not yet prove the complete
one-person arrangement lifecycle, View-configuration narrowing, shared Action
parity, or access-safe outputs across every consumer. This Capability remains
`approved_shape`.

## Proof plan

1. Create shared and Only-me Views; link, embed, pin, select defaults, update,
   reset, save alternatives, delete, restore, and verify Revision history.
2. Exercise one automatic personal arrangement per viewer across filters, sorts,
   groups, layout, formatting, focus, reload, concurrent changes, and agents.
3. Run the full access matrix through direct View reads, rows, fields, counts,
   aggregates, search, embeds, agents, exports, creation, permission changes,
   and source unavailability.
4. Verify keyboard and assistive-technology behavior for personal-change state,
   reset, save, shared update, access denial, and degraded states.

## Open questions

- The exact personal-arrangement storage, conflict resolution for concurrent
  shared updates, and display of the effective-state delta remain open.
- Snapshot publication needs its own capability contract before a fixed output
  can be offered to recipients outside source access.
