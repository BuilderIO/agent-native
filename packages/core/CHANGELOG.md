# @agent-native/core

## 0.8.1

### Patch Changes

- e3a8798: Recover agent chat runs automatically when streams time out, disconnect, or stay open without producing progress.

## 0.8.0

### Minor Changes

- e375642: Add `@agent-native/core/usage` subpath export for `getUsageSummary` so server-side consumers (Cloudflare Workers / Pages) can import it without hitting the curated browser entry. Switch dispatch's usage-metrics store to the new subpath, fixing the dispatch CF Pages build failure.

### Patch Changes

- bcb2069: Hide partial assistant text from transient agent-chat continuations while retaining it as continuation history.
  Recover agent chat streams that stay connected but stop producing progress events.

## 0.7.85

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.

## 0.7.84

### Patch Changes

- a75a89c: In Builder.io's editor frame, `sendToAgentChat` now keeps content prompts self-targeted so the embedded app's own `AgentSidebar` receives them. Code requests still delegate to Builder via `builder.submitChat`. Drops the explicit `isInBuilderFrame()` branching from dispatch's home composer — the routing now lives in core.
- a75a89c: Add Dispatch workspace usage metrics and preserve app ids in token usage rows.
- a75a89c: Recommend Dispatch more clearly during workspace scaffolding and add a packaged Dispatch extension API for workspace-owned tabs.
- a75a89c: Add server-side 302 redirect from `/tools` and `/tools/:id` page routes to `/extensions/...` so existing bookmarks for the renamed primitive keep working. Honors `APP_BASE_PATH` for workspace deployments.
