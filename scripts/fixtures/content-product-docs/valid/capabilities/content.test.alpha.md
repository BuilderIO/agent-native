---
record_type: "capability"
spec_version: 2
id: "content.test.alpha"
name: "Alpha"
user_promise: "Alpha proves the required path."
primary_user_job: "Complete the Alpha workflow without losing its result."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.test"]
roadmap_boundary: "feature"
acceptance_summary: "The required path is proven."
proof_requirements:
  [
    "Prove the Action result",
    "Prove reload and recovery",
    "Prove the real interface",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Alpha

## Why this exists

People need the Alpha result to survive the complete workflow.

## Example workflow

A person invokes Alpha, reloads the surface, and recovers the saved result.

## Product contract

Alpha uses the shared Action and retains one canonical result.

## Boundaries and non-goals

Alpha does not create a second persistence or permission system.

## Acceptance stories

### Complete Alpha

Given an authorized person, when they invoke Alpha, then the canonical result is saved.

### Recover Alpha

Given a saved result, when the surface reloads, then the same result remains available.

## Current evidence

The fixture intentionally represents an approved shape with no implementation evidence.

## Proof plan

Exercise the Action, reload, recovery, and real interface.

## Open questions

No product question remains in this fixture.
