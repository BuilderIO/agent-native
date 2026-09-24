# @agent-native/dispatch

## 0.38.7

### Patch Changes

- a10ae73: Limit Dispatch app launchers to apps connected to the current workspace and clarify that usage alerts notify at a threshold without limiting spend.
- fbd85b3: Allow hosts to customize the Dispatch sidebar name and icon through the exported `Layout` and `NavContent` components while preserving the existing Dispatch branding by default.
- Release all public npm packages with a patch version bump.
- 973e7d5: Stop deleting workspace app registry rows when an app is missing from the current deployment's manifest. Deployments that share one database (production, beta, local development) each see a different app list, so this removed access for apps that were still live elsewhere. Removing an app from the registry is now only done by archiving it.
- Updated dependencies
  - @agent-native/toolkit@0.20.9

## 0.38.6

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.8

## 0.38.5

### Patch Changes

- 5ed3eb0: Report a taken workspace app id as a typed `app-id-taken` result instead of an unhandled 500. `startWorkspaceAppCreation` checked for an id collision in two places — a cross-member guard and the reservation itself — and neither was inside a `try`, so the message each one built (naming the conflict and, for an in-flight creation, its owner) was replaced by a generic "Internal server error" in the create-app UI and in chat. Both collision paths now throw `WorkspaceAppIdTakenError`, the caller converts only that error into `{ mode: "app-id-taken", conflict, owner, message }`, and registry/storage failures keep propagating. `workspace-template-card` previously fell through to a success toast for any mode it did not recognize and now reports this one as an error.
- Release all public npm packages with a patch version bump.
- Updated dependencies [2427195]
- Updated dependencies [d43305d]
- Updated dependencies
  - @agent-native/toolkit@0.20.7

## 0.38.4

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [e973e00]
  - @agent-native/toolkit@0.20.6

## 0.38.3

### Patch Changes

- a6d554d: Add the searchable app directory and mounted standalone app support to the workspace.
- 8057255: Isolate Dispatch "All apps" workspace resources per organization so one organization's edits no longer overwrite what another organization's agents read.
- 6c59bb1: Fix Slack integration runs so deployment bot credentials are selected safely, verified Slack identities retain their user context, local app delegation reaches sibling apps, structured Content intake cannot silently drop supplied fields, and progress streams complete without leaving threads stuck as working.
- Release all public npm packages with a patch version bump.
- Updated dependencies [58b0779]
- Updated dependencies [3ecc476]
- Updated dependencies
- Updated dependencies [15ec2fb]
  - @agent-native/toolkit@0.20.5

## 0.38.2

### Patch Changes

- ffafd84: Keep the Apps page readable when the hosted workspace registry denies a read. A
  gateway authorization denial now falls back to the deployment-owned manifest
  without persisting or reconciling unverified access rows.
- Release all public npm packages with a patch version bump.
- Updated dependencies [5ede9f7]
- Updated dependencies
- Updated dependencies [ffafd84]
- Updated dependencies [424d0cd]
  - @agent-native/toolkit@0.20.4

## 0.38.1

### Patch Changes

- c9e5889: Fix `import-agent-pack`, `import-agent`, and `connect-external-agent` throwing an unhandled 500 when given invalid input (a non-agent-pack file, malformed JSON, a malformed endpoint URL, or a duplicate destination). These now return a clean, actionable validation error instead.
- Release all public npm packages with a patch version bump.
- Updated dependencies [901376b]
- Updated dependencies [b35949b]
- Updated dependencies [116c315]
- Updated dependencies
  - @agent-native/toolkit@0.20.3

## 0.38.0

### Minor Changes

- 99e1584: Expose the opt-in labs flag for the Connect Apps surface.

### Patch Changes

- bd9b451: Infer a root home route for workspace apps that do not define a `/home` route, and keep local and autonomous app discovery aligned with the deployed registry.
- Release all public npm packages with a patch version bump.
- c9cb7de: Remove retired Macros app references from dispatch and toolkit surfaces.
- Updated dependencies
- Updated dependencies [c9cb7de]
  - @agent-native/toolkit@0.20.2

## 0.37.0

### Minor Changes

- 0d80d8d: Support multiple app roles per organization member, invitation role pre-assignment, and organization-admin-editable app permission mappings.

  The additive migration drops only the prior unique index on `(org_id, app_id, LOWER(email))` and replaces it with one including `role`; it does not change or delete assignment rows.

  The new array-based client fields are additive for this minor release: `role`, `myRole`, and the deprecated `useSetAppMemberRole` adapter remain available while callers migrate to `roles`, `myRoles`, and `useSetAppMemberRoles`.

### Patch Changes

- bd46fc2: Fix the "Import an agent" pickers offering files the import cannot read. The
  "Choose folder" input never received `webkitdirectory`, because the effect that
  set it ran before Radix mounted the tab panel and left the ref null, so the
  button opened an unfiltered multi-file picker instead of a folder picker. The
  attribute is now set declaratively. "Choose file" also accepted any file the
  user selected past the `accept` hint and pasted the decoded bytes into the
  definition field; it now rejects unsupported files. Both pickers and
  `normalizeAgentPack` share one list of importable extensions, and skipped
  folder files are summarized instead of listed one per line.
- c509af1: Treat an agent pack response that is missing its `files` array as unreadable
  instead of spreading it during render. The throw escaped to the router error
  boundary and replaced the whole page with "Something went wrong", so the Agent
  pack dialog could never report the failure. The dialog now stays open and says
  the pack could not be read, and an empty pack is still distinct from an
  unreadable one.
- 09bcc96: Give a tool that stops on a missing integration something to click. `connectRequiredResult()` from `@agent-native/core/shared` is the shared shape a gated tool spreads into its own result, and chat renders a Connect control by matching that shape rather than by knowing the tool's name, so a newly gated tool gets the affordance without an allow-list entry.

  Dispatch app creation was the reported case: every Builder authorization failure collapsed into the transient `builder-error` reason ("try again in a moment") even when the real cause was a disconnected Builder account, so the agent narrated a dead end and the `builder-not-connected` Connect control that the create-app popover and `NewWorkspaceAppFlow` already implement could never render. `startWorkspaceAppCreation` (and `remix-workspace-template` through it) now classifies a missing Builder connection as `builder-not-connected` with a connect action attached, and keeps an unreadable credential store as its own retryable `credential-store-unavailable` reason.

  Because the renderer matches by shape, a card can arrive from an MCP server or a remote A2A agent, so the contract only accepts a root-relative path or an absolute http(s) URL as a connect target and drops anything else before it reaches an `href`.

  A Builder API call that comes back 401 now raises a `builder_not_connected` contract error instead of a plain one, so a credential revoked upstream also reaches the Connect action rather than retry prose. A 403 stays an ordinary error, since Builder also returns it for a Space membership problem where reconnecting is the wrong advice.

  The blocker card asks for a reconnect rather than showing a Connected badge, because Builder can revoke a credential upstream without that landing in the local connection status.

- a57a72b: Bound Neon Drizzle transaction acquisition and keep hosted workspace registry authorization failures visible instead of silently falling back to an incomplete local app list.
- Release all public npm packages with a patch version bump.
- 1233458: Use beta Dispatch SSO for Google sign-in from immutable Netlify deploy previews.
- 5b75762: Support passing validated file and URL attachments to Builder workspace app creation runs.
- Updated dependencies [9f08f5d]
- Updated dependencies [cd40555]
- Updated dependencies [1f43d89]
- Updated dependencies [25dc407]
- Updated dependencies [e32e1d5]
- Updated dependencies
- Updated dependencies [657bba1]
- Updated dependencies [25dc407]
- Updated dependencies [6ba23d3]
  - @agent-native/toolkit@0.20.1

## 0.36.2

### Patch Changes

- c7688dd: Give the chat-first rail one owner for active state so exactly one entry ever
  reads as active. `activeAppId` alone could not distinguish "no surface resolved
  yet" from "a nav surface is active with no app selected", so every app icon kept
  its in-color active treatment whenever Search Chats, Scheduled, Integrations, or
  New chat owned the main area. Search Chats was worse: it rendered outside the
  tablist with hover-only styling and no `ChatFirstPrimaryTab` member, so it could
  never show an active state at all.

  `ChatFirstPrimaryTab` now includes `search`, `ChatFirstAppsRail` accepts
  `activeTab`, and both the rail and the primary navigation derive their
  active/inactive presentation from the shared `chatFirstActiveSurface`,
  `chatFirstAppIconState`, and `chatFirstNavTabActive` helpers.

- 97564cd: Add reusable AppSidebar in toolkit and core, support top-left configurable alpha badges, and update app layouts to match the new sidebar design.
- 71e22e1: Add canonical cross-app and lifecycle tracking signals across templates.
- 210c7d0: Keep Dispatch covered by the AgentKit framework changeset contract.
- 048bbe1: Stop the usage dashboard from reporting zero spend for the signed-in user when usage rows carry no organization id. `token_usage.org_id` is filled from the request context, so recurring jobs, automations, and every row written before that column was populated are NULL, and the org-equality read filter hid them from a query already narrowed to that user. Unattributed rows are admitted only for the viewer's own usage; workspace roll-ups and admin-selected members keep strict organization equality, so unattributed spend is never claimed for an organization that cannot be shown to own it.
- b9bda76: Prevent repeated transient inline submissions, allow inline frames to shrink to content, route workspace apps to their authenticated homes, preserve sibling-app navigation from chat handoffs, and coalesce active-run cursor updates.
- Release all public npm packages with a patch version bump.
- 4515fe2: Settings gets a top-level API keys tab for every app, with a provider-tile empty state and a "+ New" menu that searches the keys the app declares or adds a custom one; the Integrations tab becomes one alphabetical provider list (MCP, messaging platforms, and Email together) with Builder.io featured at the top, and the two tabs link to each other. The Dispatch Vault uses the same "+ New" key picker. OpenRouter, Google Gemini, Groq, Mistral, and Cohere keys are registered so they appear wherever keys are added.
- 5c40943: Tell MCP hosts to route granted app requests through their existing Dispatch connection.
- Updated dependencies [210c7d0]
- Updated dependencies [743039f]
- Updated dependencies [bd3e96e]
- Updated dependencies [b83d472]
- Updated dependencies [875f793]
- Updated dependencies [97564cd]
- Updated dependencies [64e6346]
- Updated dependencies [64e6346]
- Updated dependencies [a30a54d]
- Updated dependencies [587297c]
- Updated dependencies
- Updated dependencies [210c7d0]
- Updated dependencies [7a9238c]
- Updated dependencies [ccad889]
  - @agent-native/toolkit@0.20.0

## 0.36.1

### Patch Changes

- b7c56a1: Settings → Integrations → Keys now reports the value each app actually uses and where it comes from (personal, workspace, Vault, or environment) instead of only the row it wrote itself, so keys synced from the Dispatch Vault no longer look unset. The "+ New" menu keeps a custom-key row visible and turns typed text into a custom key. The Dispatch Vault add/edit dialogs are key-first, and its access card explains how apps see Vault keys.
- Release all public npm packages with a patch version bump.
- Updated dependencies [35eb1e6]
- Updated dependencies [4676e71]
- Updated dependencies
  - @agent-native/toolkit@0.19.7

## 0.36.0

### Minor Changes

- 774e549: Add scoped DAU and WAU trends and tabbed Dispatch metrics navigation.
- 46391ca: Store the rendered HTML/text body of every transactional email send alongside the existing send-log record, and show it in the Dispatch send log detail dialog so an org admin can see exactly what was sent, not just the redacted provider request. Magic links, password-reset/verification links, JWT-shaped tokens, and OTP/verification codes are redacted from the body before it is persisted, since `email_log` is org-admin readable. The list query never returns bodies (fetched lazily per row via a new `get-email-log-body` action once a row is opened), and the sandboxed HTML preview now carries a restrictive CSP so a body can't load remote tracking images/styles.

### Patch Changes

- b6bd189: Suppress telemetry for `+autoz` QA identities across the shared tracking paths.
- 840cb6c: Add recipient, sender, and template inclusion and exclusion filters to the transactional email send log action and Dispatch controls.
- 554c771: Keep share dialogs readable while additive migrations are pending, and let
  ordinary iframe pages load cross-origin subresources. Improve new-project setup
  and Slack identity recovery guidance. Keep Cloudflare Workers builds below the
  static-header rule limit, allow local Ollama endpoints on local non-production
  servers, surface provider-setting errors, keep one PGlite client across dev
  reload realms, permit the optional terminal build in fresh scaffolds, and
  clarify standalone deployment.
- 4822dad: Preserve Vite assets for colliding workspace app ids and reconcile deployed app registry records.
- Release all public npm packages with a patch version bump.
- 934301f: Give Dispatch app cards a subtle surface and remove hover feedback from their non-clickable containers.
- 4822dad: Restore Dispatch access for all authenticated organization members.
- e89b114: Keep Google and email authentication as the only visible sign-in choices while optionally bootstrapping a Dispatch session and local cross-app session after sign-in. The handoff uses a short-lived, one-time server-side handle and preserves existing local accounts and cookies.
- 6b397ca: Create and persist a Builder project from the starter template when no project ID is configured.
- Updated dependencies [e8b291e]
- Updated dependencies [4915b82]
- Updated dependencies
- Updated dependencies [3bde94f]
  - @agent-native/toolkit@0.19.6

## 0.35.0

### Minor Changes

- 48a4eca: Add a durable audit trail for every transactional email send attempt. The shared `sendEmail()` transport now records the outbound request payload (with auth links and message bodies redacted) and the raw provider response/status for both successes and failures, so Dispatch can show exactly what was sent, to whom, and why a send failed. The `list-email-log` action gained filters for recipient, sender, status, provider, and date range with stable pagination, and a new searchable "Send log" section was added to `/admin/transactional-email`. Magic-link sign-in emails are now tagged with a `core.magic-link` template id so they show up alongside other auth emails in the catalog and send log.

### Patch Changes

- Release all public npm packages with a patch version bump.
- c050912: Search fields that draw their own clear button no longer also show WebKit's native cancel widget, so only one clear control renders.
- Updated dependencies
- Updated dependencies [58d9dc3]
  - @agent-native/toolkit@0.19.5

## 0.34.0

### Minor Changes

- cc2a915: Standardize framework persistence on PostgreSQL. Local development uses PGlite,
  hosted deployments use PostgreSQL, and the database client, schema, migrations,
  templates, docs, and tooling now target PostgreSQL directly.

### Patch Changes

- cb3a95f: Add opt-in canonical organization federation across Agent-Native app deployments.
- Release all public npm packages with a patch version bump.
- f24d3ec: Fix Dispatch metrics app adoption cards to handle unavailable values, rank apps by tracked usage, and progressively reveal the app list.
- Updated dependencies [e29fee8]
- Updated dependencies [cef8c06]
- Updated dependencies
- Updated dependencies [73c36ce]
  - @agent-native/toolkit@0.19.4

## 0.33.2

### Patch Changes

- 1466345: Nudge users toward their host agent chat from prompt popovers and shared
  sidebar surfaces.
- 9c3eded: Keep the Dispatch Open app action usable for mounted web apps.
- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [760d108]
  - @agent-native/toolkit@0.19.3

## 0.33.1

### Patch Changes

- 485642e: Keep hosted Dispatch app launches inline outside Builder editor sessions.
- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [0566ce9]
  - @agent-native/toolkit@0.19.2

## 0.33.0

### Minor Changes

- 1fc5184: Add friendly automation schedules and webhook triggers.

### Patch Changes

- 4d86bff: Update shared auth pages with per-app product previews and learn-more links.
- bbbac69: Keep pending Builder app reservations visible for 30 days.
- Release all public npm packages with a patch version bump.
- 4deb8a1: Make hosted ask_app submissions retry-safe and return before the MCP transport deadline.
- Updated dependencies [e74593d]
- Updated dependencies
  - @agent-native/toolkit@0.19.1

## 0.32.0

### Minor Changes

- d7d12c0: Add owner-scoped app adoption metrics to the Dispatch admin.

### Patch Changes

- 46abef1: Declare managed Google OAuth capability in app health contracts so deploy verification checks only apps that own the managed connection.
- d142c4f: Fix workspace app embed session mint returning a 500 for apps whose discovered agent URL is a deep link (e.g. Clips share links). The target MCP connection and A2A audience now resolve through the app's home origin instead of the raw discovered URL.
- b89ceb2: Hide empty optional sidebar slots when organization controls are unavailable.
- Release all public npm packages with a patch version bump.
- 307bd64: Match the Dispatch sidebar mark to its text color and tighten its size.
- 349ce5c: Persist Agent-Native prompt drafts synchronously and keep prompt surfaces isolated across refreshes.
- 353f95a: Split template marketing home routes from authenticated app entries and add the shared browser auth handoff.
- 7c1565b: Register the workspace connection catalog action in Dispatch's server action surface.
- 01d2112: Retry transient 502–504 gateway responses from workspace app MCP hosts, including HTML error pages.
- f0fb6c5: Use the cube spinner for shared loading indicators and the worded loader for full-page states across apps.
- Updated dependencies
- Updated dependencies [349ce5c]
- Updated dependencies [353f95a]
- Updated dependencies [a1869cc]
- Updated dependencies [f0fb6c5]
- Updated dependencies [03711a6]
  - @agent-native/toolkit@0.19.0

## 0.31.29

### Patch Changes

- Release all public npm packages with a patch version bump.
- 5820376: Use a monochrome Agent-Native mark in app sidebars.
- ea6123a: Remove the legacy settings view from agent chat surfaces.
- 5b7a8ea: Replace flashing skeleton pulses with a smooth whole-surface loading shine.
- Updated dependencies [844fa10]
- Updated dependencies [4af2889]
- Updated dependencies
- Updated dependencies [dcc9f89]
- Updated dependencies [163dd55]
- Updated dependencies [5b7a8ea]
  - @agent-native/toolkit@0.18.0

## 0.31.28

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.17.6

## 0.31.27

### Patch Changes

- 4ef1d8c: Route one-pager integration requests to Content or inline responses instead of Plan.
- Release all public npm packages with a patch version bump.
- 3e18636: Fix transactional email previews to render the canonical Agent-Native logo.
- 4776e61: Reduce CI lint warnings with safer type narrowing, callback binding, and explicit async intent.
- dd834e7: Prevent vault actions and the Dispatch UI from exposing stored secret values.
- Updated dependencies [ac1ecfc]
- Updated dependencies
- Updated dependencies [5a12f71]
- Updated dependencies [d2b314b]
- Updated dependencies [5c96078]
  - @agent-native/toolkit@0.17.5

## 0.31.26

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.17.4

## 0.31.25

### Patch Changes

- db91905: Standardize Agent-Native product naming while preserving compatibility aliases for existing releases and profiles.
- 32b49a8: Keep Dispatch page scrolling inside the viewport and replace the global header with a sticky agent-chat control.
- Release all public npm packages with a patch version bump.
- 318819b: Give the Dispatch workspace embed handshake a cold-boot connect budget so opening an app whose server is still starting no longer fails as unreachable. `McpClientManager` now accepts a `connectTimeoutMs` option, and the embed session mint spends up to 90s per attempt within a 95s total budget instead of the 5s interactive default, matching the dev gateway's own readiness wait.
- Updated dependencies [db91905]
- Updated dependencies
  - @agent-native/toolkit@0.17.3

## 0.31.24

### Patch Changes

- 65a3b88: Keep shared feedback controls clear of the environment badge and editor chrome.
- Release all public npm packages with a patch version bump.
- Updated dependencies [65a3b88]
- Updated dependencies
  - @agent-native/toolkit@0.17.2

## 0.31.23

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.17.1

## 0.31.22

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [cf473dc]
  - @agent-native/toolkit@0.17.0

## 0.31.21

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.16

## 0.31.20

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.15

## 0.31.19

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.14

## 0.31.18

### Patch Changes

- Release all public npm packages with a patch version bump.
- eff9004: Include available and connected apps in Dispatch app search results.
- Updated dependencies
  - @agent-native/toolkit@0.16.13

## 0.31.17

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.12

## 0.31.16

### Patch Changes

- 36c79f9: Use the authenticated workspace app registry for hosted Dispatch app lists so inaccessible apps do not get an Open app action.

## 0.31.15

### Patch Changes

- c595519: Automations page now writes the selected automation into a `?automationId=` URL param instead of untracked local state, so a selected row can be linked, reloaded, and reached with browser Back on both `/automations` and `/admin/automations`.
- c595519: Fix a workspace app opened from Dispatch chat-first mode on a narrow viewport mounting its own full-screen agent chat rail on top of the already full-screen side surface panel.
- c595519: Fix the chat-first side surface panel's close toggle being stacked beneath the panel it controls on viewports at or below 767px, which made the panel undismissable.
- d74aff9: Keep Dispatch's Feedback, Search, and Collapse controls flush with the bottom of the left sidebar.
- af1b3bb: Derive the chat model selection localStorage key through one exported helper, `chatModelSelectionStorageKey`. `useChatModels` takes the raw key while `MultiTabAssistantChat` takes only the namespace suffix, so a hero composer that passed the same string to both wrote to a different key than the chat beside it and never saw its model picks.
- Updated dependencies [6c2e431]
- Updated dependencies [af1b3bb]
- Updated dependencies [c595519]
- Updated dependencies [9735e4d]
- Updated dependencies [15b86eb]
  - @agent-native/toolkit@0.16.11

## 0.31.14

### Patch Changes

- 4de4af3: Expose workspace monthly per-user credit usage and workspace app creation breakdowns through the Dispatch agent action.
- 4de4af3: Keep Dispatch workspace-app URLs shareable by seeding embedded apps from deep links and reflecting child route changes in the Dispatch URL.
- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.10

## 0.31.13

### Patch Changes

- f2f60b9: Move the environment badge to the bottom-left, show a truthful dev badge during configured local development, raise Dispatch controls above it, and give default notifications enough clearance to avoid overlap.

## 0.31.12

### Patch Changes

- dc0978d: Fix action request context to use the forwarded workspace gateway origin instead of the internal dev proxy host.

## 0.31.11

### Patch Changes

- e5e6934: Fix embedded workspace-app chat routes when the framework mount middleware strips the proxy prefix before dispatching the request.
- dd80d09: Keep the full workspace credential workflow reachable from the redesigned integrations catalog.
- e5e6934: Refresh integration and Dispatch app surfaces with connected-first layouts and two-column cards.

## 0.31.10

### Patch Changes

- a1d24db: Fix embedded workspace-app chat routes when the framework mount middleware strips the proxy prefix before dispatching the request.

## 0.31.9

### Patch Changes

- 4ebc74f: Fix Clips, Forms, and Design apps sharing the same fallback icon in the Dispatch "Your apps" list.

## 0.31.8

### Patch Changes

- 4e1ce88: Fix embedded workspace-app chat routes when the framework mount middleware strips the proxy prefix before dispatching the request.

## 0.31.7

### Patch Changes

- 97e8cea: Fix embedded workspace-app chat routes when the framework mount middleware strips the proxy prefix before dispatching the request.

## 0.31.6

### Patch Changes

- 8b73951: Isolate workspace app chat history and keep short chat-tab titles clear of the close target.

## 0.31.5

### Patch Changes

- d30d701: Move workspace-app sharing into each app's settings menu so cards keep their primary open action focused.

## 0.31.4

### Patch Changes

- 10de7b9: Remove unused imports and unreachable declarations. Dispatch drops unused
  imports from its layout, transactional email pages, and MCP gateway;
  creative-context drops unused type imports and an unread `headingStyle`;
  recap-cli drops the `node:os` import and two unread locals; skills drops the
  unreferenced `maybeUpdateInstructions` helper; toolkit drops unused imports and
  an unread `REALTIME_VOICE_REQUEST_SOURCE`. No runtime behavior changes.
  `eslint/no-unused-vars` is now an oxlint error instead of a warning, so CI
  blocks new ones.
- Updated dependencies [10de7b9]
  - @agent-native/toolkit@0.16.9

## 0.31.3

### Patch Changes

- ac3acfa: Improve provider failure recovery and remove the retired Videos template from Dispatch app creation.

## 0.31.2

### Patch Changes

- Updated dependencies [60b7e74]
  - @agent-native/toolkit@0.16.8

## 0.31.1

### Patch Changes

- 5f4031b: Restore ownerless legacy app visibility while preserving explicit private defaults for new apps.

## 0.31.0

### Minor Changes

- 8690e40: Make automation details inspectable in Dispatch, including the prompt, trigger configuration, capabilities, and past runs.

## 0.30.5

### Patch Changes

- 8e51925: Fix Electron chat feedback around app visibility, local development tools, and run recovery.

## 0.30.4

### Patch Changes

- Updated dependencies [fc85cb2]
  - @agent-native/toolkit@0.16.7

## 0.30.3

### Patch Changes

- c58cd6e: Preserve verified mutation receipts and exact member identity across Dispatch and A2A delegation.

## 0.30.2

### Patch Changes

- 330cf77: Keep impersonal HTML redirects eligible for the shared SSR edge cache.

## 0.30.1

### Patch Changes

- a2f21dc: Keep workspace apps inline outside Builder.io embeds.
- Updated dependencies [a2f21dc]
  - @agent-native/toolkit@0.16.6

## 0.30.0

### Minor Changes

- a688849: Add organization groups and privacy controls for workspace apps. New apps use the organization default (organization-wide by default), while creators and organization admins can manage individual, group, and organization access from the shared popover.

## 0.29.5

### Patch Changes

- Updated dependencies [0b57293]
  - @agent-native/toolkit@0.16.5

## 0.29.4

### Patch Changes

- 0b0085f: Fix workspace app sign-in continuation and mounted-app launches.

## 0.29.3

### Patch Changes

- 8cab236: Speed up workspace app opens in Dispatch by reusing the app catalog cache and deferring granted-app discovery until needed.

## 0.29.2

### Patch Changes

- 66b2a1c: Navigate workspace apps in the top window when Dispatch runs in Builder or an iframe.

## 0.29.1

### Patch Changes

- 96ecc13: Use compact app search and pin labels that stay on one line.

## 0.29.0

### Minor Changes

- 772f59a: Point the chat beside an open workspace app at that app's own agent. Dispatch now proxies `/_agent-native/workspace-app-chat/<appId>/**` to the app's `/_agent-native/agent-chat`, authenticated with the app's own embed session, so the rail has the app's tools, AGENTS.md, skills, app-scoped resources, and dev-mode surface instead of Dispatch's. When the proxy cannot be established the rail shows a retryable error rather than silently answering from Dispatch's agent, and workspace-level chat with no app open is unchanged.

### Patch Changes

- 772f59a: Allow workspace members to update mounted app names and descriptions from Dispatch.
- 772f59a: Report the embedded workspace app to the Dispatch agent as structured context. `/apps/<id>` now resolves to a `workspace-app` navigation view that keeps the app id and in-app path instead of collapsing to the apps list, and `view-screen` emits an `embeddedApp` block for both that route and chat-first mode, where the route stays on `/chat` and the open app is named only by `chat-first-pane` state. An app that is open but cannot be identified reports `status: "unknown"` rather than a default or an omitted field.
- 772f59a: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.

## 0.28.1

### Patch Changes

- 2107a36: Retry cross-app embed session authentication with the shared A2A secret when a workspace target rejects an unsynchronized organization secret.

## 0.28.0

### Minor Changes

- d3702a5: Point the chat beside an open workspace app at that app's own agent. Dispatch now proxies `/_agent-native/workspace-app-chat/<appId>/**` to the app's `/_agent-native/agent-chat`, authenticated with the app's own embed session, so the rail has the app's tools, AGENTS.md, skills, app-scoped resources, and dev-mode surface instead of Dispatch's. When the proxy cannot be established the rail shows a retryable error rather than silently answering from Dispatch's agent, and workspace-level chat with no app open is unchanged.

### Patch Changes

- d3702a5: Allow workspace members to update mounted app names and descriptions from Dispatch.
- d3702a5: Report the embedded workspace app to the Dispatch agent as structured context. `/apps/<id>` now resolves to a `workspace-app` navigation view that keeps the app id and in-app path instead of collapsing to the apps list, and `view-screen` emits an `embeddedApp` block for both that route and chat-first mode, where the route stays on `/chat` and the open app is named only by `chat-first-pane` state. An app that is open but cannot be identified reports `status: "unknown"` rather than a default or an omitted field.
- d3702a5: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.

## 0.27.21

### Patch Changes

- ed0666b: Report the embedded workspace app to the Dispatch agent as structured context. `/apps/<id>` now resolves to a `workspace-app` navigation view that keeps the app id and in-app path instead of collapsing to the apps list, and `view-screen` emits an `embeddedApp` block for both that route and chat-first mode, where the route stays on `/chat` and the open app is named only by `chat-first-pane` state. An app that is open but cannot be identified reports `status: "unknown"` rather than a default or an omitted field.
- ed0666b: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.

## 0.27.20

### Patch Changes

- b676db8: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.

## 0.27.19

### Patch Changes

- 94fc4d8: Keep feature-flag definitions off the server HMAC barrel so Vite client graphs do not crash.
- b676db8: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.

## 0.27.18

### Patch Changes

- 436340b: Share the canonical localized authentication copy with native sign-in surfaces
  and allow authenticated packaged callers to mint workspace embed sessions.

## 0.27.17

### Patch Changes

- Updated dependencies [95ea873]
  - @agent-native/toolkit@0.16.4

## 0.27.16

### Patch Changes

- 3850b75: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 3850b75: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.

## 0.27.15

### Patch Changes

- bc5f350: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- bc5f350: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.

## 0.27.14

### Patch Changes

- 6e56b98: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 6e56b98: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.

## 0.27.13

### Patch Changes

- 6bdf1f7: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.
- 6bdf1f7: Resolve workspace embed pages from an app's canonical home URL instead of a deep A2A link, and allow extensions rendered in the hosted workspace to load in their parent frame.

## 0.27.12

### Patch Changes

- febb983: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.

## 0.27.11

### Patch Changes

- 802f708: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.

## 0.27.10

### Patch Changes

- 904b67c: Retry workspace embed-session minting with the shared A2A secret when a target rejects org-secret authentication, with redacted mint diagnostics. Keep SSO fanout limited to canonical and explicitly registered own-origin apps; path-mounted workspace apps remain same-origin with Dispatch and keep their existing ambient session behavior, so this narrows fanout targets but is not origin isolation.

## 0.27.9

### Patch Changes

- d525c66: Harden embedded workspace authentication across hosts and prevent unauthorized session-location reads.

## 0.27.8

### Patch Changes

- 8d34d57: Harden embedded workspace authentication across hosts and prevent unauthorized session-location reads.

## 0.27.7

### Patch Changes

- 907dfa3: Hide redundant Agent-Native SSO controls inside embedded workspace app views while preserving the app's normal login and signup controls.
- 907dfa3: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.
- 907dfa3: Preserve organization Google-only policies during shared sign-in by marking only Dispatch identities with a verified Google account link, while keeping existing local accounts and sessions additive.

## 0.27.6

### Patch Changes

- 9e73795: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.
- 9e73795: Preserve organization Google-only policies during shared sign-in by marking only Dispatch identities with a verified Google account link, while keeping existing local accounts and sessions additive.

## 0.27.5

### Patch Changes

- 1b7d8c2: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.

## 0.27.4

### Patch Changes

- fa0f828: Resolve hosted workspace app sign-in from the authenticated live registry so custom mounted apps can receive Dispatch embed sessions without a copied app list. Keep the registry action scoped to its verified A2A caller and refresh the desktop canary identity state before automatic sign-in.

## 0.27.3

### Patch Changes

- 81fb79e: Keep Dispatch chat surfaces at the full viewport height so the composer stays anchored to the bottom of the page.
- 81fb79e: Avoid querying admin-only vault grants from workspace member key panels and
  return a proper forbidden response for unauthorized grant requests.
- 81fb79e: Keep Dispatch's collapsed chat-first sidebar actions visible and icon-only, matching the Electron rail.
- 81fb79e: Keep selected chat-first apps visible and open granted external apps from Dispatch.
- 81fb79e: Make shared-auth rollout failures fail closed while allowing an explicitly allowlisted operator to manage feature flags across deployments without a local organization. Clear stale Dispatch fallback errors after a successful direct load, and keep hosted chat restore controls local-only.
- Updated dependencies [81fb79e]
  - @agent-native/toolkit@0.16.3

## 0.27.2

### Patch Changes

- 43fa797: Keep Dispatch chat surfaces at the full viewport height so the composer stays anchored to the bottom of the page.
- 43fa797: Avoid querying admin-only vault grants from workspace member key panels and
  return a proper forbidden response for unauthorized grant requests.
- 43fa797: Keep Dispatch's collapsed chat-first sidebar actions visible and icon-only, matching the Electron rail.
- 43fa797: Keep selected chat-first apps visible and open granted external apps from Dispatch.
- 43fa797: Make shared-auth rollout failures fail closed while allowing an explicitly allowlisted operator to manage feature flags across deployments without a local organization. Clear stale Dispatch fallback errors after a successful direct load, and keep hosted chat restore controls local-only.
- Updated dependencies [43fa797]
  - @agent-native/toolkit@0.16.2

## 0.27.1

### Patch Changes

- fb18771: Keep Dispatch chat surfaces at the full viewport height so the composer stays anchored to the bottom of the page.
- fb18771: Avoid querying admin-only vault grants from workspace member key panels and
  return a proper forbidden response for unauthorized grant requests.
- fb18771: Keep Dispatch's collapsed chat-first sidebar actions visible and icon-only, matching the Electron rail.
- fb18771: Keep selected chat-first apps visible and open granted external apps from Dispatch.
- Updated dependencies [fb18771]
  - @agent-native/toolkit@0.16.1

## 0.27.0

### Minor Changes

- 9e21e1b: Reuse Dispatch app cards and the shared 2-column library treatment for Factory agent and app surfaces.

### Patch Changes

- 9e21e1b: Refresh workspace app lists after starting a Builder app creation.
- 9e21e1b: Keep embedded workspace apps synchronized with their parent light or dark theme.
- Updated dependencies [9e21e1b]
- Updated dependencies [9e21e1b]
- Updated dependencies [9e21e1b]
  - @agent-native/toolkit@0.16.0

## 0.26.0

### Minor Changes

- 73c4a97: Reuse Dispatch app cards and the shared 2-column library treatment for Factory agent and app surfaces.

### Patch Changes

- 73c4a97: Refresh workspace app lists after starting a Builder app creation.
- Updated dependencies [73c4a97]
- Updated dependencies [73c4a97]
  - @agent-native/toolkit@0.15.1

## 0.25.1

### Patch Changes

- Updated dependencies [f07ec04]
  - @agent-native/toolkit@0.15.0

## 0.25.0

### Minor Changes

- 89f194f: Add a default-off Dispatch workspace sign-in rollout for iframe app panes. The
  flagged path mints short-lived, app-scoped embed sessions for exact first-party
  origins, explicitly registered custom workspace apps, and same-origin mounted
  workspace apps without changing the existing MCP access policy.
- 89f194f: Add folder-backed agent packs with safe Claude/Cowork-style import, agent-owned
  references and skills, and a shared Factory Agents surface for managing simple
  agents alongside mounted agentic apps.
- 89f194f: Add a simple Agents workspace for creating reusable profiles, importing Claude-style or generic agent definitions, and connecting existing HTTP/A2A agents.

### Patch Changes

- 89f194f: Keep visited workspace app frames mounted while switching apps so returning restores live state instantly.
- 89f194f: Provision cross-app SSO state and authorization-code tables during release migrations so production serverless requests never perform schema DDL.
- Updated dependencies [89f194f]
  - @agent-native/toolkit@0.14.3

## 0.24.6

### Patch Changes

- Updated dependencies [2db503b]
  - @agent-native/toolkit@0.14.2

## 0.24.5

### Patch Changes

- 8008dfe: Centralize product docs links behind `docsUrl()` and retarget Settings, Team, onboarding, and template help links at live agent-native.com docs pages.

## 0.24.4

### Patch Changes

- 47ba57a: Gate connected-agent mutations to workspace owners and admins instead of issuing failed shared-resource writes for organization members.

## 0.24.3

### Patch Changes

- 405e17e: Gate connected-agent mutations to workspace owners and admins instead of issuing failed shared-resource writes for organization members.

## 0.24.2

### Patch Changes

- 3eb5bdb: Surface app-creation settings authorization failures as HTTP 403 with the real message instead of a generic internal server error.

## 0.24.1

### Patch Changes

- b3b4580: Align Dispatch app-row actions with shared open-in-new-tab and add-app menus.
- b3b4580: Add workspace group management and Dispatch-scoped administrator access controls.
- b3b4580: Hide untracked and confusing creation metadata from app settings popovers.
- b3b4580: Make pending workspace apps full-width, hide branch IDs, and link directly to Builder.
- b3b4580: Collapse the Dispatch sidebar when a workspace app opens in its embedded app surface.
- b3b4580: Show workspace app error documents in the Dispatch iframe when embed-session setup fails.
- b3b4580: Make spreadsheet-backed app creation preserve bounded source provenance and require confirmation when workbook formatting or candidate inputs and outputs are ambiguous.
- b3b4580: Clarify personal MCP connections, workspace provider access, and legacy credential key scope.
- Updated dependencies [b3b4580]
- Updated dependencies [b3b4580]
  - @agent-native/toolkit@0.14.1

## 0.24.0

### Minor Changes

- aa17e22: Add a personal-first LLM usage investigation view with daily trends, prompt attribution, and agent review handoff.

### Patch Changes

- aa17e22: Use Plan's blue accent for generated app icons instead of a disabled-looking gray.
- aa17e22: Open workspace apps at their registered app URL instead of treating the workspace mount path as an in-app document route.
- aa17e22: Keep metadata-only workspace app edits from starting new Builder branches, and use canonical home URLs when launching built-in connected apps.
- aa17e22: Make the Dispatch logo return to the Overview page when clicked.
- aa17e22: Add an Admin link to Dispatch settings navigation.
- aa17e22: Hide the current Dispatch app from the shared app switcher while keeping other workspace apps available.
- aa17e22: Accept human-friendly names when creating workspace apps and normalize them into URL-safe ids.
- aa17e22: Keep completed Dispatch app handoffs in the chat-first app pane instead of rendering a nested app shell inside the conversation.
- aa17e22: Recover embedded workspace apps when their one-time session expires and keep account name editing available while profile data loads.
- Updated dependencies [aa17e22]
  - @agent-native/toolkit@0.14.0

## 0.23.5

### Patch Changes

- 62a17be: Add the authenticated, nonce-only completion route used by packaged Desktop clients during cross-app identity federation.

  Let Dispatch register rollout-gated identity routes on its primary auth guard so security checks remain unconditional while the capability is default-off.

## 0.23.4

### Patch Changes

- 7c5888c: Render integrations and scheduled work as first-class, chrome-less Electron control-plane pages.
- 7c5888c: Hide the generic Chat starter from Dispatch's default app launchers.
- 7c5888c: Open new workspace app requests in a fresh coding chat and guide missing AI setup through Builder or custom keys.
- Updated dependencies [7c5888c]
  - @agent-native/toolkit@0.13.10

## 0.23.3

### Patch Changes

- a426c4f: Make Chat-first New chat, Integrations, and Scheduled navigation behave as selected tabs across Dispatch and Desktop, with Integrations promoted out of Settings into a full-page surface.
- a426c4f: Fix Dispatch app navigation, sidebar selection state, embed-session refreshes, and app-list spacing.

## 0.23.2

### Patch Changes

- 44ac2c4: Require explicit Slack mentions before dispatching channel turns.

## 0.23.1

### Patch Changes

- dab8787: Keep Builder Visual Editor links out of chat-first browser iframes so branch links open without CSP framing errors.
- dab8787: Widen full-page chat composers and conversation rails to use up to 1000px when space is available.
- Updated dependencies [dab8787]
- Updated dependencies [dab8787]
- Updated dependencies [dab8787]
  - @agent-native/toolkit@0.13.9

## 0.23.0

### Minor Changes

- c41fd16: Polish the Electron and Dispatch chat-first app surfaces with a fuller layout, simpler app lists, and inline workspace-app opening.

### Patch Changes

- c41fd16: Keep granted Dispatch app surfaces available from the Chat-first workspace panel.
- c41fd16: Route Dispatch overview prompts into the full-page chat surface instead of the agent sidebar.
- Updated dependencies [c41fd16]
  - @agent-native/toolkit@0.13.8

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
