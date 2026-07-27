# Centralized feature flags — work ledger

## Settled

- Boolean, source-declared flags only.
- Analytics is the sole rollout-management UI.
- Targeted rollout supports exact emails, organization IDs, and a stable
  percentage with OR semantics.
- Experiment lifecycle, variants, hypotheses, metrics, and exposure tracking
  are non-goals.
- Per-app management panels are removed; server enforcement and client
  presentation share the registered key.
- Fable reviewed and agreed with the reduced architecture.

## Verified

- Core, Analytics, Design, and Clips focused tests pass.
- Core, Analytics, Design, and Clips typechecks pass.
- The Core package build and workspace skill synchronization guard pass.
- Browser QA covers ready, no-definition, and unreachable apps plus the
  Off/Targeted/Everyone rollout editor.
- Product experiment, exposure, decision, and rollout-epoch surfaces are absent
  from the shipped feature-flag paths.

## Deferred

- Audit-history timeline UI.
- Orphaned rollout-state discovery and cleanup.
- Personalized SSR hydration.
- Non-boolean flags or product experimentation.
