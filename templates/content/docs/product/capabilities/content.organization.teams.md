---
record_type: "capability"
spec_version: 2
id: "content.organization.teams"
name: "Organization teams"
user_promise: "Canonical framework-wide Team membership can be managed through Content without giving each app a conflicting identity system."
primary_user_job: "Manage organizational Teams where work is configured while preserving one framework identity authority."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "organization"
dependencies: ["content.workspace.multi-scope", "content.access.page-database"]
related_features:
  [
    "content.feature.work-across-every-workspace",
    "content.feature.share-how-your-organization-works",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Content manages the framework-wide Team representation through canonical organization identity and membership services."
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

# Organization teams

## Why this exists

One Team membership truth prevents each app from growing a conflicting roster. Content may manage it without becoming a second identity provider.

## Example workflow

An organization administrator creates a Team in Content, assigns members under the existing organization, and uses it in a Page access rule. Another app reads the same canonical Team membership.

## Product contract

Content manages the framework-wide Team representation through canonical organization identity and membership services. Team changes use authorized Actions, audit history, and propagate to compatible access and workflow surfaces.

## Boundaries and non-goals

Multi-scope and page/database access own context and authorization. This is not an app-local roster, automatic organization creation, or an alternate identity provider.

## Acceptance stories

### Deny an app-local roster edit

Given a non-administrator, when they try to change Team membership, then the canonical Action denies it and no app-local fallback is created.

### Propagate a canonical Team change

Given a Team is used in a Page rule, when an authorized administrator changes membership, then compatible consumers observe the canonical membership with attributable audit history.

## Current evidence

No complete framework-wide Team management and consumer-consistency proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test canonical Team membership changes for administrators and non-administrators.
2. Verify consumer reads, access rules, audit records, propagation, and no local fallback.
3. Exercise revocation, sync conflict, organization boundaries, and accessible management.

## Open questions

The organization-admin delegation and membership-sync conflict policy need design.
