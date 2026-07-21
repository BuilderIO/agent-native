# @agent-native/recap-cli

## 0.5.0

### Minor Changes

- f8fe58b: Add `VISUAL_RECAP_REQUIRED_LABELS` so PR Visual Recap can run only when a pull request has an opt-in label.

## 0.4.7

### Patch Changes

- 687fefc: Bundle the visual recap workflow as a package asset instead of an escaped source string.

## 0.4.6

### Patch Changes

- fb32d85: Run configurable PR Visual Recap jobs with Bash on every runner platform.

## 0.4.5

### Patch Changes

- 570be31: Skip visual recap publishing when the authoring agent does not produce recap source.

## 0.4.4

### Patch Changes

- a485fbe: Refuse to capture PR recap screenshots until the rendered document is ready, preventing loading skeletons from being posted as previews.

## 0.4.3

### Patch Changes

- 9f2f7a7: Refuse to capture PR recap screenshots until the rendered document is ready, preventing loading skeletons from being posted as previews.

## 0.4.2

### Patch Changes

- 2625de5: Refuse to capture PR recap screenshots until the rendered document is ready, preventing loading skeletons from being posted as previews.

## 0.4.1

### Patch Changes

- bc29c82: Retry visual recap publishing once with a focused source-repair turn when the hosted Plan parser rejects malformed MDX.

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
