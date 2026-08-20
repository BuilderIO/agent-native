# @agent-native/dispatch

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

- 907dfa3: Hide redundant Agent Native SSO controls inside embedded workspace app views while preserving the app's normal login and signup controls.
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

## 0.16.5

### Patch Changes

- Updated dependencies [89e5910]
  - @agent-native/toolkit@0.12.1

## 0.16.4

### Patch Changes

- 4f3a651: Harden delegated agent transport and provider selection, and support stable workspace-vault key rotation without changing app-local OAuth encryption.

## 0.16.3

### Patch Changes

- c0e7d64: Add a cross-app failed-run inbox to Thread Debug so operators can find and
  inspect recent agent failures without first copying a request ID.
- c0e7d64: Make cross-app delegation ask the receiving specialist agent by default, keep
  typed remote terminal states intact, retry idempotent transient transport
  failures, prevent recursive agent cycles, and bound delegated context growth.
  Proven durable-background delegated runs also keep the full bounded
  continuation allowance while sharing one cumulative wall-clock deadline, so a
  slow successful child task cannot strand its caller before the caller finishes
  its own tool work. After a provider exhausts its short in-call 429/529 retry
  budget, a proven background delegation now gets one cooled-down continuation,
  with a hard cap that prevents sustained throttling from becoming a request
  storm.

  Receiving agents keep ownership of source selection, schema interpretation,
  queries, joins, and their local tools. Direct read actions remain available for
  exact bounded contracts, but are no longer advertised as a workaround for an
  unreliable agent call.

  Dispatch now opts into the same durable background run contract it emits at
  deploy time, so delegated control-plane work is not cut off by the foreground
  40-second budget while already running in the 15-minute worker.

  Workspace vault ciphertext now prefers the workspace A2A-derived encryption
  key over each app's independent auth secret. Existing app-auth-encrypted rows
  remain readable by their owning app and are compare-and-swap migrated on read,
  so sibling agents can reliably resolve the same organization credentials
  without exposing or copying their values. Automatic engine selection also
  pairs the chosen provider with that provider's credential instead of reusing
  an unrelated active key.

  Documentation now distinguishes framework Core, optional Toolkit, and optional
  Templates, and makes source editing an explicit workspace/write-tool capability
  rather than assuming every embedded agent has filesystem access.

- Updated dependencies [c0e7d64]
- Updated dependencies [c0e7d64]
  - @agent-native/toolkit@0.12.0

## 0.16.2

### Patch Changes

- Updated dependencies [cc35067]
  - @agent-native/toolkit@0.11.2

## 0.16.1

### Patch Changes

- 901769d: Make new workspace app creation clearly show Builder branch progress and a focused success handoff.
- Updated dependencies [901769d]
- Updated dependencies [901769d]
  - @agent-native/toolkit@0.11.1

## 0.16.0

### Minor Changes

- 24a5a20: Add secure Chrome extension pairing and an embedded Dispatch browser chat that
  stages or submits canonical browser page context.

### Patch Changes

- 24a5a20: Keep scheduled automations classified correctly across scheduler writes, unify Jobs and Automations management, and give Scheduled and Event triggers one identity-checked execution lifecycle with organization scope and enforced MCP allowlists.
- Updated dependencies [24a5a20]
  - @agent-native/toolkit@0.11.0

## 0.15.29

### Patch Changes

- 279e855: Return a typed forbidden response when non-admin organization members request workspace usage metrics.
- Updated dependencies [279e855]
  - @agent-native/toolkit@0.10.12

## 0.15.28

### Patch Changes

- Updated dependencies [0aada94]
- Updated dependencies [0aada94]
  - @agent-native/toolkit@0.10.11

## 0.15.27

### Patch Changes

- Updated dependencies [16a9d1a]
  - @agent-native/toolkit@0.10.10

## 0.15.26

### Patch Changes

- cbc6936: Make connecting one agent-native app to another a guided flow instead of three
  blank text fields.
  - New `GET /_agent-native/agents/probe` reads a peer's agent card and makes one
    authenticated no-op call, reporting `reachable` and `authorized` as
    independent fields. A peer that answers but rejects the caller's token is the
    failure local dev hides — the receiver runs unauthenticated on localhost, so a
    mismatched secret previously surfaced only after deploy.
  - Settings → Manage agent → Connected Agents is URL-first: paste a peer URL,
    press Check, and the name and description come from its card. Unreachable
    never blocks the save. Rows carry a liveness dot from one batched probe.
  - The section now shows shared-secret state and a Sync to apps action inline,
    reusing the existing org hooks. A caller who cannot see the secret is told so
    rather than being shown "not set".
  - After an add, the UI states that registration is one-directional and deep
    links to the peer's own settings with the values prefilled.
  - The Connected Agents list collapses a remote agent that still has its
    pre-migration `agents/*.json` row alongside the canonical
    `remote-agents/*.json` one, instead of listing it twice with the same URL.
  - `list-connected-agents` keys custom manifests by the normalized agent id, so
    an agent registered as `images`/`asset` no longer appears once as a discovered
    agent and again as a custom one.
  - Export `resolveA2ACallerAuth` from `@agent-native/core/a2a` so app code can
    authenticate outbound A2A calls without reimplementing org-secret lookup.
  - The `a2a-protocol` skill documents the real setup path — A2A is auto-mounted,
    peers are `remote-agents/*.json` resources, and auth is a JWT signed with
    `A2A_SECRET` or the per-org secret — replacing the `mountA2A` + per-peer
    `apiKeyEnv` flow the framework no longer wires up.

- cbc6936: Hide pending workspace apps by default and expose app ownership metadata from each card's overflow menu.
- Updated dependencies [cbc6936]
  - @agent-native/toolkit@0.10.9

## 0.15.25

### Patch Changes

- c849ba0: Allow Dispatch Thread Debug to resolve copied Agent Native request/run IDs to their owning chat threads.

## 0.15.24

### Patch Changes

- Updated dependencies [14818b6]
  - @agent-native/toolkit@0.10.8

## 0.15.23

### Patch Changes

- 52cce19: Fix two independent defects behind intermittent `Missing <KEY>` errors for
  multi-org users.

  Membership resolution now asks the database for a deterministic order
  (`ORDER BY joined_at ASC, org_id ASC`), so the oldest membership wins. The three
  fallback paths in `org/context.ts` — `getOrgContext`, `resolveOrgIdForEmail`, and
  `resolveOrgIdForEmailViaEvent` — previously read the first row of an unordered
  `SELECT`. On Postgres that order is a query-plan and physical-layout detail, so
  any multi-org user without a valid persisted `active-org-id` got an arbitrary
  answer that could change between two identical requests, and `getSession` then
  froze it into `session.orgId`. This does not repair users who already have the
  wrong org persisted in `active-org-id`; that needs a separate data change.

  `syncGrantsToApp` now writes each vault secret under the org that owns the row
  instead of the org of whoever clicked Sync. In `all-apps` mode it lists secrets
  across every org the caller can see, then synced them all with the caller's ctx,
  which `credentialStoreScopeForVaultCtx` turned into `scope: "org"` +
  `scopeId: <caller org>`. Because `writeAppSecret` upserts, that copied rather
  than moved, so credential material accumulated in whichever orgs happened to be
  active during a sync. Grouping by the row's own tenant matches what every other
  sync path already did via `ctxForSecretRow`. The sync result and audit entry now
  report `credentialStores` (one entry per tenant written) in place of the single
  `credentialStore` object.

- 52cce19: Shrink the dispatch and pinpoint install footprint by removing code and
  dependencies nothing could reach. Dispatch drops the unused pre-auth routing
  helper — `rootDispatchRedirect` had no callers and was not re-exported from
  `./server` or any other published subpath — along with the `@libsql/client` and
  `h3` dependencies, which had no imports in the package but were still installed
  for every consumer. Pinpoint drops the `HistoryDropdown` and `SettingsPanel`
  overlay components, which were never rendered by the overlay and were not
  reachable from any of its `.`, `./react`, `./primitives`, `./server`, or
  `./types` entry points. No exported API changes.
- 52cce19: Write NUL group-key delimiters as `\u0000` escapes instead of raw NUL bytes so
  these files stay searchable. Ripgrep's binary-content heuristic treats any file
  containing a `\0` byte as binary and prints only a `binary file matches` notice
  with no lines, so `poll.ts`, `app-skill.ts`, `session-replay.ts`, and
  `app-creation-store.ts` were invisible to every ripgrep-backed search — agents
  and humans grepping them for a symbol got zero results and concluded it did not
  exist. The escape sequence is the same character at runtime; only the on-disk
  byte the heuristic keys on changes, so there is no behavior change.
- Updated dependencies [52cce19]
  - @agent-native/toolkit@0.10.7

## 0.15.22

### Patch Changes

- c8a0bcf: Keep Dispatch navigation and workspace branding aligned with the first-party app surfaces.
- c8a0bcf: Improve Dispatch workspace navigation and branding.

## 0.15.21

### Patch Changes

- 231aca6: Setting a Builder project in Dispatch now enables cloud code changes for that organization's workspace apps. The project id is stored as an organization-scoped credential, which is what `resolveBuilderBranchProjectId()` actually reads — previously it was saved only to Dispatch's own settings row, so apps kept reporting code changes as unavailable. Clearing the project removes the credential and returns those apps to the connect prompt.
- 231aca6: Create app now offers a "Connect Builder" action when Builder isn't connected, instead of dead-end prose. The create-app flow (popover and full-page NewWorkspaceAppFlow) tracks the structured `builder-unavailable` failure reason from `start-workspace-app-creation`, gives hard failures a destructive-styled affordance instead of the neutral muted box used for informational states, adds a "Try again" control for `builder-error`/`credential-store-unavailable`, and wires the "Connect Builder" button through the shared `useBuilderConnectFlow` hook so users can connect and retry without leaving the flow.
- 231aca6: Return a structured reason from Dispatch app creation and replace the operator-facing Builder failure string with a user-facing message, so a missing Builder connection no longer surfaces a raw project id and three unrelated remediation steps.
- 231aca6: Fix existing users being stranded in their personal workspace instead of their company org.

  Request-time domain auto-join decided whether a user was still in a default workspace by
  comparing the workspace name to a name recomputed from the current session. Sessions minted
  by the framework's own Google OAuth and identity-SSO paths carry no display name while Better
  Auth sessions do, so the same account could match on one sign-in path and not another — and a
  renamed workspace, a changed provider display name, or any second org membership disabled the
  auto-join permanently. It now keys off whether the user already belongs to an org whose
  `allowed_domain` matches their email domain, which is the durable signal.

  Joining is now also separated from activating: the company org is always joined, but the user
  is only switched into it when their current workspace is one they solely own. Members of a
  shared team stay where they are.

  Also fixes two recovery paths that hid the manual way in: Settings → Team now shows the
  "Join your team" card even when the user already has a (personal) workspace, and the Dispatch
  sidebar keeps an icon-only workspace switcher when collapsed instead of dropping it.

## 0.15.20

### Patch Changes

- Updated dependencies [8afb252]
  - @agent-native/toolkit@0.10.6

## 0.15.19

### Patch Changes

- 0e2c19d: Use quieter borderless styling for Dispatch secondary controls and surfaces.
- 0e2c19d: Standardize Dispatch sidebar utility controls with the shared footer layout.
- Updated dependencies [0e2c19d]
- Updated dependencies [0e2c19d]
- Updated dependencies [0e2c19d]
  - @agent-native/toolkit@0.10.5

## 0.15.18

### Patch Changes

- b00c38d: Remove the redundant extensions section from the Dispatch sidebar.

## 0.15.17

### Patch Changes

- 5477352: Keep Dispatch's overview composer, full-page chat, and side chat on the same selected model.

## 0.15.16

### Patch Changes

- Updated dependencies [4b734be]
  - @agent-native/toolkit@0.10.4

## 0.15.15

### Patch Changes

- Updated dependencies [180b41d]
  - @agent-native/toolkit@0.10.3

## 0.15.14

### Patch Changes

- 2254362: Make Dispatch messaging setup and destination workflows progressively disclose advanced details.
- Updated dependencies [2254362]
  - @agent-native/toolkit@0.10.2

## 0.15.13

### Patch Changes

- c15d20f: Pin Slack delivery to the app that received the event and reject legacy bot tokens from a different Slack app.
- Updated dependencies [c15d20f]
- Updated dependencies [c15d20f]
- Updated dependencies [c15d20f]
  - @agent-native/toolkit@0.10.1

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
