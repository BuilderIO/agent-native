---
record_type: "capability"
spec_version: 2
id: "content.expression.cached-result"
name: "Cached expression results"
user_promise: "See the last valid computed value quickly while knowing whether it still reflects current inputs."
primary_user_job: "Read a last valid result while understanding freshness."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.expression.language", "content.event.committed"]
related_features: ["content.feature.data-that-keeps-itself-right"]
roadmap_boundary: "feature"
acceptance_summary: "Expression consumers render the last valid result stale-first, mark freshness and failure truthfully, refresh in the background, and retain the previous valid value when refresh is ordinary work."
proof_requirements:
  [
    "A valid cached result is distinct from a missing value, a failed evaluation, and an unavailable input.",
    "Input or dependency changes make cached output visibly stale; successful refresh replaces it atomically.",
    "A failed refresh preserves the last valid result with an error state and retry path rather than reporting a clean empty value.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Cached expression results

## Why this exists

A blank dashboard during an ordinary refresh is less useful than the last known answer, but a stale answer must never masquerade as current. People need both speed and a clear account of freshness or failure.

## Example workflow

Priya opens a dashboard after an upstream change, sees yesterday's total marked stale, and keeps it beside a retryable refresh failure.

## Product contract

- A valid cached result is distinct from a missing value, a failed evaluation, and an unavailable input.
- Input or dependency changes make cached output visibly stale; successful refresh replaces it atomically.
- A failed refresh preserves the last valid result with an error state and retry path rather than reporting a clean empty value.

## Boundaries and non-goals

- `content.expression.language` owns evaluation and dependency semantics; cached-result behavior owns freshness, replacement, and stale/error presentation.
- A cache is not a source of truth, must not bypass access, and must not turn a failed refresh into an empty successful value.

## Acceptance stories

### Do not collapse failed refresh

Given refresh fails after a valid value, then the prior value remains stale with error, not blank or zero.

### Respect viewer access

Given a result was cached for a broader audience, when a narrower viewer opens it, then it is withheld or reevaluated.

## Current evidence

No cache implementation exists. `actions/update-document.ts` and committed mutation paths donate invalidation inputs, not freshness or audience-safe cache behavior.

## Proof plan

1. Change direct/transitive input and verify stale-first replacement.
2. Distinguish evaluator, provider, timeout, and access failures.
3. Change viewer access and prove no cache leakage.
4. Test retry, invalidation, and eviction.

## Open questions

Lifetime, scheduling, and offline policy remain open.
