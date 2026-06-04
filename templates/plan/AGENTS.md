# Agent-Native Plans — Agent Guide

Agent-Native Plans is a local-first HTML plan mode for coding agents. Its job is
to turn agent plans into diagrams, wireframes, prototype options, annotations,
and comments that a person can review before code changes happen.

## Core Rules

- Follow the root framework rules: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.
- Default to visual artifacts over long Markdown. Text is a fallback layer.
- Current app actions require a real user session so plans stay scoped and
  shareable. Local development can use the framework's auto-created dev account;
  hosted persistence, private sharing, reviewer links, and cross-device/team
  workflows use account login, with Google sign-in shown when the standard
  Google OAuth env vars are configured.
- Surface material assumptions only when they change behavior, data, security,
  tests, deployment, or definition of done.
- Before edits, read pending feedback with `get-plan-feedback`.

## Application State

- `navigation.view` is `plans`, `plan`, `extensions`, or `team`.
- `navigation.planId` identifies the active visual plan when present.
- `navigate` moves the UI to the plan list or a specific visual plan.

## Skills

Use `.agents/skills/visual-plans/SKILL.md` for Agent-Native Plans behavior. Use
`.agents/skills/ui-plan/SKILL.md` for UI-first visual plans where an optional
top pan/zoom wireframe or diagram canvas comes before a refined Notion-like
document with rich tabs, tables, sketchy diagrams, code tabs, comments/drawing
space, and agent handoff. Use
`.agents/skills/visual-questions/SKILL.md` when the agent should ask rich
visual intake questions before creating a plan. Use
`.agents/skills/visualize-plan/SKILL.md` when the agent already has a Codex,
Claude Code, Markdown, or pasted text plan and should create a visual companion.
The exported install flow is simple:
`agent-native skills add plans` installs the `/visual-plan`, `/ui-plan`,
`/visual-questions`, and `/visualize-plan` skills plus the MCP connector. In
Claude Code, Codex, and other supported hosts, users can then type
`/visual-plan` for a fresh general plan, `/ui-plan` for a UI-first plan,
`/visual-questions` for visual intake before a plan, or `/visualize-plan` to
enrich an existing text plan.
Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`,
`frontend-design`, `shadcn-ui`, and `self-modifying-code`.
