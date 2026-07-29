---
record_type: "capability"
spec_version: 2
id: "content.diff.ai-assist"
name: "Agent-assisted review"
user_promise: "Agents can summarize and guide large review sets without bypassing the authority to decide them."
primary_user_job: "Understand a large proposal quickly while keeping evidence, scope, and final review control visible."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.diff.filtered-review", "content.agent.action-parity"]
related_features: ["content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "Agent assistance consumes an access-scoped typed change graph, cites inspectable change evidence and uncertainty, and uses the same authorized review Actions as a person."
proof_requirements:
  [
    "Access-scoped typed change graph and evidence links",
    "Summary, grouping, risk, and uncertainty behavior grounded in actual changes",
    "No authority bypass; shared confirmation and decision Actions",
    "Stale context, adversarial input, retry, audit, and human-interface tests",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent-assisted review

## Why this exists

Large review sets exhaust attention. An agent can make the shape visible, but it must remain a lamp beside the road, not a hand on the steering wheel.

## Example workflow

An editor asks an agent to summarize a large proposed update. The agent groups changes, links each claim to typed diffs, identifies uncertain or risky items, and prepares a filtered review; the editor still makes every decision through the same authorized Actions.

## Product contract

- Assistance reads only the viewer-authorized typed change graph and its scoped evidence.
- Summaries distinguish observed change facts, inferences, risks, and uncertainty; each recommendation links back to inspectable changes.
- An agent may prepare filters and explain dependencies but cannot bypass review authority or fabricate a completion receipt.
- Accept/reject/defer operations call the same Action surface, policy, confirmation, Events, and History as human review.
- Stale, unavailable, or incomplete evidence is reported as such, not coerced to a clean summary.

## Boundaries and non-goals

- This is not an autonomous publishing or approval capability.
- It does not replace in-place diffs, filtered review, or human accountability.
- Model choice and prose style are not proof of review correctness.

## Acceptance stories

### Ground a recommendation in visible evidence

Given an agent recommends accepting a Property change, when the editor opens the recommendation, then it identifies the exact typed diff, dependencies, and uncertainty rather than citing inaccessible or invented context.

### Preserve review authority

Given an agent prepares an all-visible acceptance, when it lacks the editor's authority or confirmation, then no change applies and the same Action denial/confirmation boundary appears as in the UI.

## Current evidence

Current agent Action infrastructure and source review substrate demonstrate adjacent machinery. A trustworthy generic typed change graph, scoped evidence synthesis, and end-to-end review parity are not yet proven; this remains `approved_shape`.

## Proof plan

1. Test summaries against known typed change fixtures, including omissions, uncertainty, and conflicting changes.
2. Verify every cited item is accessible and opens its ordinary diff.
3. Exercise authorization, confirmation, stale context, adversarial content, retries, and audit receipts.
4. Validate the complete UI-plus-agent review workflow with accessible controls.

## Open questions

Ranking and summary presentation remain open. The agent may never substitute a plausible narrative for evidence or authority.
