# @agent-native/core

## 0.11.2

### Patch Changes

- 8975a96: Allow Builder connect popups to complete from local embedded settings panels by accepting a short-lived signed connect token.
- 8975a96: Polish agent chat menus, icons, and message timestamps.
- 8975a96: Add share-link support to the share button and allow templates to expose read-only anonymous chat and Builder-connect surfaces.

## 0.11.1

### Patch Changes

- 2d52595: Detect Builder preview webviews from builder preview URL markers so code prompts route to Builder chat.
- 2d52595: Use the shadcn popover animation for the framework share control and keep visibility changes fresh after reopening.

## 0.11.0

### Minor Changes

- b4bdd34: Workspace settings reachable from the org switcher in every template, plus admin-vs-member roles, bulk invite (typed list, paste-many, CSV upload) with per-row role selection, and stricter auto-join domain validation (must match the admin's own email domain; free email providers like gmail.com are blocked).
  - `OrgSwitcher` exposes a "Workspace settings" link (configurable via `settingsPath`, default `/team`).
  - `useInviteMember` accepts `{ email, role }`; new `useBulkInviteMembers` and `useChangeMemberRole` hooks.
  - New `PUT /_agent-native/org/members/:email/role` endpoint; only owners can promote/demote admins.
  - `org_invitations` gains a `role` column so invites land at the assigned role on accept.
  - `OrgPendingInvitation` type now includes `role`.
  - New `isFreeEmailProvider` export with a curated blocklist used by `setDomainHandler`.

### Patch Changes

- b4bdd34: Replace custom overflow menu in extensions sidebar with shadcn DropdownMenu (Radix-portaled). Fixes the menu being clipped by the sidebar's stacking context and adds the standard fade/zoom animations.
- b4bdd34: Sign connected-agent A2A mention calls with the current request identity in production.
- b4bdd34: Fix Cloudflare Pages deploy failure with `Cannot require: tty`. Terminal-detection helpers in transitive deps (chalk, picocolors, supports-color, debug, etc.) call `require("tty")` at module init; the bundled-worker require shim now covers `tty`, `readline`, `process`, `console`, `perf_hooks`, and `string_decoder` so those CJS calls resolve to the matching ESM imports instead of throwing at deploy time.
- b4bdd34: Allow actions to stop an agent turn after deterministic provider failures instead of feeding the error back into automatic retries.

## 0.10.0

### Minor Changes

- 721f125: NotificationsBell: clicking a notification with `metadata.link` now navigates to that URL (and marks the notification read). Notifications without a link keep the previous click-to-mark-read-only behavior.

### Patch Changes

- 977af2b: Restyle the Builder connect callback / error pages to match the rest of the framework's UI — Inter font, neutral-zinc palette, and dark/light mode that follows the user's app theme (or `prefers-color-scheme`).
- a562b18: Fix extension table initialization and respect reduced-motion preferences on first-run onboarding backgrounds.
- a562b18: Improve chat stop/error fallback copy and normalize escaped tooltip shortcuts.
- 57b7e0a: Composer accepts file drops directly. Previously, dragging a file (PDF, PPTX, image, etc.) into the prompt composer triggered the browser's default behavior (navigating to the file), even though the "+" button accepted the same file types. The composer now intercepts drops, mirroring the existing paste handler — drag a deck or screenshot in and it attaches like a normal upload.
- 57b7e0a: PromptComposer now inlines small text files (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, etc., plus any `text/*` MIME) into the prompt as `<uploaded-text-file>` blocks instead of only attaching them as binary uploads. Truncates after 60k characters. The original file is still attached as well, so server-side handlers that prefer the binary path keep working.
- 57b7e0a: Resolve org-shared Builder credentials when auto-selecting the chat engine.
- a562b18: Fix queued chat handoff after a run completes and improve multi-invite banner spacing.
- a562b18: Detect Netlify Lambda runtimes for hosted agent soft timeouts and cap repeated stale-run recovery loops.
- a562b18: Fix Vite "Failed to resolve import @tauri-apps/api/core" error in fresh CLI workspaces. The settings panel called `window.__TAURI_INTERNALS__.invoke` directly instead of dynamically importing `@tauri-apps/api/core`, so non-desktop installs no longer crash on the first SPA load.
- 57b7e0a: Wrap shadcn `Tooltip` usages in a `TooltipProvider` so the agent panel and other top-level components don't crash on render. PR #509 swapped native `title` hints for `Tooltip`, but `@radix-ui/react-tooltip@1.2.x` requires a provider ancestor and threw `'Tooltip' must be used within 'TooltipProvider'` on the docs site and any template embedding the agent sidebar.
- 977af2b: Route Dispatch overview prompts to Builder chat in Builder frames and keep the app agent sidebar collapsed there by default.
- a562b18: Improve workspace setup feedback and allow adding the Dispatch workspace app from the CLI.
- a562b18: Fix completed chat runs getting restored as permanently thinking after partial thread saves.
- a562b18: Server-side Sentry now attaches user/org context to more error paths. Failed login/signup attempts capture as `level:warning` with `tags.auth:login|signup` and the attempted email pinned to `user.email` (filtered to skip routine bad-credential noise). Every `runWithRequestContext({ userEmail, orgId, ... })` invocation now also tags Sentry's per-request isolation scope, so action handlers, agent-chat tool re-entries, integration webhook processors, and A2A calls all surface errors under the right user even when no session cookie was attached to the request.
- 57b7e0a: Stop reloading the agent chat after Builder or secret configuration updates.
- 57b7e0a: Initialize Sentry inside the Nitro server so 5xx errors thrown by framework routes, action handlers, and agent-chat streams are reported with per-request user context. Driven by the `SENTRY_SERVER_DSN` env var (no-op when unset). Complements the existing CLI and browser Sentry init points without wiring them together — each maps to a different Sentry project.
- a562b18: Improve shared extension shell navigation, creation guidance, and polling recovery.
- a562b18: Recover automatically from no-detail Builder gateway errors in agent chat.
- 57b7e0a: Unify request-scoped secret resolution to read user → org → workspace rows from `app_secrets` everywhere. Previously, `getOwnerApiKey()`, `resolveSecret()`, voice provider status, transcribe-voice, and Google Realtime each had their own slightly different read order — some only checked the user row, some checked user + org but not workspace. They now all walk the same chain, so an org-shared (or workspace-scoped) key is honored consistently no matter which call site resolves it. Solo (no-org) sessions fall back to a `workspace:solo:<email>` row.

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
