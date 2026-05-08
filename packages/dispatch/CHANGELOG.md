# @agent-native/dispatch

## 0.2.18

### Patch Changes

- d198100: Polish setup, navigation, editor, and feedback affordances from user feedback.

## 0.2.17

### Patch Changes

- 0d95d53: Resolve Slack dispatch requests to the verified sender owner when possible so delegated app artifacts remain visible to that user.

## 0.2.16

### Patch Changes

- 3b88628: Fix lazy workspace dev root routing, live app discovery, and generated app dependency startup.

## 0.2.15

### Patch Changes

- ad7006d: Keep workspace app creation prompts editable after submit and clarify that named products are design references, not implied API-key requirements.

## 0.2.14

### Patch Changes

- 27c3dbc: Improve chat run completion durability and clarify mounted workspace app routing.

## 0.2.13

### Patch Changes

- b07f933: Fix workspace app card links and key popover triggers.
- b07f933: Clarify workspace app creation instructions to reuse hosted first-party apps as A2A neighbors instead of cloning or nesting templates.

## 0.2.12

### Patch Changes

- 5115f28: Add Dispatch knowledge packs to workspace resources and let new-app flows grant them alongside vault keys.

## 0.2.11

### Patch Changes

- 4caaa4f: Keep workspace app creation on same-origin gateway routes and stop child dev servers from advertising private ports.
- 4caaa4f: Dispatch overview page polish.

## 0.2.10

### Patch Changes

- e076977: Tighten Dispatch sidebar footer ordering and scroll behavior.
- e076977: Make generated workspace apps preserve their mounted base path and keep Dispatch app links on the active workspace gateway origin.
- e076977: Support stable root OAuth callbacks for path-mounted workspace apps and clarify new-app prompts.

## 0.2.9

### Patch Changes

- 7a849c3: Dispatch integrations plugin polish.
- 7a849c3: Show the shared organization switcher in the Dispatch sidebar footer.

## 0.2.8

### Patch Changes

- 7d0ebfc: Move Mail lower in template pickers, remove non-featured templates from default selections, and add a hosted Mail Google sign-in notice.

## 0.2.7

### Patch Changes

- 471bf1e: Show Builder.io LLM usage as agent credit spend when Builder is the active provider.

## 0.2.6

### Patch Changes

- 2e99cca: Fix workspace scaffolding for the Design template and clarify local Dispatch setup.

## 0.2.5

### Patch Changes

- 24781d0: Clarify Dispatch new-app instructions so Builder branches scaffold separate workspace apps instead of editing starter.
- 24781d0: Internal app-creation-store tweaks for spawned dispatch apps.

## 0.2.4

### Patch Changes

- 977af2b: Route Dispatch overview prompts to Builder chat in Builder frames and keep the app agent sidebar collapsed there by default.
- a562b18: Validate external agent form fields before saving remote agent manifests.

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
