# Visual Plans — Agent Guide

Visual Plans is a local-first HTML plan mode for coding agents. Its job is to
turn agent plans into diagrams, wireframes, options, annotations, progress, and
proof gates that a person can review before code changes happen.

## Core Rules

- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.
- Default to visual artifacts over long Markdown. Text is a fallback layer.
- Keep proof gates separate from agent claims. Evidence and verification are
  separate.
- Surface material assumptions only when they change behavior, data, security,
  tests, deployment, or definition of done.
- Before edits, read pending feedback with `get-plan-feedback`.

## Application State

- `navigation.view` is `plans`, `plan`, `extensions`, or `team`.
- `navigation.contractId` identifies the active visual plan when present. The
  field name is legacy storage vocabulary; treat it as the plan ID.
- `navigate` moves the UI to the plan list or a specific visual plan.

## Skills

Use `.agents/skills/visual-plans/SKILL.md` for Visual Plans behavior.
Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`,
`frontend-design`, `shadcn-ui`, and `self-modifying-code`.
