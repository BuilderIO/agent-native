# @agent-native/shared-app-config

## 0.1.2

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

## 0.1.1

### Patch Changes

- daeb0a9: Publish reusable Agent-Native workspace packages publicly with provenance metadata.
