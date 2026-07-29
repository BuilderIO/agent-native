---
name: content-product-development
description: >-
  Product contracts and proof boundaries for Agent Native Content. Use when
  planning, implementing, reviewing, testing, or documenting Content behavior
  or shared framework behavior that changes Content.
scope: dev
metadata:
  internal: true
---

# Develop Agent Native Content

## Rule

Before changing Content, identify the user workflow, Feature, and atomic
Capabilities the work touches. Implement through Content's shared primitives,
then prove the affected workflow before claiming a Capability or Feature is
complete.

The roadmap is direction, not a substitute for current code. Current code is
evidence, not permission to invent a conflicting product contract.

## Retrieve the right context

The repository source of truth lives in `templates/content/docs/product/`.

1. Read [architecture.md](../../../docs/product/architecture.md).
2. Find the workflow in [roadmap.md](../../../docs/product/roadmap.md), or search
   the Feature records:

   ```sh
   rg -n "<workflow or Feature>" templates/content/docs/product/features
   ```

3. Read the Feature's required and enhancing Capability records by stable ID.
4. Inspect the current implementation, tests, feature flags, and provider state.

Load only the relevant records. Do not paste the encyclopedia into the context
and hope the important sentence floats to the top.

If a required record is missing, name the missing ID. A narrow bug fix may still
proceed when tests and existing behavior make the contract unambiguous; record
the context gap in the handoff.

## Classify the change

| Lane | Meaning | Response |
| --- | --- | --- |
| Contract repair | Existing behavior violates an accepted contract | Fix the smallest coherent path and prove the regression |
| Contract fulfillment | Work implements or hardens an incomplete Capability | Follow its dependencies and proof requirements |
| Local refinement | Reversible polish that does not change the promise | Implement without manufacturing a strategy meeting |
| Product decision candidate | Work changes identity, access, source truth, a shared primitive, or the user promise | Preserve the user problem and tradeoff for review before making it architecture |

The catalog welcomes new ideas. It prevents accidental decisions; it does not
require a permission slip for every useful bug fix.

## Preserve the architecture

- Stable objects may have many Views, memberships, embeds, and source mappings.
- People, agents, automations, APIs, and UI use one typed Action surface.
- Access applies before search, traversal, Queries, aggregates, exports, or AI.
- Sources declare truth and write-back policy; unknown provider data survives.
- Meaningful change preserves actor, origin, history, recovery, and review.
- Content remains portable and does not demand custody of connected originals.
- Donor code and completed dependencies do not prove a whole contract.

Load the domain skill for the work, especially `actions`, `security`, `sharing`,
`storing-data`, `portability`, `real-time-collab`, or `real-time-sync`.

## Prove and record the result

Use the affected Capability's proof requirements and the Feature's example
workflow. Read [references/verification.md](references/verification.md) for the
cross-surface matrix.

A Capability becomes `verified` only when its complete atomic contract passes.
A Feature becomes `available` only when every required Capability is verified
and its complete example workflow passes end to end. Useful machinery remains
substrate until then.

Update atomic records when work changes a contract, dependency, state, non-goal,
proof boundary, or accepted Feature workflow. Regenerate projections and run:

```sh
pnpm guard:content-product-docs --write
pnpm guard:content-product-docs
```

## Handoff

```text
Product context: <Feature and Capability IDs>
Workflow: <what now works>
Proof: <tests and real-interface evidence>
Remaining gaps: <failures or missing evidence>
Product decisions: <none or accepted/candidate decision>
Record updates: <files changed or still needed>
```
