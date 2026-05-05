# @agent-native/core

## 0.9.1

### Patch Changes

- 4090a2a: PR #511 follow-up fixes:
  - `/runs/active` now surfaces recently-completed and recently-errored SQL runs (within a 10-minute reconnect window) so the agent-chat adapter can replay synthesized done/error events from the run-events stream instead of retrying the original POST when the producer's in-memory state was already evicted (different serverless isolate). Without this, a POST that failed after the server already accepted and finished the run could re-execute the agent turn and double-apply mutations.
  - `/builder/status` now reads the user's active org via `getOrgContext(event)` and passes the orgId into `runWithRequestContext()` so the status poller resolves org-shared Builder credentials. Previously, an admin's org-scope OAuth result was invisible to every other org member's status poller, leaving the UI showing "not connected" even though chat resolved the credentials correctly.
  - Registered secrets routes now treat `scope: "org"` as a first-class scope: writes and deletes require an active org and an owner/admin role (`canMutateOrgScope`), and `resolveScopeId("org", …)` rejects requests without an active org rather than falling back to a `solo:` scopeId. Ad-hoc secret routes were already restricted to `user`/`workspace` and remain unchanged.

## 0.9.0

### Minor Changes

- 117d476: Builder credentials are now stored at org scope by default when an owner/admin connects, so a single OAuth flow powers AI chat for everyone in that org.
  - New `app_secrets` scope: `"org"` (alongside `"user"` and `"workspace"`).
  - `writeBuilderCredentials(email, creds, { orgId, role })` writes at `scope: "org"` when the connecting user is owner/admin of an active org. Plain members (or users in Personal mode) keep writing at `scope: "user"` so a teammate can never overwrite the org-shared connection. The Builder OAuth callback now passes `orgId`+`role` automatically — existing direct callers without options keep their previous user-scope behaviour.
  - `resolveBuilderCredential` and `resolveSecret` now check user scope first, then fall back to the active org's row. `${env.BUILDER_PRIVATE_KEY}` (deploy-managed mode) still wins over both, unchanged.
  - `deleteBuilderCredentials(email, { orgId, role })` mirrors the connect-side scope decision, so a Disconnect press undoes exactly what the same user's Connect press wrote — no orphaned org-shared rows for owners, no accidental org-wide tear-downs from a member's personal disconnect.
  - Helper `resolveCredentialWriteScope(email, orgId, role)` exposes the scope decision for any future credentials integration that wants the same default-to-org-when-admin behaviour.

  Migration: existing per-user Builder connections from before this change keep working for the connecter — but other org members won't auto-resolve to them. To promote a user-scope connection to org-shared, the owner/admin disconnects and reconnects once in the affected app.

- dca4f6d: Domain-based org join across the framework — three connected changes so a fresh signup whose email matches an existing org's `allowed_domain` lands inside that org without manual steps:
  - **Auto-join on signup.** New `autoJoinDomainMatchingOrgs(email)` helper, called from the Better Auth `user.create.after` hook. Anyone who signs up with an email whose domain matches `organizations.allowed_domain` is added to that org as a `member` immediately, and `active-org-id` is set to it (only when the user doesn't already have an active org from a pending invite). Idempotent and missing-table-safe.
  - **OrgSwitcher popover** now renders a "Join your team" section listing every domain-match org with a one-click Join button, for users who signed up before the org existed (or whose auto-join failed). Wires through `useJoinByDomain`.
  - **InvitationBanner** also renders domain-match orgs as a top-of-app prompt, so existing-but-not-yet-joined users see a clear CTA without needing to open the picker.

  The backend (`organizations.allowed_domain`, `getMyOrgHandler.domainMatches`, `joinByDomainHandler`, `useJoinByDomain`) was already in place — these changes wire it into the signup flow and the prominent UIs.

### Patch Changes

- dca4f6d: Improve agent chat setup and auth recovery by routing missing provider setup to Builder.io and surfacing hosted sign-in for authentication failures.
- dca4f6d: Replace native title hints on interactive controls with shadcn tooltips.
- dca4f6d: Resolve agent engine status against the active request user so per-user provider secrets are detected correctly.
- a1fef80: Add [dev-session] log when auto-binding email in CLI runner; fix TS narrowing in db-reset-dev-owner; remove redundant trim in zeroChangesHint.
- 117d476: Harden GitHub design-token imports with token-aware fetch helpers and keep persisted agent run diagnostics longer for reconnect investigation.
- dca4f6d: Keep agent chat auto-recovery alive across long runs that keep making progress.
- dca4f6d: Dedupe collaborative presence avatars by email and show collaborator emails on hover.
- dca4f6d: Smooth signup email verification handoff back into the app.

## 0.8.2

### Patch Changes

- 3424455: Fix `agent-native create` failing with "Unrecognized archive format" on freshly published versions. The CLI now tries the changesets per-package tag (`@agent-native/core@<version>`) first, falls back to the legacy `v<version>` tag, and finally to `main` — so it keeps working through the release-tag scheme shift introduced when the framework adopted changesets.
- 81005c4: Add an optional AgentPanel chat notice render slot.
- 81005c4: Export a reusable client theme initialization script helper.
- 81005c4: Avoid stale Vite prebundles for core source aliases in monorepo development.
- 81005c4: Initialize template light/dark classes before hydration and normalize legacy theme storage.

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
