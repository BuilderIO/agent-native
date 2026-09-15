---
record_type: "capability"
spec_version: 2
id: "content.query.object"
name: "Reusable Query objects"
user_promise: "A one-off inline Query can be promoted into a named reusable Content object that behaves like a dynamic Database without owning its source records"
primary_user_job: "Define a reusable live collection across one or more authorized inputs without copying or taking ownership of their records."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  ["content.expression.language", "content.access.visibility-closure"]
related_features:
  [
    "content.feature.make-the-workspace-yours",
    "content.feature.connect-your-sources",
    "content.feature.work-across-every-workspace",
    "content.feature.sketch-connections-keep-whats-true",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Inline and named Queries derive access-scoped typed collections with stable output contracts, composable inputs, explicit write-through and creation routes, and no ownership of source records."
proof_requirements:
  [
    "Stable inline/named Query identity, typed AST, variables, output schema, history, reference, embed, and template behavior",
    "Access-first composition of Databases, Sources, and Queries with cycle, scale, stale, and unavailable states",
    "Canonical provenance plus unambiguous field write-through and explicit creation routes",
    "Visual editor and agent manipulation of the same validated typed representation",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Reusable Query objects

## Why this exists

People often need a live collection whose members come from several places or satisfy reusable conditions. Copying those records into another Database creates stale duplicates and ambiguous ownership. A Query composes the originals while keeping their identity, permissions, and write authority intact.

## Example workflow

A team combines Blog articles and Resources, aligns each source's title field into one output called `Title`, filters to published material, and renders the result as a List. The inline result can be saved as a named Query, embedded on another Page, and reused by a later Query. Editing an article title writes to that article's canonical owner; the aligned `Title` definition remains Query-owned presentation.

## Product contract

- A Query derives a typed collection from Databases, approved Sources, other Queries, or access-scoped graph traversal.
- Its definition may include unions, joins, intrinsic filters, projected fields, aliases, computed fields, output types, variables, documentation, limits, and ordering that is part of the result's meaning.
- Query filters define the reusable input contract. A View may filter that result further but can never unfilter records the Query excluded.
- One-off Queries may remain inline in a View or Block. **Save as Query** gives the same typed definition stable identity, title, description, access, history, discoverability, references, embeds, templates, Views, and Query-as-input reuse.
- A named Query owns its AST, variables, output-field identities, aliases, computed fields, documentation, compatible default renderers, and history.
- Input Databases and Sources exclusively own canonical records, memberships, schemas, stored values, source permissions, and provider write authority.
- Every result retains canonical record identity, source provenance, stable field mapping, freshness, access, and write capability.
- The visual builder and agents manipulate the same validated typed AST. Faux SQL or a typed inspector may help power users, but there is no separate AI-only query language.
- A Query's complete definition is visible to its readers. It never runs with its owner's authority; each dependency and result is evaluated for the current viewer.

## Editing and creation

- An ordinary mapped field may write through only when canonical record identity, field mapping, actor permission, source policy, and provider capability are unambiguous.
- Computed fields, aggregates, lossy alignments, and ambiguous joined fields are read-only.
- A Query declares zero or more permitted creation routes that end at writable Databases or Sources. A Query never pretends to own new rows.
- When exactly one route applies, creation proceeds with safe defaults and contextual seeds. When several apply, the View may choose an allowed default or Content asks for a compact destination choice. With no route, the Query is truthfully read-only.
- Human, agent, automation, and API creation use the same route analysis and committed Action.

## Failure and scale behavior

- Missing access at any dependency is applied before evaluation. The Query does not borrow owner credentials or leak excluded records through counts, groups, aggregates, errors, or metadata.
- A required inaccessible, stale, or unavailable dependency produces a typed degraded or Unavailable state according to the Query contract; it is never silently pruned into a plausible partial answer.
- Query-to-Query composition performs dependency and cycle analysis before save.
- Pagination, limits, traversal bounds, aggregation bounds, and cancellation prevent one reusable Query from becoming an unbounded background job.
- A failed write-through or mixed provider outcome remains distinguishable from a successful read-only result.

## Boundaries and non-goals

- A Database owns a governed writable collection; a Query derives a collection; a View presents and downstream-filters either input.
- An ordinary Database View does not hide a named Query beneath it. **Create Query from this View** is an explicit builder flow that confirms sources, output schema, variables, and write behavior.
- Query output aliases never rename source fields, and computed output never becomes stored source data by implication.
- Saving a Query does not materialize or duplicate its records.
- A Query is not an access grant. If someone needs a fixed result that recipients may see without source access, they create an explicitly published/materialized snapshot.

## Acceptance stories

### Promote an inline Query without copying records

Given an inline Query over two Databases, when an editor chooses **Save as Query**, then the definition gains stable identity and the original occurrence references it while every result still points to its canonical source record.

### Preserve authority during composed writes

Given a result with one mapped source field, one computed field, and two possible creation routes, when an editor changes each field and creates a record, then the mapped edit follows its authorized owner, the computed edit is refused, and creation uses an explicit permitted destination rather than guessing.

### Re-evaluate for every viewer

Given a shared cross-workspace Query whose readers have different source access, when each opens it, then both see the full definition but only their authorized result intersection. Counts, aggregates, and nested Queries reveal no inaccessible records.

### Fail honestly on a broken dependency

Given a required nested Query becomes unavailable or cyclic, when the parent evaluates, then it reports the typed dependency failure and preserves the saved definition instead of returning a clean-looking partial or empty result.

## Current evidence

Existing filters, saved Views, source federation, row-union, joined-detail, and write-routing code provide useful donor machinery. They do not yet prove one reusable Query object, a common typed AST, Query-as-source composition, access-first nested evaluation, explicit output contracts, or the complete write/create model. This Capability remains `approved_shape`.

## Proof plan

1. Build equivalent inline and named Queries through visual controls and agent Actions; compare their typed AST and output schema.
2. Compose Databases, provider Sources, graph traversal, and nested Queries with aliases, computed fields, variables, joins, unions, limits, and cycle checks.
3. Verify record/field provenance, mapped writes, read-only derived fields, zero/one/many creation routes, defaults, validation, Events, and retries.
4. Run every Query under differing Page, Database, Source, row, field, and workspace access and verify access before all computation.
5. Exercise unavailable, stale, partial-provider, scale-bound, cancellation, and recovery behavior without losing the saved definition.
6. Link, embed, template, version, export, and reuse the named Query through the real interface and shared Actions.

## Open questions

The stable `content.view.source-query` ID currently names the cross-source specialization even though it is semantically a Query. Preserve it until a deliberate normalization supplies a replacement ID. The internal common query engine may eventually deserve a private substrate record, but it must not become a fourth user-facing object beside Database, Query, and View.
