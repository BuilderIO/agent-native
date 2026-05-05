# @agent-native/dispatch

## 0.2.3

### Patch Changes

- dca4f6d: Replace native title hints on interactive controls with shadcn tooltips.
- dca4f6d: Expose Dispatch Tailwind source directives, preserve the packaged index route redirect in the template shell, and show Dispatch navigation/chat controls at desktop sizes.

## 0.2.2

### Patch Changes

- e375642: Add `@agent-native/core/usage` subpath export for `getUsageSummary` so server-side consumers (Cloudflare Workers / Pages) can import it without hitting the curated browser entry. Switch dispatch's usage-metrics store to the new subpath, fixing the dispatch CF Pages build failure.
- Updated dependencies [bcb2069]
- Updated dependencies [e375642]
  - @agent-native/core@0.8.0

## 0.2.1

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.
- Updated dependencies [4e3631b]
  - @agent-native/core@0.7.85

## 0.2.0

### Minor Changes

- a75a89c: Add Dispatch workspace usage metrics and preserve app ids in token usage rows.

### Patch Changes

- a75a89c: In Builder.io's editor frame, `sendToAgentChat` now keeps content prompts self-targeted so the embedded app's own `AgentSidebar` receives them. Code requests still delegate to Builder via `builder.submitChat`. Drops the explicit `isInBuilderFrame()` branching from dispatch's home composer — the routing now lives in core.
- a75a89c: Recommend Dispatch more clearly during workspace scaffolding and add a packaged Dispatch extension API for workspace-owned tabs.
- Updated dependencies [a75a89c]
- Updated dependencies [a75a89c]
- Updated dependencies [a75a89c]
- Updated dependencies [a75a89c]
  - @agent-native/core@0.7.84
