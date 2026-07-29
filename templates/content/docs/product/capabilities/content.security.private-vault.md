---
record_type: "capability"
spec_version: 2
id: "content.security.private-vault"
name: "Private vault encryption"
user_promise: "Private-vault custody can be user-held and fail closed without disguising unresolved recovery, collaboration, or agent authority problems."
primary_user_job: "Keep selected work unreadable to the service while retaining understandable device, recovery, sharing, agent, and exit choices."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "desktop"
dependencies:
  ["content.agent.resource-consent", "content.portability.vault-export"]
related_features: ["content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A reviewed private-vault system establishes user-held cryptographic custody, explicit enrollment and device authorization, fail-closed decryption and recovery, bounded agent plaintext access, revocation, collaboration semantics, and portable exit without claiming readiness before production proof."
proof_requirements:
  [
    "Threat model, protocol, key lifecycle, enrollment, recovery, revocation, and fail-closed tests across supported architectures",
    "Agent-consent, collaboration, merge, export, and unavailable-key authorization tests",
    "Independent security review plus production-like end-to-end device, recovery, revocation, and exit evidence",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Private vault encryption

## Why this exists

Private custody is a promise about who can read, not a decorative lock icon.

## Example workflow

A person enrolls a trusted device, opens a private vault locally, grants one local agent a bounded task, revokes the device, and exports readable authorized material without exposing plaintext to the service.

## Product contract

- User-held cryptographic custody, key enrollment, device authorization, rotation, revocation, and recovery are explicit ceremonies with fail-closed behavior.
- Clients decrypt only vaults and operations they are currently authorized to handle; unavailable keys never coerce to empty or apparently successful content.
- Agent plaintext access is separate bounded consent, not an implication of ordinary sharing or recoverable edit access.
- Collaboration, Versions, comments, access changes, and portable exit must preserve the custody claim or state their limitation plainly.

## Boundaries and non-goals

This is a paused product lane, not a claim that current experiments are production-ready. Vault export owns package semantics; resource consent owns agent scope.

## Acceptance stories

### Fail closed on an unenrolled device

Given a device without the vault key, when it opens a private-vault resource, then it receives an explicit unavailable/enrollment state and no plaintext or plausible empty document.

### Revoke bounded access

Given a device and an agent were separately authorized, when the owner revokes their grants, then subsequent decrypt or task attempts fail and the audit record distinguishes device revocation from agent consent.

## Current evidence

Donor evidence: repository feature records retain the historical research and fork boundary. No repository-local audited protocol, integration, cross-architecture proof, or production receipt supports a complete claim; this record remains `in_progress` and the Feature is paused.

## Proof plan

1. Publish a sanitized protocol and implementation wayfinder with threat boundaries.
2. Test key lifecycle, recovery, revocation, agent consent, collaboration, and portable exit across architectures.
3. Obtain independent review and production-like end-to-end evidence before changing state.

## Open questions

- Recovery ceremony, collaboration cryptography, and supported-device order remain material decisions.
