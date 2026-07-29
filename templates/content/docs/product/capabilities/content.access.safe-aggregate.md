---
record_type: "capability"
spec_version: 2
id: "content.access.safe-aggregate"
name: "Access-safe computation"
user_promise: "Counts, rollups, groups, and aggregates reveal only records the viewer may access."
primary_user_job: "Understand shared data without private records leaking through a total, relation count, or derived value."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database"]
related_features: ["content.feature.understand-what-your-data-says"]
roadmap_boundary: "feature"
acceptance_summary: "Every derived computation filters inaccessible records and endpoints before traversal, grouping, measure calculation, caching, or rendering."
proof_requirements:
  [
    "Relation traversal and count asymmetry repair",
    "Access-first rollup, group, Pivot, Chart, and expression tests",
    "No leakage through empty, error, cache, drill-down, or export states",
    "Equivalent UI, Action, agent, and API results under changing access",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Access-safe computation

## Why this exists

A total can betray a secret as surely as a sentence can. Analytics must count the authorized world, not calculate privately and hide only the rows.

## Example workflow

A manager groups a pipeline by stage and drills into a total. Restricted opportunities are absent from both the count and the drill-down, even though authorized peers see a larger total.

## Product contract

- Access filters apply before relationship traversal, Query evaluation, grouping, rollup, count, measure, chart, pivot, expression, and export.
- A result and its drill-down describe the same authorized input set.
- Caches and precomputed indexes are implementation machinery and may not reveal an inaccessible cardinality or stale value.
- Known inaccessible direct objects return denial; ambient derived work omits them without a side-channel.
- UI, agents, APIs, and automations receive the same scoped result or typed failure.

## Boundaries and non-goals

- This record does not define query syntax, Chart presentation, or row-sharing controls.
- It does not require hiding authorized zero results; a true zero remains meaningful.
- Performance optimizations cannot weaken the access-before-computation ordering.

## Acceptance stories

### Count only visible relations

Given a visible Page related to one visible and one private Page, when a viewer calculates a relation count, then it reports one and cannot infer the second endpoint from count, error, or timing behavior.

### Drill into the same cohort

Given a grouped aggregate with restricted rows, when a viewer opens drill-down, then every returned row and total matches the viewer-scoped aggregate rather than a wider cached cohort.

## Current evidence

The product architecture requires access before derived work, while the current audit identified relation-count asymmetry as a repair seam. No complete generic aggregate implementation proof exists; this capability remains `exploring`.

## Proof plan

1. Build adversarial fixtures for private rows/endpoints across counts, rollups, groups, expressions, pivots, charts, and exports.
2. Compare results across UI, Actions, agents, APIs, cache refreshes, and changing access.
3. Verify drill-down, pagination, empty/error states, and timing do not leak presence.
4. Test source-backed values and concurrent access changes.

## Open questions

The evaluation and cache design are open. The access-first semantics and equal result/drill-down cohort are not.
