# @agent-native/recap-cli

## 0.5.24

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.23

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.22

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.21

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.20

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.19

### Patch Changes

- 4776e61: Reduce CI lint warnings across publishable packages.
- Release all public npm packages with a patch version bump.

## 0.5.18

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.17

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.16

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.15

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.14

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.13

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.12

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.11

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.10

### Patch Changes

- Release all public npm packages with a patch version bump.
- a4b36e0: Stop billing cached prompt tokens twice, and normalize what `inputTokens` means
  across every engine.

  Providers disagree: OpenAI's `prompt_tokens` includes cached tokens, Anthropic's
  `input_tokens` excludes them. The `usage` event never said which it carried, so
  both conventions reached `calculateCost`, which charged `inputTokens` at the
  full input rate and then added `cacheReadTokens` / `cacheWriteTokens` on top.
  On a long cached conversation the cache is nearly the whole prompt, so a turn
  that cost $0.0054 was reported as $0.0478 — and every `token_usage` row for an
  OpenAI-family model was inflated the same way.
  - The `usage` event now documents one convention: `inputTokens` is the whole
    prompt and INCLUDES both cache counts, which are a slice of it rather than an
    addition. This matches the AI SDK's own `inputTokens.total` / `noCache` /
    `cacheRead` / `cacheWrite` normalization, and the Builder gateway.
  - `anthropic-engine` was the only ENGINE reporting the exclusive form. It now
    adds the cache counts back, which also fixes its prompt size: a fully cached
    turn used to report ~3 input tokens instead of the real 42,438.
  - `calculateCost` treats the three counts as a partition and prices each token
    exactly once. Callers with no prompt caching pass zeroes and are unaffected.

  The recap CLI carried all three conventions at once and now shares this one:
  `parseClaudeUsage` adds Anthropic's cache counts back into the prompt,
  `parseCodexUsage` no longer strips OpenAI's cached tokens out of it (it did that
  to compensate for the old pricing formula, so keeping both would have swung the
  error the other way), and `parseOpenAiCompatibleUsage` was already correct.

## 0.5.9

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.8

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.5.7

### Patch Changes

- 95d9d70: Bound public-site monitor requests and clarify unified-diff framing in visual recap authoring prompts.

## 0.5.6

### Patch Changes

- 10de7b9: Remove unused imports and unreachable declarations. Dispatch drops unused
  imports from its layout, transactional email pages, and MCP gateway;
  creative-context drops unused type imports and an unread `headingStyle`;
  recap-cli drops the `node:os` import and two unread locals; skills drops the
  unreferenced `maybeUpdateInstructions` helper; toolkit drops unused imports and
  an unread `REALTIME_VOICE_REQUEST_SOURCE`. No runtime behavior changes.
  `eslint/no-unused-vars` is now an oxlint error instead of a warning, so CI
  blocks new ones.

## 0.5.5

### Patch Changes

- 16cbc53: Stop PR Visual Recap gate skips from creating visible pull request comments.

## 0.5.4

### Patch Changes

- 061896a: Use the recap CLI package as the single implementation source for Core's recap skill, Plan block, and publish-token helpers while preserving Core compatibility exports.

## 0.5.3

### Patch Changes

- d6e7c5c: Stop shipping unused Playwright packages to consumers. `@agent-native/core`
  declared `playwright` in both `devDependencies` and `optionalDependencies`
  without ever importing it at runtime; the optional entry is gone, so it no
  longer installs for every consumer. `@agent-native/recap-cli` no longer
  declares `@playwright/test` as an optional dependency — its sibling `playwright`
  optional dependency always resolved first, so the `@playwright/test` fallback
  import could never be reached. That fallback now rethrows the original
  `playwright` failure instead of a misleading "cannot find `@playwright/test`".
- d6e7c5c: Stop a second Chromium from being downloaded alongside the one already on disk.

  First-party workspace packages now take Playwright from an exact catalog pin, so
  a caret cannot resolve forward to a release tied to a different Chromium
  revision. The two packages that declare Playwright as a published optional
  dependency — `@agent-native/creative-context` and `@agent-native/recap-cli` —
  deliberately keep a caret range instead: an exact range in a library stops a
  consumer who already has a different Playwright from deduping, which forces a
  nested copy and downloads exactly the second browser this change exists to
  avoid.

## 0.5.2

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

## 0.5.1

### Patch Changes

- 03a043e: Retry transient recap document-load timeouts and only embed screenshot previews when both light and dark themes are available.

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
