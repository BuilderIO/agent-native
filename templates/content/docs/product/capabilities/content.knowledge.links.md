---
record_type: "capability"
spec_version: 2
id: "content.knowledge.links"
name: "Links and backlinks"
user_promise: "Stable links, outline, backlinks, forward links, external-link health, and link-aware navigation through the Page Info rail"
primary_user_job: "Follow and maintain references that survive renames and reveal whether a target is still usable."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference"]
related_features: ["content.feature.living-references"]
roadmap_boundary: "feature"
acceptance_summary: "Internal links use stable identities and portable links; outlines, forward links, backlinks, source links, and target-state taxonomy are access-scoped."
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

# Links and backlinks

## Why this exists

A reference promises a route back to the right thing after titles move and sources age. Backlinks make that promise visible from the other side.

## Example workflow

An editor links a Page by stable ID, renames the target, then opens its backlinks in the Info rail. An external link health check reports stale status without changing the original URL.

## Product contract

Internal links use stable identities and portable links; outlines, forward links, backlinks, source links, and target-state taxonomy are access-scoped. External health is cached observation, not a rewrite of source content.

## Boundaries and non-goals

References own link targets. This is not a crawler, an access bypass, or a claim that a failed external check deletes the link.

## Acceptance stories

### Resolve a link after a rename

Given a renamed Page, when a backlink is opened, then its stable link resolves to the renamed canonical target.

### Report a stale external target without rewriting it

Given an inaccessible backlink source, when a viewer opens Info, then it contributes no title, count, or preview.

## Current evidence

No complete link taxonomy, health, embedded rendering, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test ID links through rename, move, delete, outline, and backlink changes.
2. Verify Info rail, embeds, access changes, health states, and URL preservation.
3. Exercise stale targets, reload, keyboard navigation, and target-state announcements.

## Open questions

The initial external-health cadence and status-retention policy need design.
