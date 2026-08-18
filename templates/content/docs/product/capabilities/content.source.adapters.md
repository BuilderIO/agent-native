---
record_type: "capability"
spec_version: 2
id: "content.source.adapters"
name: "Source adapters"
user_promise: "Local, native, and provider Sources use one typed contract while each adapter proves only the operations it can safely perform."
primary_user_job: "Use connected work through one Content experience without losing its provider identity, authority, or meaning."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "configured"
dependencies: ["content.source.catalog", "content.source.sync-policy"]
related_features:
  [
    "content.feature.connect-your-sources",
    "content.feature.trust-your-connected-sources",
    "content.feature.bring-your-local-work",
    "content.feature.read-and-annotate-anything",
    "content.feature.cite-what-you-found",
    "content.feature.move-without-starting-over",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Adapters declare and certify their read, watch, write, create, move, delete, review, publish, fidelity, and bridge requirements; shared Content behavior routes through those declarations and preserves provenance, ownership, conflicts, and truthful outcomes."
proof_requirements:
  [
    "Typed adapter declaration, validation, and action routing for identity, provenance, ownership, capabilities, policy, and receipts",
    "Independent certification of declared operations, authorization, conflict, retry, and unknown-data behavior for each adapter",
    "Cross-adapter interface and Action workflows that distinguish unsupported, unavailable, queued, failed, conflicted, and provider-confirmed states",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Source adapters

## Why this exists

People should be able to work with local folders, native Content data, and
provider collections without treating every integration as a separate product.
The common experience must not erase the important differences: which system
owns a representation, what a provider permits, whether a device is available,
and what Content cannot safely interpret.

## Example workflow

A team selects two provider collections and one local folder from the Sources
catalog. Content shows them in one Query while retaining each result's origin.
An edit to a mapped writable field routes to its one declared adapter; an
unknown provider component remains preserved and read-only; a local-only
operation reports that the current device lacks bridge authority. The Query is
not a new owner and does not send the same edit to all three Sources.

## Product contract

### One contract, declared capabilities

- A Source adapter declares stable Source and item identity, provenance,
  supported representations, field ownership, freshness/baseline behavior,
  authenticated grant requirements, and its certified operations.
- Operations are explicit rather than implied by a connection: read, watch,
  write, create, move, delete, review, publish, fidelity/export behavior, and
  whether a trusted local bridge is required.
- Content exposes only operations that pass the adapter declaration and the
  current access, approval, grant, policy, and device checks. Unsupported and
  unavailable are distinct states; neither is represented as an empty success.
- UI, agents, automations, and APIs use the same typed Action surface and see
  the same capability decision. Adapters do not receive private mutation paths.

### Preserve one owner and one route

- Adapter bindings connect an external item to stable Content identity without
  making the provider the Page's identity or copying it into a rival datastore.
- Source-owned fields and representations retain their adapter identity;
  Content-owned properties, comments, memberships, views, and collaboration
  remain Content-owned unless explicitly mapped otherwise.
- Queries and Views project adapter-backed records but do not own canonical
  values or provider write authority. An edit routes only through an
  unambiguous authorized binding; ambiguous projections are read-only.
- Provider lifecycle actions such as publish are declared separately and remain
  guarded. An adapter's ordinary write capability never implies publish.

### Certify behavior, not a provider name

- An adapter may implement a narrow subset of the contract. A read-only source
  can certify refresh without claiming write or review; a local adapter may
  require a bridge for watch or physical writes.
- Certification tests each declared operation's identity, authorization,
  policy, base revision, conflict, retry, receipt, and fidelity behavior.
  Passing one adapter's tests is evidence for that adapter, not generic proof.
- Adapters preserve provider-owned structures they cannot safely render or edit
  through the faithful round-tripping contract. They must not flatten unknown
  data into a normal editable representation.

## Boundaries and non-goals

- The Sources catalog owns governed discovery and connection records; sync
  policy owns user-facing write-back modes; this record owns the provider and
  local implementation boundary between them.
- Provider-specific codecs may define exact format mappings. They cannot widen
  the generic adapter promise without independent contract proof.
- Adapters are not a second access system, a generic REST proxy, or a promise
  that all providers support the same operations.
- Git branches, commits, pull requests, and provider publishing may be
  adapter-specific review or lifecycle work; they are not universal Versions.

## Acceptance stories

### Route an edit to its sole declared owner

Given a Query containing records from two writable Sources and one read-only
Source, when an editor changes an unambiguously mapped field on one result,
then only that result's authorized adapter receives the change, the other
memberships do not fan out, and the receipt identifies the destination.

### Reject an unavailable operation honestly

Given a local Source whose current client lacks its required bridge, when a
person asks to reveal or immediately write a local-only file, then Content
reports the unavailable device capability and offers the applicable route; it
does not claim the operation completed or make unrelated Content work fail.

### Keep unknown provider content intact

Given an adapter reads a provider representation containing an unsupported
component, when an editor changes a separately mapped supported field and the
adapter writes it back, then the unsupported component survives with its source
identity and the adapter's receipt records the actual provider result.

## Current evidence

Content has source-backed data, provenance, local material, and provider
adapters that are valuable substrate. Existing provider-specific behavior does
not yet certify the common declaration model, every operation, or cross-source
authorization and fidelity behavior. This Capability remains `in_progress`.

## Proof plan

1. Validate adapter declarations and Action routing for a read-only provider,
   a writable provider, native Content, and a bridge-dependent local Source.
2. Certify every declared operation independently, including denied grants,
   stale bases, conflicts, retry after interrupted delivery, and provider
   receipts; assert undeclared operations cannot be invoked.
3. Test identity/provenance, field ownership, Query routing, access-first
   results, unknown preservation, and lifecycle separation across adapters.
4. Complete real-interface connection, refresh, edit, review, failure, and
   recovery flows with assistive-technology and keyboard coverage.

## Open questions

- The exact adapter declaration schema and certification fixture format remain
  implementation work.
- Which provider operations graduate from review-only to automatic support must
  be decided adapter by adapter after certification.
