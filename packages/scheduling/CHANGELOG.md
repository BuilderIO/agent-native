# @agent-native/scheduling

## 0.1.3

### Patch Changes

- Updated dependencies [bcb2069]
- Updated dependencies [e375642]
  - @agent-native/core@0.8.0

## 0.1.2

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.
- Updated dependencies [4e3631b]
  - @agent-native/core@0.7.85
