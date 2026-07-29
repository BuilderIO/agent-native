---
record_type: "capability"
spec_version: 2
id: "content.agent.resource-consent"
name: "Agent resource consent"
user_promise: "Resources independently declare whether agents may use them as context and whether agents may edit them, while inheritable ceilings can narrow either decision."
primary_user_job: "Let an agent help with selected material without turning ordinary sharing access or a recoverable edit into blanket agent authority."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database", "content.event.committed"]
related_features: ["content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "An authorized person can set distinct agent-context and agent-edit consent on a resource; inherited ceilings can only narrow them; every agent read or mutation rechecks the effective decision at use time."
proof_requirements:
  [
    "Independent context and edit decisions through the shared resource/action surface, without adding a Page role",
    "Inherited resource, container, workspace, and policy ceilings that only narrow effective consent and remain explainable",
    "Access and consent re-evaluation before every agent read, traversal, synthesis input, and mutation, including mid-run revocation",
    "Attributable Events and truthful typed failures for denial, revocation, unavailable policy state, and recoverability",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent resource consent

## Why this exists

Ordinary sharing answers who may access a resource. It does not answer whether an agent may use that resource as input, nor whether an agent may change it. Those are consequential decisions with different risks: a private note can be visible to its owner yet excluded from an agent's context, and an agent may be allowed to read a brief without being allowed to edit it.

Resource consent supplies those decisions without inventing another Page role or a parallel permission system. It composes with existing access, source policy, and workspace policy; it never broadens them.

## Example workflow

A researcher shares a project brief with collaborators and asks an agent to draft a summary. The brief allows agent context but disallows agent edits. One linked personal note is excluded from agent context, so the run does not read it even though the researcher can. A folder-level policy later disables agent context for its children; the brief's own allowance cannot override that ceiling. If consent is revoked while the run is gathering inputs, its next read fails safely and the agent reports that it must continue without the resource or stop.

## Product contract

### Separate, composable decisions

- Each resource has distinct **agent context** and **agent edit** decisions. Context consent governs use as input, including search, traversal, retrieval, summarization, and synthesis; edit consent governs a proposed or committed agent mutation.
- Edit consent does not imply context consent, and context consent does not imply edit consent. An edit must satisfy ordinary edit authority, applicable source/write-back policy, effective edit consent, and any required approval/confirmation gate.
- Effective consent is the intersection of ordinary access, resource consent, source policy, and inherited container, workspace, organization, and framework-policy ceilings. A ceiling may narrow or disable a descendant decision but never grants or widens it.
- The resource's own decision may be inherited where policy permits. An explicit descendant choice can narrow an inherited allowance, but it cannot escape an inherited denial or ceiling.
- Consent is evaluated for the acting principal and current run at the point of use. Stored selection, search indexes, precomputed plans, queued work, and recovered runs do not carry a durable permission grant.

### Revocation, accountability, and failure

- Every agent read and every mutation preflight re-evaluates access and effective consent. A mid-run revocation prevents the next affected operation; already committed, authorized changes retain their ordinary Event and recovery history.
- A denied or revoked resource is omitted from ambient discovery and aggregate inputs according to the normal access contract. A direct request receives a typed, non-leaking denial or unavailable state, never a fabricated empty success.
- The run records the resource decision that authorized each committed mutation and an attributable Event/Revision. Recoverability makes an authorized mutation easier to undo; it neither grants consent nor substitutes for intent or access.
- A person can inspect the applicable consent and the narrowest denying ceiling where they are authorized to see it. The explanation must not reveal inaccessible ancestors, resources, or policy details.

## Boundaries and non-goals

- This Capability is not another Page or Database role, a custom role builder, or a replacement for ordinary sharing and source authority.
- It does not decide whether a request is truthful, appropriate for an audience, reversible, or subject to external confirmation; those are separate contracts.
- It does not retain private context in a cache after consent or access changes, and it does not make a local device, vault, or provider available merely by recording consent.

## Acceptance stories

### Allow context without allowing edits

Given a person can view a Page and its agent-context decision is allowed while its agent-edit decision is denied, when they ask an agent to summarize it and then ask the agent to rewrite it, then the summary may use the Page, the rewrite is denied before mutation, and no additional Page role has been created.

### Respect an inherited ceiling

Given a child resource allows agent context but an authorized parent policy denies it, when an agent attempts to retrieve the child, then the effective decision is denied, the child is not used, and an authorized policy editor can see that the parent ceiling prevailed without exposing unrelated private structure.

### Stop on mid-run revocation

Given an agent has begun an authorized multi-resource run, when context consent for one remaining resource is revoked, then the next read of that resource is denied, previously committed authorized changes remain attributable and recoverable, and the run neither reads cached private content nor reports an empty successful result.

## Current evidence

The shared architecture establishes access-before-computation and one Action surface in `templates/content/docs/product/architecture.md`. Current repository code contains access and collaboration substrate, but no evidence yet proves independent resource-level agent context/edit decisions, inherited consent ceilings, effective-decision explanations, or mid-run re-evaluation. This Capability remains `approved_shape`.

## Proof plan

1. Add deterministic Action tests covering every combination of ordinary access, context consent, edit consent, source policy, and inherited ceilings; verify the result is an explicit allow, deny, or unavailable state.
2. Exercise resource selection, search, traversal, agent context assembly, edits, bulk work, queued/recovered work, and provider-backed resources while consent changes; prove every path rechecks effective authority before use.
3. Verify inherited decisions and explanation UI through the real interface, including child narrowing, parent denial, inaccessible ancestors, and policy changes.
4. Verify Events/Revisions, receipts, recovery, and access-safe audit/history after allowed edits, denied writes, and mid-run revocation.

## Open questions

The storage representation for inheritable consent, the precise policy-editor vocabulary, and how a paused run offers its remaining authorized scope are implementation choices. They must preserve the separate decisions, narrowing-only inheritance, use-time re-evaluation, and non-leaking failures above.
