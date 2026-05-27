---
name: migration
description: >-
  Migration Workbench operating loop for path, URL, or description-based
  migrations. Use when creating, advancing, verifying, or reporting a migration
  run.
---

# Migration Workbench

## Rule

Treat every migration as a resumable goal with a source reference, a target, an
approved plan, bounded output writes, and verifier evidence.

## Workflow

1. Capture the source as a path, URL, or description. Local paths may be
   introspected directly; URLs and descriptions need an adapter-specific
   inventory before output work.
2. Create or select the run, then use `run-migration-goal` to advance safely.
3. If the customer has a migration profile, set it with
   `update-migration-plan-inputs` before planning. Treat those inputs as binding
   route ownership, AEM, Builder, jQuery, headless, and verification constraints.
4. Stop when approval is required. Never write generated output before
   `approved` is true.
5. After approval, run bounded sweeps and verification. Use the returned
   `criticDecision` to decide whether to retry, tune, ask for a manual decision,
   roll back generated output, or accept.
6. Reference artifacts under `data/migration-runs/<runId>/` for assessment,
   plan inputs, plan, tasks, verifier results, and the report.

## Actions

- `run-migration-goal`: preferred goal-driven advance action.
- `update-migration-plan-inputs`: set a custom profile before planning.
- `view-screen`: inspect the selected run and goal state.
- `navigate --runId <id>`: open a run in the Workbench UI.

## Related Skills

`migration-source-nextjs`, `migration-source-aem`, `migration-target-builder`,
`actions`, `security`
