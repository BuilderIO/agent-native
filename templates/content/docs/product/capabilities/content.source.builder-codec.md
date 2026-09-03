---
record_type: "capability"
spec_version: 2
id: "content.source.builder-codec"
name: "Builder round-trip codec"
user_promise: "Builder JSON blocks can pass through one typed codec without supported edits erasing unfamiliar provider content."
primary_user_job: "Edit supported Builder content in Content while keeping unsupported components and provider lifecycle decisions intact."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.portability.roundtrip", "content.source.adapters"]
related_features: ["content.feature.trust-your-connected-sources"]
roadmap_boundary: "feature"
acceptance_summary: "A pure typed codec maps supported Builder blocks and structured bodies in both directions, retains unknown raw components with stable provenance, detects baseline/hash conflicts, and produces deterministic golden round trips while source policy governs writes and publish."
proof_requirements:
  [
    "Golden codec fixtures for supported blocks, structured bodies, unknown raw fallbacks, and deterministic output",
    "Hash/baseline conflict, preservation, malformed input, and fidelity-report tests",
    "Builder source workflow editing a supported field while preserving an unknown component and keeping publish guarded",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Builder round-trip codec

## Why this exists

Connected editing is only trustworthy if unfamiliar provider material survives the journey home.

## Example workflow

An editor changes a mapped Builder article body. The codec writes supported blocks, preserves an unknown component as raw source-owned data, detects a changed provider baseline, and leaves publishing as a separate review action.

## Product contract

- One pure typed codec is shared by repo-backed docs and CMS-backed databases where the representation applies.
- Known blocks map to typed Content structures; unknown components retain raw payload, provider identity, ordering, and fidelity state.
- Baselines and hashes detect stale/conflicting writes. Codec output is deterministic and covered by golden fixtures.
- Codec conversion does not decide source truth, write mode, review, or provider publication; adapter and sync policy own those decisions.

## Boundaries and non-goals

This is Builder-specific format machinery, not generic Source behavior or a guarantee that every Builder component becomes editable.

## Acceptance stories

### Preserve an unknown component

Given a Builder article contains one unknown component and one supported text block, when the editor changes the text and writes back, then the unknown component remains unchanged with provider provenance.

### Stop on a stale baseline

Given Builder changes the source after Content reads it, when Content attempts write-back, then the codec reports a baseline conflict and does not overwrite the newer provider representation.

## Current evidence

Donor evidence: `actions/_builder-cms-source-adapter.ts`, `actions/_builder-cms-source-adapter.test.ts`, and `shared/builder-source-component-registry.ts` provide concrete Builder conversion substrate. No single certified pure codec and complete golden/conflict workflow proof exists; this record remains `approved_shape`.

## Proof plan

1. Extract or define pure codec inputs, outputs, opaque fallbacks, and fidelity reports.
2. Add golden, malformed, hash, conflict, and unknown-preservation fixtures.
3. Verify a supported edit, unknown preservation, review, and guarded publish workflow.

## Open questions

- The first supported component matrix and raw-payload archive encoding remain open.
