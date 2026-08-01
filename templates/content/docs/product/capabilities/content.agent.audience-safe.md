---
record_type: "capability"
spec_version: 2
id: "content.agent.audience-safe"
name: "Audience-safe synthesis"
user_promise: "A governed agent run can synthesize from only the resources every intended viewer may access and consent to use for that audience."
primary_user_job: "Prepare a shared answer for a defined audience without borrowing an owner's private authority or silently carrying excluded material into the result."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  ["content.agent.resource-consent", "content.access.visibility-closure"]
related_features: ["content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A strict-audience run resolves its inputs through the intended audience's common authorized-and-consented intersection, rechecks it throughout the run, and never exposes excluded inputs through output, cache, metadata, or errors."
proof_requirements:
  [
    "Audience identity and common authorized-and-consented input intersection resolved before retrieval and at every subsequent use",
    "Strict-audience behavior that never borrows owner, author, agent, or cached private authority",
    "Cache keys, invalidation, output handling, errors, counts, and provenance that cannot reveal excluded inputs",
    "Real-interface workflow tests for changing audience membership, access, consent, source availability, and direct inspection",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Audience-safe synthesis

## Why this exists

An author can often see more than the people who will receive an agent's answer. Summarizing with the author's authority and then sharing the result can leak the very material the audience was not allowed to see. A warning after generation is too late; a careful-looking answer may already contain the private detail.

Audience-safe synthesis is a workflow over resource consent and access closure. It constrains the run's inputs to the common intersection for its stated audience before the agent reasons over them.

## Example workflow

A project lead asks for a status update for three collaborators. The agent resolves the intended audience, then gathers only project resources that all three collaborators can access and that are consented for agent context. A private planning note and a resource one collaborator lost access to are excluded. When a fourth collaborator is added during the run, the remaining work is re-evaluated against the smaller intersection. The agent can state that its answer is based on the permitted shared material, but it does not name or count excluded inputs.

## Product contract

### Audience-bound input closure

- A strict-audience run names an intended audience and evaluates every candidate input as the intersection of that audience's current ordinary authorization and effective agent-context consent, including resource, source, and inherited policy ceilings.
- The run may use only inputs in that common intersection. It does not borrow the initiating owner's, author's, operator's, or agent's broader authority to fill a gap.
- Audience changes, access changes, consent revocation, source-policy changes, and unavailable authority state are re-evaluated before each remaining retrieval, tool call, context reuse, and output-affecting step. Unreadable authority state is not treated as an empty allowed intersection.
- Strict-audience mode is an opt-in governed workflow. It may produce a narrower answer, a truthful unavailable state, or a request to revise the audience; it may not silently broaden the audience or switch to owner-authority mode.

### Outputs, caches, and provenance

- Excluded inputs cannot appear in generated output, citations, snippets, titles, tool traces, error messages, counts, timing summaries, or aggregate explanations. The output may identify its declared audience and describe authorized-source limitations only when doing so does not reveal excluded material.
- Cached retrievals, intermediate context, embeddings, plans, and generated results are scoped to the exact audience/access/consent state that authorized them. Access or consent revocation invalidates them for affected viewers; an owner-private cached result is never reused for a strict-audience run.
- The workflow records run identity, declared audience representation, policy mode, and safe provenance needed for inspection. Origin/provenance says where an authorized result came from; it is not a review, verification, or truth guarantee.
- Audience-safe synthesis does not prove that its answer is complete, correct, endorsed, or fit for publication. Review and verification remain separate decisions.

## Boundaries and non-goals

- This is not a new sharing model, an audience-wide permission grant, a way to make private resources public, or an alternative to resource consent/access closure.
- It does not make an agent's summary authoritative, verified, or approved merely because the input intersection was safe.
- It does not disclose the identity, existence, count, or cached remnants of resources excluded by access or consent.
- It does not authorize owner-credential fallbacks, privileged cache reuse, or source reads outside the audience's effective closure.

## Acceptance stories

### Synthesize only from the common intersection

Given an author can access three resources and one intended viewer cannot access one of them, when a strict-audience run creates a status update for that audience, then it uses only the two common authorized-and-consented resources and does not mention the excluded resource or its absence.

### Re-evaluate a changing audience

Given a strict-audience run is gathering material for two viewers, when another viewer is added or a current viewer loses access before the next retrieval, then the run re-evaluates the remaining input closure and neither uses newly excluded context nor reuses a broader cached result.

### Preserve the distinction between provenance and review

Given a strict-audience run produces an answer with safe authorized provenance, when a recipient opens it, then they can inspect permitted origin information appropriate to their access but do not see a claim that the result was reviewed, verified, or true unless another Capability supplied that decision.

## Current evidence

`content.agent.resource-consent` and `content.access.visibility-closure` define required dependencies, but neither is verified as a complete implementation. Current architecture establishes access before computation in `templates/content/docs/product/architecture.md`; no repository evidence yet proves an intended-audience intersection resolver, strict-mode cache partitioning/invalidation, or non-leaking output behavior across agent tools. This Capability remains `approved_shape`.

## Proof plan

1. Build deterministic resolver tests for multi-viewer intersections across Pages, Databases, Sources, inherited consent ceilings, membership changes, revocation, and authority-read failures.
2. Verify agent retrieval, search, traversal, tool calls, aggregation, citations, error rendering, and final output use the same strict context and cannot observe excluded identity or counts.
3. Test cache and intermediate-artifact keys against audience identity, membership/access epoch, consent epoch, source policy, and resource version; prove revocation and audience change invalidate unsafe reuse.
4. Run real-interface workflows that define an audience, generate a result, alter its membership/access/consent mid-run, inspect safe provenance, and confirm that review/verification status remains distinct.

## Open questions

The durable representation of a dynamic audience, safe wording for partial-result notices, and retention rules for run intermediates remain open implementation choices. They must not weaken common-intersection input selection, strict cache isolation, or the distinction between safe provenance and verification.
