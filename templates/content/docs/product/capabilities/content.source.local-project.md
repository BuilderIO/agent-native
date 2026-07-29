---
record_type: "capability"
id: "content.source.local-project"
name: "Local project mode"
user_promise: "Opt-in local/git workspace where files are the single truth domain"
kind: "primitive"
state: "superseded"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters","content.portability.source-representation"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "A complete proof demonstrates: Canonical portable representation, deliberately constrained feature contract, explicit hosted/local migrations, no default SQL/git dual truth."
proof_requirements: ["Canonical portable representation, deliberately constrained feature contract, explicit hosted/local migrations, no default SQL/git dual truth."]
evidence: []
superseded_by: "content.source.adapters"
last_reviewed: "2026-07-29"
---

# Local project mode

## Contract

Opt-in local/git workspace where files are the single truth domain

## Acceptance boundary

A complete proof demonstrates: Canonical portable representation, deliberately constrained feature contract, explicit hosted/local migrations, no default SQL/git dual truth.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This record no longer defines new product work. Continue through `content.source.adapters`.
