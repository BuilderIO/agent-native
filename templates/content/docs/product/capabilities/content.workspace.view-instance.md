---
record_type: "capability"
id: "content.workspace.view-instance"
name: "View instances"
user_promise: "Tabs, panes, embeds, and windows can show independent focused instances of the same canonical object without duplicating it."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.working-set", "content.view.query"]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates independent presentation state, shared canonical data, explicit focus, and bounded lazy rendering across View instances."
proof_requirements: ["Open the same canonical object in two View instances, change presentation independently, edit once, and observe the canonical change in both."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# View instances

## Contract

Tabs, panes, embeds, and windows can show independent focused instances of the same canonical object without duplicating it.

## Acceptance boundary

Proof covers independent navigation and presentation, shared canonical mutations, focus and selection, lazy rendering, and recovery.

## Evidence boundary

Existing tabs or embed donors do not verify the shared contract until two live instances pass the same workflow.

## Non-goals

A View instance is not another Page, Database, Query, or permission boundary.
