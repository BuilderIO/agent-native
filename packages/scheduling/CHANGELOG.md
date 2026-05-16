# @agent-native/scheduling

## 0.1.5

### Patch Changes

- 79a0eb9: Align local Drizzle peer resolution with the framework's libsql driver version.

## 0.1.4

### Patch Changes

- 97ca0db: Fix "Cannot read properties of null (reading 'value')" crash in `BookingLinkCreateDialog` when typing into the slug input. React nulls `e.currentTarget` once the synthetic event finishes synchronous propagation; reading it inside the `setForm` updater closure happened after that point. Capture the value before calling `setForm`.

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
