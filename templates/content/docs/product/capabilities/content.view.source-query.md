---
record_type: "capability"
spec_version: 2
id: "content.view.source-query"
name: "Cross-source Queries"
user_promise: "One visual typed Query composes authorized Databases, Sources, and Queries without copying their records or hiding where values come from."
primary_user_job: "Combine related work from several places into one useful live result while keeping each record's owner, access, and write route clear."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.query.object", "content.source.catalog"]
related_features: ["content.feature.connect-your-sources"]
roadmap_boundary: "feature"
acceptance_summary: "A visual builder composes access-scoped Databases, governed Sources, and Queries with explicit stable-identity alignment and Query-owned outputs; every result retains provenance, and edits or creation route only through declared unambiguous authorized owners."
proof_requirements:
  [
    "Visual and agent editing of one validated typed Query representation with sources, alignment, filters, joins, preview, renderers, scale, and cycle checks",
    "Access-first provenance, source-qualified field identity, aliases/computed outputs, write-through, read-only derived outputs, and creation-route behavior",
    "Lossless migration and compatibility verification from row-union and joined-detail donor machinery without treating either donor UI as the product contract",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Cross-source Queries

## Why this exists

Work often lives in several collections that people need to read together.
Copying it into a third table produces stale duplicates and ambiguous writes.
A cross-source Query provides one visual composition surface while leaving
canonical records, stored values, access, and provider authority with the
Databases and Sources that already own them.

## Example workflow

An editor creates a Query, adds two governed provider collections and a local
Database, then aligns two stable title fields into an output field named
`Title`. They add a relation-based join, a filter, and a Board renderer. Each
result shows its Source provenance. Editing a mapped provider field routes only
to its authorized owner; the `Title` alias and a computed score are Query-owned
output and cannot be mistaken for stored source fields. Creating a new result
uses a declared route or asks which source should own it.

## Product contract

### One visual builder and typed representation

- A Query may compose authorized Databases, catalog-selected Sources, and other
  Queries through unions, joins, relationships, filters, grouping, sorting,
  limits, variables, and compatible renderers without creating a third
  canonical row store.
- The visual builder and agents manipulate the same validated typed Query AST.
  Source selection, field alignment, rules, preview, and rendering remain
  editable through ordinary controls; a textual inspector is optional, not a
  separate authoring language.
- Live preview places ambiguity, access exclusions, stale Sources,
  write-through limits, cycle failures, and scale bounds beside the relevant
  builder stage rather than returning an unexplained empty result.
- Query-as-input remains lazy and access-scoped. Dependency and cycle analysis
  occurs before save; pagination, traversal, aggregation, and cancellation
  bounds prevent unbounded background work.

### Align fields explicitly and retain provenance

- Exact Custom Property or Source Property identities may align automatically.
  Same display names do not establish equivalence: unrelated fields stay
  source-qualified until a person or agent explicitly aligns them.
- A named Query owns stable output-field identities, aliases, computed fields,
  output types, documentation, ordering that is part of result meaning, and
  compatible renderer defaults. Renaming `Title` changes the projection, not
  either source schema.
- Every result retains canonical record identity, source and field provenance,
  freshness, access, and declared write capability. Viewer access applies before
  results, groups, aggregates, counts, errors, and previews are computed.
- A View presents and downstream-refines the Query result. It cannot widen the
  Query contract or turn an output alias into a canonical source field.

### Write and create only through an owner

- An ordinary mapped field writes through only when canonical identity, stable
  field mapping, authorization, Source policy, and provider capability are
  unambiguous. Computed fields, aggregates, lossy alignments, and ambiguous
  joined fields are read-only.
- A Query declares zero or more creation routes terminating in writable
  Databases or Sources. A View may select an applicable declared default but
  cannot invent a destination; zero routes is read-only, one route proceeds,
  and several routes require a permitted default or an explicit choice.
- Existing row-union source identity, guarded writes, per-source bindings,
  joined detail records, and source selection are donor and migration substrate.
  Their specialized configuration surfaces are not the long-term product model.

## Boundaries and non-goals

- A Database owns a writable collection, schema, membership, validation, and
  canonical create route. A Query derives a result and output contract. A View
  presents and refines either input.
- Sources catalog owns governed Source discovery; Source adapters own provider
  operations and policy; this Capability does not create a generic provider API
  or change source ownership.
- A Query is not an access grant, static share, materialized clone, or a way to
  infer field equivalence from names.

## Acceptance stories

### Align separate titles without changing either source

Given two authorized collections expose distinct stable fields both labeled
`Title`, when an editor explicitly aligns them into a Query output called
`Title`, then the output has Query-owned identity while both source fields,
schemas, provenance, and writes remain separate.

### Write only when the route is clear

Given a result with a mapped source field, a computed field, and an ambiguous
joined field, when an authorized editor changes each one, then only the mapped
field reaches its canonical owner; the computed and ambiguous fields remain
read-only with an explanatory state.

### Create through a declared source route

Given a Query with two writable creation routes and a View with no applicable
default, when a person creates a record, then Content presents a compact source
choice and records the chosen owner's outcome. Given no route, creation is
truthfully unavailable rather than guessed.

## Current evidence

Existing row-union and joined-detail machinery, source identity, guarded
writes, field bindings, and source selection provide substantial donor
implementation. They do not yet prove one visual typed Query experience,
explicit output ownership, access-first nested composition, or complete
write/create behavior. This Capability remains `approved_shape`.

## Proof plan

1. Build equivalent Queries through visual controls and agent Actions across
   Databases, governed Sources, and nested Queries; compare AST, output schema,
   preview, cycle checks, and compatible renderer behavior.
2. Test stable field identities, qualified collisions, explicit alignments,
   aliases, computed outputs, joins, filters, variables, provenance, freshness,
   access-first results, counts, aggregates, pagination, and scale bounds.
3. Exercise mapped write-through, derived-field refusal, zero/one/many creation
   routes, defaults, validation, Source policy, provider receipts, conflicts,
   retries, and mixed permissions.
4. Migrate representative row-union and joined-detail configurations without
   losing local rows, identities, write settings, review history, or Source
   mappings, then complete the workflow through the real interface.

## Open questions

- The stable ID `content.view.source-query` lives in the View namespace even
  though the accepted concept is a Query specialization. Preserve it for
  compatibility until a deliberate graph-wide normalization defines a safe
  replacement and migration path.
- Exact materialization/cache strategy and the detailed visual controls for
  complex joins, traversal, and scale warnings remain implementation work.
