---
record_type: "capability"
spec_version: 2
id: "content.feedback.signal"
name: "Reactions and Polls"
user_promise: "Structured reactions and option-based Polls live inside the Page Discussion and can render through views or embeds"
primary_user_job: "Collect lightweight feedback in the discussion where its context and access belong."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.discussion.page", "content.access.safe-aggregate"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "Reactions and Polls are Discussion messages with stable option identities, response and close rules, one featured Poll per Page, access-safe results, anti-abuse controls, and shared View or embed rendering.."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Reactions and Polls

## Why this exists

Votes and reactions make sense beside the conversation that gave them meaning; a survey silo loses both context and access boundaries.

## Example workflow

A Page owner posts a Poll with stable options in Discussion, features it on the Page, and later closes it. A View renders the same result without creating another poll.

## Product contract

Reactions and Polls are Discussion messages with stable option identities, response and close rules, one featured Poll per Page, access-safe results, anti-abuse controls, and shared View or embed rendering.

## Boundaries and non-goals

Discussion owns message identity and safe aggregates own totals. This is not a survey silo, anonymous access bypass, or a new Page type.

## Acceptance stories

### Close a featured decision poll

Given private respondents, when another viewer opens the featured Poll, then results reveal only the aggregation allowed by their access.

### Hide private votes in a rollup

Given a closed Poll, when a late response is attempted, then Content refuses it while preserving the Poll and prior attributed responses.

## Current evidence

No complete Poll identity, response, visibility, renderer, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test Discussion Poll identity, featured limits, stable options, close state, and responses.
2. Verify visibility, safe aggregates, abuse controls, Views, and embeds.
3. Exercise late responses, unavailable Discussions, keyboard voting, and result announcements.

## Open questions

The initial reaction vocabulary and anonymous-response policy need design.
