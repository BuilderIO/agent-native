# Recruiting — Agent Guide

Recruiting is an agent-native applicant tracking workspace. The agent manages
candidates, pipeline stages, interviews, notes, analysis, and scheduling through
actions and SQL-backed state.

Detailed candidate, pipeline, interview, and analysis rules live in
`.agents/skills/`.

## Core Rules

- Use actions for candidates, pipeline moves, notes, search, interviews,
  scheduling, analysis, navigation, and sharing. Do not bypass ownable access
  checks.
- Be careful with people data. Do not invent candidate facts, evaluation signals,
  or availability; cite the source context you used.
- Keep candidate analysis job-relevant and evidence-backed.
- Use `view-screen` when the active candidate, pipeline, interview, or selection
  is unclear.
- Scheduling must include exact dates, time zones, and assumptions.

## Application State

- `navigation` exposes pipeline, candidate, interview, notes, and selection
  context.
- `navigate` moves the UI to candidates, pipeline, interviews, and settings.

## Skills

Read the relevant skill before deeper work:

- `candidate-management` and `pipeline-workflow` for ATS flows.
- `candidate-analysis` for evidence-backed summaries and fit analysis.
- `interview-scheduling` for calendar/interview coordination.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
