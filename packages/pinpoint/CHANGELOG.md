# @agent-native/pinpoint

## 0.1.10

### Patch Changes

- 2a03c35: Adopt the native TypeScript and oxfmt package build baselines.

## 0.1.9

### Patch Changes

- a784d3c: Update user-facing `npx` guidance to recommend explicit `@latest` package invocations.

## 0.1.8

### Patch Changes

- a56d93d: Remove unused imports, dead state, no-op plugin hooks, and debug logging from package internals.

## 0.1.7

### Patch Changes

- d4013f0: Remove unused imports, dead state, no-op plugin hooks, and debug logging from package internals.

## 0.1.6

### Patch Changes

- 3107f96: Preserve MCP tool error and read-only metadata through action execution, and allow Pinpoint's empty test suite to pass intentionally.

## 0.1.5

### Patch Changes

- 1ba9738: Keep the pinpoint toolbar inside the viewport when the agent sidebar is open by tracking the visible sidebar width via MutationObserver + ResizeObserver and clamping toolbar position + drag bounds.

## 0.1.4

### Patch Changes

- Updated dependencies [bcb2069]
- Updated dependencies [e375642]
  - @agent-native/core@0.8.0

## 0.1.3

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.
- Updated dependencies [4e3631b]
  - @agent-native/core@0.7.85
