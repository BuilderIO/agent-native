# @agent-native/recap-cli

## 0.4.0

### Minor Changes

- 7cfb087: Publish PR Visual Recap helpers as a dependency-light CLI package so recap workflows no longer install the full Agent-Native framework dependency graph.

### Patch Changes

- 7cfb087: Default the Claude backend of the PR Visual Recap workflow to `claude-sonnet-5` when `VISUAL_RECAP_MODEL` is unset, instead of falling through to the Claude Code CLI's own (expensive Opus-tier) default — keeping automated recaps on a cost-efficient model by default. The Codex and openai-compatible backends are unaffected.
- 7cfb087: Cap the visual-recap skill's browser render-inspect-fix loop at one re-render, and note that the recap's canonical shape/budgets are also a cost ceiling, to keep interactive recap generation from re-iterating or re-reading the full diff indefinitely.

## 0.3.0

### Minor Changes

- f25194e: Publish PR Visual Recap helpers as a dependency-light CLI package so recap workflows no longer install the full Agent-Native framework dependency graph.

### Patch Changes

- f25194e: Default the Claude backend of the PR Visual Recap workflow to `claude-sonnet-5` when `VISUAL_RECAP_MODEL` is unset, instead of falling through to the Claude Code CLI's own (expensive Opus-tier) default — keeping automated recaps on a cost-efficient model by default. The Codex and openai-compatible backends are unaffected.
- f25194e: Cap the visual-recap skill's browser render-inspect-fix loop at one re-render, and note that the recap's canonical shape/budgets are also a cost ceiling, to keep interactive recap generation from re-iterating or re-reading the full diff indefinitely.

## 0.2.0

### Minor Changes

- a6742d1: Publish PR Visual Recap helpers as a dependency-light CLI package so recap workflows no longer install the full Agent-Native framework dependency graph.
