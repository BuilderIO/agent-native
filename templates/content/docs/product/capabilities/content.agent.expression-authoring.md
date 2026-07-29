---
record_type: "capability"
spec_version: 2
id: "content.agent.expression-authoring"
name: "Agent-authored Expressions"
user_promise: "Ask an agent to draft or repair a typed expression without giving it a private execution or save path."
primary_user_job: "Collaborate on a validated expression before saving it."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.expression.language", "content.agent.action-parity"]
related_features: ["content.feature.put-your-organizations-know-how-to-work"]
roadmap_boundary: "feature"
acceptance_summary: "The agent inspects authorized live schema and expression context, produces a typed candidate, validates and previews it, explains failures, and saves only through an explicit authorized action."
proof_requirements:
  [
    "The agent uses the same expression language, validators, permissions, and mutation receipts as a person.",
    "A candidate remains a preview until the user or authorized workflow explicitly saves it.",
    "Missing schema, denied data, type errors, and unsafe dependencies are named failures, not invented expressions or successful empty previews.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent-authored Expressions

## Why this exists

An agent can make configuration more approachable, but a plausible-looking formula based on invented schema is worse than no formula. Its suggestions need the same evidence, preview, and save boundary as human-authored work.

## Example workflow

Sam asks for an overdue formula; the agent inspects authorized fields, previews dependencies, repairs an error, and saves only after confirmation.

## Product contract

- The agent uses the same expression language, validators, permissions, and mutation receipts as a person.
- A candidate remains a preview until the user or authorized workflow explicitly saves it.
- Missing schema, denied data, type errors, and unsafe dependencies are named failures, not invented expressions or successful empty previews.

## Boundaries and non-goals

- `content.expression.language` owns parsing, typechecking, preview semantics, and persistence; the agent is an authorized client of that contract.
- Agent authoring does not invent schema, bypass confirmation, or persist speculative candidates.

## Acceptance stories

### Refuse invented schema

Given a target is denied or deleted, when the agent reads its schema, then it reports it instead of guessing.

### Save only deliberately

Given a correct preview is declined, when Sam closes it, then no field changes; accepted save creates a normal receipt.

## Current evidence

`actions/configure-document-property.ts` and the action framework donate mutation seams; no authorized schema/agent preview action exists.

## Proof plan

1. Draft from live authorized schema and inspect AST/bindings/dependencies.
2. Test type, cycle, denied, and unavailable failures without persistence.
3. Compare agent and human preview diagnostics.
4. Save, reject, and repair with receipt/history parity.

## Open questions

No product question remains.
