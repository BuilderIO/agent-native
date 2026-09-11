---
record_type: "capability"
spec_version: 2
id: "content.source.catalog"
name: "Sources catalog"
user_promise: "One governed top-level Content Database makes approved local, provider, and native Sources discoverable without hiding their scope, authority, or freshness."
primary_user_job: "Find and choose the right authorized Source for a Query, capture flow, or connection while understanding what it can do."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.access.page-database"]
related_features:
  [
    "content.feature.connect-your-sources",
    "content.feature.capture-into-action",
    "content.feature.move-without-starting-over",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A governed Sources Database retains stable identity, owner, scope, approval, adapter capabilities, synchronization policy, freshness, grant reference, and write gates; authorized Query and capture flows select from it without treating a catalog row as provider or filesystem authority."
proof_requirements:
  [
    "Access-scoped catalog creation, discovery, approval, revocation, and selection through UI and Actions",
    "Stable Source identity and complete governance metadata propagated into Query, capture, adapter, and audit paths",
    "Viewer-specific results, counts, searches, and selection behavior across personal, workspace, and organization scope",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Sources catalog

## Why this exists

People need a single place to discover the work they can connect or reuse,
instead of a separate picker for each provider or an ungoverned list of hidden
credentials. A Source must be recognizable as a durable governed object while
still making clear that external content, grants, and physical files retain
their own authority.

## Example workflow

An editor opens **Add sources** in a Query. The catalog leads with approved
organization Sources, also shows their authorized personal Sources, and labels
each candidate's scope, freshness, adapter capabilities, and sync policy. They
select two collections. The saved Query retains stable Source references and
each row's provenance; it does not copy the collections or grant access to a
colleague who cannot see one of them.

## Product contract

### A governed top-level database

- Sources is a top-level governed Content Database, parallel to other reusable
  catalogs. Its rows represent native, local, and provider Sources rather than
  Pages, credentials, or copied provider records.
- Each row has stable identity plus owner, personal/workspace/organization
  scope, approval state, adapter identity and certified capabilities, sync
  policy, freshness, credential or grant reference, and write gates.
- Credential and grant references are opaque configuration references. The
  catalog never exposes secret values, raw local paths, or device handles.
- Approval affects discovery and permitted use but does not bypass Content
  access, provider grants, adapter capability, Source policy, or device
  authority. A catalog row is not itself permission to read or write a Source.

### Selection remains access-scoped

- Query builders, capture flows, and other Source selectors choose from this
  catalog and retain stable Source IDs, not titles or inferred provider names.
- Organization-approved Sources may lead discovery without hiding authorized
  personal Sources. Scope changes do not silently move a Source or widen who
  can use it.
- Search, counts, suggestions, source previews, and aggregate metadata are
  evaluated for the current viewer. An inaccessible Source does not leak by
  title, existence, capability, freshness, or count.
- A saved Query stores references and output configuration only. Its results
  still evaluate each Source's current access and authority for the viewer.

### Governance supports safe change

- Catalog changes use the shared Action surface, preserve actor and origin, and
  make approval, policy, capability, freshness, and write-gate state legible.
- Revoking a grant, disconnecting a Source, or losing a device does not erase
  external originals. The dependent experience reports the resulting access,
  stale, unavailable, or disconnected state truthfully.
- Source policy governs sync behavior; human roles govern access; adapters
  declare provider operations. The catalog records and exposes these distinct
  layers without collapsing them into one misleading status.

## Boundaries and non-goals

- This catalog does not define provider protocol behavior, codecs, write
  routing, or local bridge security; those belong to adapters, sync policy,
  round-tripping, and the Local Source Bridge.
- A catalog row is not a Source Page identity, a Query, a second permissions
  engine, or a storage location for raw provider payloads and credentials.
- Adding a Source does not automatically approve it for every scope, synchronize
  it, publish it, or create a shared mirror.

## Acceptance stories

### Select Sources without widening access

Given a person with access to an organization Source and a personal Source but
not a colleague's Source, when they open a Query or capture selector, then the
first two are eligible according to policy and the colleague's Source is absent
from results, counts, and suggestions.

### Preserve the distinct governance layers

Given an approved writable Source whose provider grant has expired, when an
editor selects it from the catalog and attempts a write, then Content identifies
the grant failure without claiming the Source is unapproved, changing its sync
policy, or treating the catalog row as successful provider authority.

### Disconnect without deleting the original

Given a Source with materialized Content representations, when an authorized
owner disconnects it, then Content requires the defined treatment of its local
materialization, records the decision, and never deletes the provider or local
original merely because the catalog connection was removed.

## Current evidence

Content has source-backed data, source metadata, and several connection flows.
Those are donor substrate, not proof of one governed top-level catalog,
scope-aware selection, or the complete governance metadata and access contract.
This Capability remains `approved_shape`.

## Proof plan

1. Create, approve, scope, update, revoke, and disconnect Sources through UI
   and Actions; verify stable identity, provenance, audit history, and no raw
   credential, path, or handle disclosure.
2. Test catalog discovery, search, counts, Query selection, capture selection,
   and saved Query evaluation for personal, workspace, and organization users
   with changing access and approval.
3. Verify capability, policy, freshness, grant, and write-gate metadata remains
   distinct through adapter calls, error states, exports, and reconnects.
4. Complete a real Query and capture workflow using catalog-selected Sources,
   including keyboard and accessible selection states.

## Open questions

- The detailed approval workflow, ownership transfer rules, and organization
  governance roles remain to be specified with the broader catalog system.
- The exact presentation and retention of stale/disconnected materializations
  require coordination with portability and local bridge behavior.
