---
record_type: "capability"
spec_version: 2
id: "content.property.guarded-change"
name: "Guarded property changes"
user_promise: "Require an explained confirmation or policy check before a sensitive field transition while keeping one general validation engine."
primary_user_job: "Satisfy a clear shared safeguard before sensitive changes."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.constraints", "content.event.committed"]
related_features:
  [
    "content.feature.trust-your-connected-sources",
    "content.feature.data-that-keeps-itself-right",
    "content.feature.publish-with-confidence",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Any Property can declare validation and safeguards for sensitive transitions; the shared mutation boundary evaluates them, explains required confirmation or policy failure, and records committed changes normally."
proof_requirements:
  [
    "Status is a useful UI for a guarded change but is not the exclusive safeguard engine.",
    "UI, agent, automation, source sync, import, and API calls use the same validation and policy boundary.",
    "A blocked transition produces an actionable reason and no partial write; accepted confirmation or policy result is attributable in history.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Guarded property changes

## Why this exists

Some values carry consequences that deserve more than an accidental click, yet a special status dialog cannot protect the same change made by automation. People need one explainable safeguard at the mutation boundary.

## Example workflow

A release manager moves Draft to Published with required confirmation and sees the same policy apply to agent and source-sync changes.

## Product contract

- Status is a useful UI for a guarded change but is not the exclusive safeguard engine.
- UI, agent, automation, source sync, import, and API calls use the same validation and policy boundary.
- A blocked transition produces an actionable reason and no partial write; accepted confirmation or policy result is attributable in history.

## Boundaries and non-goals

- Constraints own ordinary validity; committed events own attribution/history; guarded change owns the added safeguard decision and explanation.
- Status is only one useful surface: safeguards are not status-only workflows, a new permission system, or a client-only confirmation.

## Acceptance stories

### Guard every origin

Given source sync attempts a sensitive transition, when it reaches the mutation boundary, then it receives the same decision as UI.

### Explain refusal

Given confirmation is absent, when an editor requests the transition, then no mutation occurs and the rule/next action are clear.

## Current evidence

`actions/change-content-database-source-role.ts` and `set-document-property.ts` are donors; general safeguard evaluation is absent.

## Proof plan

1. Configure safeguards on status, date, relation, and ordinary fields.
2. Compare UI/action/agent/automation/import/sync decisions.
3. Test expiry, retry, concurrency, no partial writes.
4. Verify explanations and actor history.

## Open questions

Vocabulary and separate-reviewer policy remain open.
