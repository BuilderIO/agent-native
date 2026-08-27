# @agent-native/dispatch

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

## 0.22.1

### Patch Changes

- c29fcb7: Keep the Admin and Settings links visible in the chat-first Dispatch sidebar.

## 0.22.0

### Minor Changes

- 061896a: Add an opt-in chat-first workbench with contextual app surfaces for desktop, Dispatch, and mobile clients.

### Patch Changes

- 061896a: Make turn-into-app Builder handoffs autonomous by choosing recommended defaults and recording non-blocking assumptions instead of stopping for questions.
- 061896a: Use the Toolkit header store and mobile hook through Dispatch compatibility paths.
- 061896a: Improve Thread Debug with diagnosis-first failure triage and retained run evidence.
- Updated dependencies [061896a]
  - @agent-native/toolkit@0.13.7

## 0.21.0

### Minor Changes

- cf16fae: Add an opt-in chat-first workbench with contextual app surfaces for desktop, Dispatch, and mobile clients.

### Patch Changes

- cf16fae: Make turn-into-app Builder handoffs autonomous by choosing recommended defaults and recording non-blocking assumptions instead of stopping for questions.
- Updated dependencies [cf16fae]
  - @agent-native/toolkit@0.13.6

## 0.20.4

### Patch Changes

- e959709: Export `runDispatchMigrations` so a consuming app can own dispatch schema in a release-time migration step instead of at server startup.
- e959709: Scope workspace automations to their owning app by default, keep Dispatch's all-apps view explicit, and expose failed run threads for troubleshooting.

## 0.20.3

### Patch Changes

- Updated dependencies [a107169]
  - @agent-native/toolkit@0.13.5

## 0.20.2

### Patch Changes

- 6071f7d: Provision and reuse the connected Builder workspace project automatically for hosted Turn Into App requests.
- 6071f7d: Keep language selection in Settings instead of the Dispatch header.

## 0.20.1

### Patch Changes

- c440e50: Route Turn Into App requests from Claude Web, ChatGPT Web, and web Projects to Builder through Dispatch instead of building in the host sandbox.

## 0.20.0

### Minor Changes

- 1d5bab1: Simplify the Dispatch Admin overview and Apps catalog with shared icon cards, app colors, and lighter progressive disclosure.

## 0.19.2

### Patch Changes

- Updated dependencies [da40677]
  - @agent-native/toolkit@0.13.4

## 0.19.1

### Patch Changes

- db62d66: Consolidate every MCP setting on `createAgentChatPlugin` under one `mcp: {}` option, and add `mcp.catalog: "app"`.

  `mcp` accepts `enabled`, `catalog`, `connectorCatalog`, `externalAgents`, `builtinCrossAppTools`, `title`, `description`, `websiteUrl`, and `icons`. The top-level `disableMcp`, `mcpServerInfo`, `connectorCatalog`, and `externalAgents` stay accepted for one minor and are deprecated; the nested value wins, and setting both forms to disagreeing values throws at plugin init rather than booting an app with an MCP surface nobody chose (same contract as `resolveFrameworkTools`). `disableMcp: true` and `mcp.enabled: false` are normalized as inverses, so a correctly migrated app is not read as a conflict.

  Two behavior fixes come with it:
  - `builtinCrossAppTools` had no route through the plugin at all — it was reachable only by calling `mountMCP` directly. That is why `frameworkTools: "minimal"` and `workspaceApps: false` could never remove the cross-app builtins (`list_apps`, `open_app`, `ask_app`, `ask_app_status`, `create_embed_session`, `create_workspace_app`, `list_templates`) from an app using the normal plugin entry point: the MCP layer merges them downstream of the `frameworkTools` filter. `mcp.builtinCrossAppTools: false` is now the switch.
  - A2A read the connector policy straight off the raw plugin options, so `mcp.connectorCatalog` would have narrowed the MCP surface while A2A kept serving the old one. `filterDirectA2AActions` / `buildAuthenticatedAgentA2ASkills` now take the resolved shape, so the two external surfaces cannot diverge.

  `mcp.catalog: "app"` serves external callers exactly the app's own tool registry, flat — the same actions the in-app agent holds, with no cross-app builtins, no `ask-agent`, no `tool-search`, and no compact/connector trimming. `externalAgents.denyActions` and the OAuth scope filter still apply, since both are explicit removals rather than catalog tiering, and the dev-open surface split is unchanged (an unauthenticated loopback probe still gets `actions`, not `productionActions`). Weigh the token cost before setting it: an app registering ~100 actions puts every schema in the caller's context on `tools/list`, which is what the compact default exists to avoid.

  Also folds the per-tier `tools/call` gate into one rule — the advertised set is the callable surface on every tier except the explicit `--full-catalog` opt-in — so adding a tier can no longer default to "everything callable" by omission.

  `tool-search` is fixed on both ends over MCP. It is dropped entirely from every flat catalog (`mcp.catalog: "app"` and the `--full-catalog` opt-in), where every tool is already listed beside it and it could only describe its own neighbours. On the trimmed catalogs, where it does earn its place, it is now scoped to the advertised set: previously it closed over the app's whole registry while `tools/call` accepted only the advertised subset, so it answered with names that came straight back as "Unknown tool". `attachToolSearch`, `searchToolRegistry`, `createToolSearchEntry`, `TOOL_SEARCH_ACTION_NAME`, `resolveFrameworkTools`, `filterFrameworkToolGroups`, and `frameworkGroupEnabled` are now exported from `@agent-native/core/server`, so a standalone `mountMCP` plugin can compose the same surface the agent-chat plugin does instead of hand-rolling a copy that drifts.

## 0.19.0

### Minor Changes

- 8f10ada: Move Dispatch management and operator tools into a dedicated Admin control plane.

## 0.18.0

### Minor Changes

- d3f8794: Add a compact workspace app rail to Dispatch navigation for ready workspace apps.

### Patch Changes

- d3f8794: Restrict shared Vault values and mutations to workspace owners and admins while keeping safe key requests available to members.
- Updated dependencies [d3f8794]
  - @agent-native/toolkit@0.13.3

## 0.17.6

### Patch Changes

- abb0cf5: Use canonical semantic settings routes for Dispatch team navigation.

## 0.17.5

### Patch Changes

- 158965b: Report unauthorized thread-debug source access as a client-safe 403 instead of a server error.

## 0.17.4

### Patch Changes

- 2765110: Restore the transactional email catalog and Brand Kit named-token public surfaces.

## 0.17.3

### Patch Changes

- 277be3f: Clarify that a free Builder tier is available when connecting Dispatch app creation.
- Updated dependencies [277be3f]
- Updated dependencies [277be3f]
  - @agent-native/toolkit@0.13.2

## 0.17.2

### Patch Changes

- c71d383: Keep connected messaging chats out of app history by default, with an opt-in all-sources view and stable Dispatch branding.
- Updated dependencies [c71d383]
  - @agent-native/toolkit@0.13.1

## 0.17.1

### Patch Changes

- Updated dependencies [106af0e]
  - @agent-native/toolkit@0.13.0

## 0.17.0

### Minor Changes

- 2b6fea3: Show connected apps alongside mounted workspace apps in the Dispatch control plane.

## 0.16.7

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.
- Updated dependencies [f499dff]
  - @agent-native/toolkit@0.12.2

## 0.16.6

### Patch Changes

- eecd3ad: Expose the measured agent failure taxonomy and let thread diagnostics separate interactive runs from scheduled `job-` runs.
- eecd3ad: Add a read-only `read-slack-thread-context` action for Slack-linked issue triage. It resolves child permalinks to their parent thread, returns message attachments and related links, and reports incomplete pagination instead of silently treating a partial thread as complete.

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
