---
record_type: "capability"
spec_version: 2
id: "content.expression.language"
name: "Typed expression language"
user_promise: "Use one understandable expression language whenever a configuration needs computation."
primary_user_job: "Configure computation once across Content surfaces."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: []
related_features:
  [
    "content.feature.make-the-workspace-yours",
    "content.feature.data-that-keeps-itself-right",
    "content.feature.build-living-dashboards",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Expressions share one typed AST and editor across formulas, views, validation, Rules, schedules, body configuration, and reusable definitions; zero-input expressions are Variables, while references remain stored typed values."
proof_requirements:
  [
    "Stored references preserve identity without executing; expressions can return, compare, traverse, or render typed values.",
    "The type system, dependency graph, and access checks are shared by every consumer rather than each surface inventing a dialect.",
    "Compile, type, cycle, unavailable-input, and access failures stay distinguishable from a valid empty result.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Typed expression language

## Why this exists

Configuration becomes untrustworthy when each surface invents its own formula, filter, or rule syntax. People need one way to understand computation and one set of honest diagnostics when it cannot be evaluated.

## Example workflow

Inez previews a formula against a row, reuses its AST in validation, and sees a cycle before saving either configuration.

## Product contract

- Stored references preserve identity without executing; expressions can return, compare, traverse, or render typed values.
- The type system, dependency graph, and access checks are shared by every consumer rather than each surface inventing a dialect.
- Compile, type, cycle, unavailable-input, and access failures stay distinguishable from a valid empty result.

## Boundaries and non-goals

- Typed Properties, Views, Rules, and Templates consume this language; none owns a competing evaluator or private grammar.
- Expressions do not replace stable References, bypass access, or collapse invalid, unavailable, and empty values into one result.

## Acceptance stories

### Keep references distinct

Given `@Project`, when stored, then it remains a typed reference; `@Project.Status` is computation.

### Explain impossible computation

Given a cycle or unreadable query, then typechecking reports that distinct cause.

## Current evidence

`actions/configure-document-property.ts`, `shared/properties.ts`, and `shared/nfm.ts` are donors; common AST/typechecking/access-scoped query semantics are absent.

## Proof plan

1. Parse/typecheck/round-trip formulas, filters, validation, Rules, schedules, and body contexts.
2. Test references and access separately.
3. Detect cycles, missing values, stale input, and denied query handles.
4. Compare two editors' persisted AST and diagnostics.

## Open questions

Syntax and initial built-ins remain open.
