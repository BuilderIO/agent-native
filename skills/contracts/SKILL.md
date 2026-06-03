---
name: contracts
description: >-
  Legacy alias for Visual Plans. Use this when older instructions ask for
  Contracts; prefer the visual-plans skill and Visual Plans MCP tools.
metadata:
  visibility: exported
---

# Contracts Alias

Contracts has been renamed to **Visual Plans**.

Use `visual-plans` for new work:

```bash
npx @agent-native/core@latest skills add visual-plans
```

If this legacy skill is already installed, follow the Visual Plans behavior:
create an interactive HTML plan before implementation, surface the MCP app or
browser link, collect annotations, call `get-plan-feedback`, and attach proof
with `record-plan-evidence`.

Preferred tools:

- `create-visual-plan`
- `update-visual-plan`
- `get-visual-plan`
- `get-plan-feedback`
- `record-plan-progress`
- `record-plan-evidence`
- `export-visual-plan`

Legacy `*-contract` tools may still exist for compatibility, but do not prefer
them for new runs.
