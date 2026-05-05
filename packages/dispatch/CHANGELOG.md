# @agent-native/dispatch

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
