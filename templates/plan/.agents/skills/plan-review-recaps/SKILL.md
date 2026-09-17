---
name: plan-review-recaps
description: >-
  The `columns` before/after comparison primitive and the PR Visual Recap GitHub
  Action (agent/model env vars, required tokens, sticky comment, informational
  scope). Use when building a recap, configuring recap CI, or explaining a
  Visual Recap check or comment.
---

# Review Recaps

- `columns` is the generic before/after layout primitive for structured
  comparisons. Use it for side-by-side schema, API, prose, and model blocks.
- The PR Visual Recap GitHub Action runs the `visual-recap` skill on each PR via
  an LLM coding agent (Claude Code or Codex, chosen with `VISUAL_RECAP_AGENT`;
  model and reasoning depth via `VISUAL_RECAP_MODEL` / `VISUAL_RECAP_REASONING`)
  when `PLAN_RECAP_TOKEN` and the backend's API key are configured, shows a
  non-required `Visual Recap` check while it runs, then posts a sticky comment
  with an inline screenshot. The recap is informational and must not imply the
  diff has been reviewed.

## Related Skills

- **visual-recap** — how to generate the recap content itself.
- **plan-authoring-flow** — when `/visual-recap` is the right command.
