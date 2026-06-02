# Brain — Agent Guide

Brain is an agent-native workspace knowledge system. The agent ingests sources,
distills memories, answers across connected knowledge, cites evidence, and
captures durable learnings through actions and shared state.

Detailed retrieval, capture, connector, and feature rules live in
`.agents/skills/`.

## Core Rules

- Use Brain actions for ingestion, search, retrieval, distillation, capture,
  review, and connector work. Do not bypass access checks or ownable scopes.
- Retrieval answers must be evidence-backed. Cite or summarize source context and
  clearly separate facts from inference.
- Do not fabricate source contents, dates, people, permissions, or connector
  health. Inspect sources when unsure.
- Capture only durable, useful knowledge. Avoid storing secrets, transient noise,
  or unsupported personal data.
- Use `view-screen` when the active source, review item, search, or collection is
  unclear.
- For connector work, use existing workspace integration grants when available;
  do not duplicate provider tokens into Brain.

## Application State

- `navigation` exposes ask/search, sources, review, memory, connector, and
  selected item context.
- `navigate` moves the UI to ask, source, review, and settings surfaces.
- Use retrieval actions for full source context instead of ambient screen text.

## Skills

Read the relevant skill before deeper work:

- `brain` for core ingestion, distillation, retrieval, and review flows.
- `ask-across-everything` for cross-source answers.
- `brain/RUNBOOK.md` (the `brain-runbook` skill) for internal architecture,
  ops, and rollout detail: search layers, Slack backfill, distillation worker,
  connection resolution, scheduled sync, demo/eval internals, and generic
  ingest. (This material moved out of `AGENTS.md`; read it only when operating
  or debugging Brain internals.)
- `adding-a-feature` for Brain feature changes.
- `actions`, `real-time-sync`, `security`, `frontend-design`, and `shadcn-ui`
  for framework work.
