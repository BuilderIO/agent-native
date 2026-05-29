# Migration — Agent Guide

Migration is an agent-native app for assessing source sites/apps and planning or
executing migrations to Builder/agent-native targets.

Detailed source, target, and migration-flow rules live in `.agents/skills/`.

## Core Rules

- Use actions for source discovery, migration plans, mapping, tasks, progress,
  navigation, and result artifacts. Do not bypass access checks.
- Preserve source behavior and content semantics. Do not invent migrated state or
  claim completion without evidence.
- Keep migration plans actionable: source inventory, target mapping, risks,
  blockers, and next steps.
- Use `view-screen` when the active migration, source item, target, or progress
  context is unclear.
- For Builder targets, use the existing migration target skill and framework
  handoff patterns.

## Application State

- `navigation` exposes migration, source, target, mapping, task, and progress
  context.
- `navigate` moves the UI to source inventory, mapping, task, and result views.

## Skills

Read the relevant skill before deeper work:

- `migration` for the overall flow.
- `migration-source-aem` and `migration-source-nextjs` for source-specific work.
- `migration-target-builder` for Builder target behavior.
- `adding-a-feature`, `actions`, `security`, `frontend-design`, and `shadcn-ui`
  for framework work.
