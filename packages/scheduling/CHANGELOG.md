# @agent-native/scheduling

## 0.1.18

### Patch Changes

- Updated dependencies [9d8c83c]
- Updated dependencies [9d8c83c]
  - @agent-native/toolkit@0.4.0

## 0.1.17

### Patch Changes

- Updated dependencies [277d115]
  - @agent-native/toolkit@0.3.0

## 0.1.16

### Patch Changes

- b24446e: Add `@agent-native/toolkit` for reusable app-building UI, move shared template primitives into it, and keep core UI shim imports working through compatibility re-exports.
- Updated dependencies [b24446e]
  - @agent-native/toolkit@0.2.0

## 0.1.15

### Patch Changes

- 6338989: Add Traditional Chinese copy for shared scheduling booking-link components.

## 0.1.14

### Patch Changes

- 2a03c35: Adopt the native TypeScript and oxfmt package build baselines.

## 0.1.13

### Patch Changes

- fd78baa: Localize Dispatch workspace pages and scheduling booking-link controls.

## 0.1.12

### Patch Changes

- c294aaa: Expand localized UI coverage across core client surfaces, Dispatch chrome, scheduling controls, templates, and the docs site.

## 0.1.11

### Patch Changes

- 3c1d3eb: Update dispatch provider APIs and scheduling internals for the runtime refresh.

## 0.1.10

### Patch Changes

- 966838d: Update scheduling package docs after removing the legacy scheduling template.

## 0.1.9

### Patch Changes

- a56d93d: Remove unused imports, dead state, no-op plugin hooks, and debug logging from package internals.
- a56d93d: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.

## 0.1.8

### Patch Changes

- 853ab71: Internal cleanup: remove unused imports and variables (no behavior change).

## 0.1.7

### Patch Changes

- d4013f0: Remove unused imports, dead state, no-op plugin hooks, and debug logging from package internals.
- d4013f0: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.

## 0.1.6

### Patch Changes

- c3852e0: Beta-readiness best-practices audit fixes:
  - **core / sharing:** `mergeCoreSharingActions` now preserves
    `toolCallable`/`publicAgent`/`link`/`mcpApp` (via `preserveActionFlags`),
    restoring the H5 tools-bridge `403` guard on share/unshare/set-visibility that
    was silently dropped during registry merge.
  - **core / HTTP actions:** stop echoing raw `error.message` on uncategorized 500s
    (return a generic message, log detail server-side); validation and explicit
    user-facing errors still pass through.
  - **core / auth:** remove the legacy hardcoded fallback secret literal from the
    production `BETTER_AUTH_SECRET` error message. (The `better-auth` security
    version bump is deferred to a dedicated follow-up: `1.6.12` pulls
    `kysely@0.29` which drops exports `better-auth` bundles, breaking the template
    build — it needs a kysely-compatibility fix + an auth smoke-test.)
  - **core / dev:** register `client/transcription/use-live-transcription` in the
    Vite source-alias map so monorepo dev edits resolve from source, not stale
    `dist`.
  - **core:** add `engines.node >=22`; correct the `AuthSession.orgId` doc comment
    (orgs are framework-managed, not the Better Auth organization plugin).
  - **scheduling:** remove the leftover manual `release` script (publishing goes
    through changesets/CI).
  - **shared-app-config:** clarify that the template-catalog `icon` field is an
    internal icon-alias key resolved by the desktop sidebar `ICON_MAP`, not a raw
    `@tabler/icons-react` export name.

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
