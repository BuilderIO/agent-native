---
record_type: "capability"
spec_version: 2
id: "content.source.sync-policy"
name: "Source sync policy"
user_promise: "Each connected Source declares one plain-language policy for refresh and write-back: View only, Keep in sync, or Review before write-back."
primary_user_job: "Connect work that remains trustworthy without deciding on every edit whether it should leave Content."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.source.catalog", "content.event.committed"]
related_features:
  [
    "content.feature.trust-your-connected-sources",
    "content.feature.bring-your-local-work",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A Source has one inspectable policy, applies only authorized compatible changes through its declared ownership routes, stops real conflicts for review, and records receipts without confusing queued, failed, or unreviewed work with synchronization."
proof_requirements:
  [
    "Policy selection and enforcement through shared Actions and the interface",
    "Per-field or representation ownership, access intersection, base revisions, deterministic routing, conflict, retry, and receipt behavior",
    "End-to-end View only, Keep in sync, and Review before write-back workflows with provider-side verification",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Source sync policy

## Why this exists

Connected work should not turn every ordinary edit into a synchronization
dialog. People need to understand whether Content is only showing a Source,
keeping compatible work aligned automatically, or preparing a deliberate
outbound review. A familiar access role such as **Can view** answers who may
read Content; it does not answer whether Content may write to a provider.

## Example workflow

An editor connects a collection whose body is provider-owned and whose
annotations are Content-owned. They choose **Review before write-back**. A
body edit becomes one typed outbound change set with its base revision, while
an annotation saves in Content immediately. After review, the provider accepts
the body change and Content records a receipt. If the provider changed the
same body incompatibly, automatic application stops and the editor sees a
typed conflict rather than a plausible but incorrect "synced" state.

## Product contract

### Configure once, follow predictably

- Every Source declares exactly one user-facing policy: **View only**, **Keep
  in sync**, or **Review before write-back**. Adapters may offer only the
  policies their certified capabilities can honor.
- **View only** refreshes authorized inbound Source changes into Content and
  never writes Content-originated changes back to that Source.
- **Keep in sync** automatically applies compatible, authorized inbound and
  outbound changes. It is not permission for last-writer-wins: a real conflict
  stops automatic application for review.
- **Review before write-back** may refresh inbound changes according to the
  adapter contract, but bundles Content-originated changes into a typed,
  reviewable outbound change set before provider mutation.
- The policy configures synchronization, not human access. An operation must
  satisfy Content access, Source scope and approval, adapter capability,
  provider grant, field or representation ownership, and the selected policy.
  Passing one layer never implies the others.

### Ownership routes one edit once

- Each Source-backed value declares its Source/property or representation
  identity, baseline, writable directions, and conflict rule. A Source can own
  a body while Content owns comments, view configuration, or other native
  metadata on the same Page.
- An ordinary edit follows that declared route without repeated prompts. A
  Database membership or a Query projection never fans the edit out to other
  Sources; intentional multi-destination work belongs to an explicit Rule,
  mirror, or Automation with per-destination outcomes.
- A computed, aligned, or otherwise ambiguous projection is read-only until an
  authorized unambiguous route is declared. Creating through a composite
  surface requires one inferable target or a choice of target.
- Provider lifecycle transitions, including publication, remain separate
  guarded operations. Editing content or successfully syncing it never
  silently changes Draft, Published, or another provider lifecycle state.

### Conflict, retry, and receipts tell the truth

- Outbound work carries the relevant base revision and identity. The adapter
  checks freshness before applying it; an incompatible upstream change becomes
  a visible conflict or rebase/review state, not a silent overwrite.
- A queued change is waiting for authority or transport and is not synced. A
  reviewable change is not sent until approved. A failed or unknown outcome is
  distinguishable from a provider-confirmed success.
- Each attempt records actor, origin, policy, affected representations, base,
  destination outcome, and a provider receipt when available. Retrying uses
  stable operation identity so a recovered request does not duplicate effects.

## Boundaries and non-goals

- The Sources catalog owns Source discovery, approval, scope, and connection
  metadata. Adapters own provider-specific operations and certification.
- Human roles and Page/Database access are owned by the access capabilities;
  this policy adds no second permission system.
- Portable representations and unknown-data preservation belong to faithful
  round-tripping. This record decides when a permitted write may travel, not
  how every provider format is encoded.
- This Capability does not promise every adapter automatic bidirectional sync,
  offline write queue, lifecycle transition, or generic conflict UI.

## Acceptance stories

### Keep compatible work synchronized without accidental publication

Given an authorized writable Source with **Keep in sync** and compatible
field ownership, when an editor changes a supported Source-owned field, then
the adapter applies the change once, records an Event and provider receipt,
and leaves provider publication state unchanged.

### Stop a genuine conflict instead of overwriting it

Given a queued outbound change based on revision A and an incompatible provider
change since A, when synchronization resumes, then Content marks the work as a
typed conflict for review, preserves both inputs, and does not report it as
synced or retry it as if the base still matched.

### Keep reviewable write-back reviewable

Given a Source configured for **Review before write-back**, when an authorized
editor changes two compatible provider-owned representations, then Content
creates one typed change set with both changes and their bases; no provider
mutation occurs until the required review decision succeeds.

## Current evidence

Existing change sets, guarded writes, source metadata, local synchronization,
and audit records provide useful donor machinery. They do not yet prove one
plain-language policy across adapters, ownership-aware routing everywhere,
reliable receipt semantics, or the full interface workflow. This Capability
therefore remains `approved_shape`.

## Proof plan

1. Exercise each policy through shared Actions and the interface with
   authorized and unauthorized read, write, review, and lifecycle requests.
2. Verify per-field and representation ownership, projected-value routing,
   multi-membership non-fan-out, base checks, retries, idempotency, and durable
   receipts under refresh, disconnect, and restart.
3. Create compatible concurrent changes and incompatible conflicts for at least
   two independently certified adapters; verify neither generic behavior nor a
   provider success is inferred from the other.
4. Run access, approval, grant, capability, and policy intersection tests
   through searches, Queries, agents, UI edits, and background work.

## Open questions

- The advanced presentation of directional read, watch, and write controls is
  still open, provided it cannot contradict the three plain-language policies.
- The common conflict-resolution vocabulary and retention rules for provider
  receipts need design alongside the review surface.
