---
record_type: "capability"
spec_version: 2
id: "content.access.visibility-closure"
name: "Visibility closure"
user_promise: "Ambient traversal and derived results omit inaccessible objects while known direct links receive an honest denial."
primary_user_job: "Follow, search, embed, publish, and export work without private neighborhoods spilling into view."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database", "content.access.safe-aggregate"]
related_features:
  [
    "content.feature.work-across-every-workspace",
    "content.feature.publish-with-confidence",
  ]
roadmap_boundary: "feature"
acceptance_summary: "All ambient discovery and derived surfaces close over authorized objects; direct known targets fail honestly without revealing private existence or contents."
proof_requirements:
  [
    "Traversal, search, Query, embedding, and export closure",
    "Aggregate and relationship endpoint closure",
    "Direct-link generic denial distinct from successful absence",
    "Public, agent, source, cache, and access-change regression coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Visibility closure

## Why this exists

Access must remain true after information starts moving. A private object cannot become visible merely because a backlink, embed, export, or agent happened to pass nearby.

## Example workflow

An author publishes a Page that references internal research. Public readers see the authorized Page with the private reference omitted or safely degraded; a person with the internal link gets a generic denial rather than a plausible empty success.

## Product contract

- Search, traversal, Queries, Views, links, embeds, exports, public projections, and agents operate only over authorized closure.
- A direct known target may return a generic denial; ambient lists and derived results do not confirm its existence.
- Closure applies recursively to relationship endpoints and transcluded content before rendering or calculating.
- Caches, previews, snippets, errors, counts, and pagination preserve the same boundary.
- Access changes take effect before future reads and cannot be masked as normal emptiness.

## Boundaries and non-goals

- Visibility closure is not a replacement for Page/Database roles or row principals.
- It does not decide how a public Page is published, only what its reachable projections may reveal.
- It does not require every broken public reference to be silently invisible; authorized degradation can be meaningful.

## Acceptance stories

### Omit a private neighbor from export

Given a Page with a reference or transclusion to a private neighbor, when an unauthorized viewer exports or opens a public projection, then the neighbor's content, title, and cardinality do not leak.

### Differentiate denial from absence

Given an unauthorized person has a direct private URL, when they request it, then they receive an honest generic denial rather than a successful empty result that callers may mistake for normal absence.

## Current evidence

The architecture and existing access-aware Content paths establish the required direction. Repository evidence does not yet prove closure across every traversal, export, embed, cache, and agent path; this remains `approved_shape`.

## Proof plan

1. Test recursive references, Relationships, transclusions, Views, search, exports, and public output under access changes.
2. Inspect snippets, counts, errors, caches, pagination, previews, and agent summaries for side channels.
3. Verify direct denial versus ambient omission through UI and Actions.
4. Exercise source and integration paths plus reload and concurrent permission changes.

## Open questions

Exact degraded-reference presentation remains open; it must never disclose protected identity or turn denial into false success.
