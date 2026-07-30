---
record_type: "capability"
spec_version: 2
id: "content.expression.catalog"
name: "Expression catalog"
user_promise: "Promote a useful expression or variable into a governed reusable definition with clear ownership and version."
primary_user_job: "Promote reusable expressions with controlled version adoption."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.expression.language", "content.template.governance"]
related_features: ["content.feature.put-your-organizations-know-how-to-work"]
roadmap_boundary: "feature"
acceptance_summary: "The catalog governs named Expressions and zero-input Variables with stable identity, scope, descriptions, versions, approvals, provenance, references, inspection, and deliberate adoption."
proof_requirements:
  [
    "An inline expression may be promoted when reuse is real; a zero-input expression is a Variable, not a separate language.",
    "Catalog discovery and mutation honor scope and access, while callers can inspect type, dependencies, provenance, and version.",
    "Adoption records a pinned or following version choice and never silently rewrites a consumer.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Expression catalog

## Why this exists

A useful computation should be reusable without becoming an invisible shared global that changes under its consumers. Teams need to know what it accepts, who owns it, and which version each workflow chose.

## Example workflow

Omar promotes `businessDays(start, end)`, adopts version 1 in two databases, and sees both consumers before publishing a signature-changing version 2.

## Product contract

- An inline expression may be promoted when reuse is real; a zero-input expression is a Variable, not a separate language.
- Catalog discovery and mutation honor scope and access, while callers can inspect type, dependencies, provenance, and version.
- Adoption records a pinned or following version choice and never silently rewrites a consumer.

## Boundaries and non-goals

- `content.expression.language` owns AST/type semantics; catalog governance owns named definition identity, approval, adoption, and version provenance.
- The catalog does not make expressions ambient globals, silently update callers, or create a second Variable language.

## Acceptance stories

### Variables share the language

Given a zero-input entry, when cataloged, then it is a Variable with the same AST and version rules.

### Preserve consumer choice

Given a signature changes, then consumers stay pinned or explicitly follow after impact review.

## Current evidence

`actions/configure-document-property.ts` and template records are donors; no expression catalog, version, or adoption records exist.

## Proof plan

1. Promote inline expressions/Variables with ID, scope, signature, dependencies, provenance.
2. Adopt pinned/following versions in formulas/templates/Rules.
3. Publish signature changes with impact and consumer choice.
4. Test denied scope and unavailable dependencies.

## Open questions

Organization approval requirements remain open.
