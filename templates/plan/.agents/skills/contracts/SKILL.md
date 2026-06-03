---
name: contracts
description: >-
  Legacy alias for Agent-Native Plans. Use this when older instructions ask for
  Contracts; prefer the visual-plans skill and Plans MCP tools.
---

# Contracts Alias

Contracts has been renamed to **Agent-Native Plans**.

Use `.agents/skills/visual-plans/SKILL.md` for current behavior. If this legacy
skill is already installed, create an interactive HTML plan before
implementation, surface the MCP app or browser link, collect annotations, call
`get-plan-feedback`, and attach proof with `record-plan-evidence`.

If the user already has a Codex, Claude Code, Markdown, or pasted text plan,
prefer the `visualize-plan` companion flow to import it and add visual review
surfaces instead of starting over.

Preferred tools:

- `create-visual-plan`
- `visualize-plan`
- `update-visual-plan`
- `get-visual-plan`
- `get-plan-feedback`
- `record-plan-progress`
- `record-plan-evidence`
- `export-visual-plan`
