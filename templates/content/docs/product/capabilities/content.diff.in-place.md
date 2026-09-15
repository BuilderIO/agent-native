---
record_type: "capability"
spec_version: 2
id: "content.diff.in-place"
name: "In-place typed review"
user_promise: "Changes are reviewed inside the ordinary Page, Database, Board, template, source, or code surface that gives them meaning."
primary_user_job: "Evaluate a proposed change in context rather than translating it from a generic red/green destination."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed", "content.renderer.typed"]
related_features:
  [
    "content.feature.review-changes-in-place",
    "content.feature.explore-alternatives-safely",
    "content.feature.evolve-systems-safely",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Typed change identities and dependencies render in the normal object surface, retain causal/actor context, and record durable authorized review decisions."
proof_requirements:
  [
    "Typed change model for bodies, Blocks, Properties, memberships, and structured values",
    "Ordinary renderer integration and accessible in-place comparison",
    "Durable accept/reject/defer/supersede Events with authority",
    "Stale, dependency, conflict, source, and agent-run coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# In-place typed review

## Why this exists

A property, Block, membership, and source proposal carry different meaning. Review should meet each where it lives instead of flattening all work into an unreadable universal diff.

## Example workflow

An agent proposes article copy and Status changes. The editor sees copy changes in the Page editor, the Status change in its Property renderer, accepts one, rejects the other, and History records the durable decisions with the run context.

## Product contract

- A change has stable identity, target type, dependencies, actor/origin, causal context, before/after material, and disposition.
- Body, Block, Property, membership, and structured changes render through their ordinary typed surfaces.
- Accept, reject, defer, and supersede are authorized durable decisions that emit Events and preserve why a proposal ended.
- A stale target, incompatible dependency, source authority restriction, or conflict is explicit; no review button silently applies a plausible partial result.
- Agent and human proposals use the same review model and Actions.

## Boundaries and non-goals

- This capability does not define filtered-set selection, AI assistance, or named Version branching.
- It does not replace low-level Events, logical Revisions, or recovery snapshots.
- A typed renderer may degrade honestly; review may not discard unknown source content.

## Acceptance stories

### Review mixed typed changes in context

Given a proposal changes a paragraph and a select Property, when an editor opens review, then each difference renders in its ordinary surface and the editor can decide independently where dependencies allow.

### Surface a stale conflict honestly

Given a proposal is based on a Block another editor changed, when review attempts acceptance, then Content shows a stale/rebase/conflict state and does not overwrite the newer change.

## Current evidence

Source change sets, document snapshots, and Builder review machinery are donor substrate. The repository does not yet prove one generic typed in-place diff system across Content objects, so this remains `approved_shape`.

## Proof plan

1. Propose and render each supported change type through UI and shared Actions.
2. Test dependency ordering, stale bases, conflicts, source locks, permission changes, and Undo.
3. Verify Events, History, agent attribution, recovery, and accessible comparison.
4. Exercise reload, concurrent decisions, portable output, and unavailable renderers.

## Open questions

The internal change representation and exact visual affordances remain open; typed context and durable authorized disposition are settled.
