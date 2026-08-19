# @agent-native/dispatch

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

## 0.15.12

### Patch Changes

- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
  - @agent-native/toolkit@0.10.0

## 0.15.11

### Patch Changes

- 03a043e: Prevent reasoning messages from losing their assistant UI provider, and add a progressively disclosed recent-chat rail for app sidebars.
- 03a043e: Make template feedback controls opt in through `VITE_AGENT_NATIVE_FEEDBACK_URL` so cloned apps do not send feedback to Agent Native by default.
- Updated dependencies [03a043e]
- Updated dependencies [03a043e]
  - @agent-native/toolkit@0.9.1

## 0.15.10

### Patch Changes

- Updated dependencies [0341a7d]
  - @agent-native/toolkit@0.9.0

## 0.15.9

### Patch Changes

- Updated dependencies [5c78d2d]
  - @agent-native/toolkit@0.8.3

## 0.15.8

### Patch Changes

- 8df32f6: Publish the latest Builder link tracking updates.

## 0.15.7

### Patch Changes

- Updated dependencies [dcd0810]
  - @agent-native/toolkit@0.8.2

## 0.15.6

### Patch Changes

- Updated dependencies [6d96437]
  - @agent-native/toolkit@0.8.1

## 0.15.5

### Patch Changes

- f3dcee3: Suppress provisional artifact warnings while delegated work is still running, and preserve verified Slack provenance for cross-app intake through an audience-scoped, fail-closed resolver.

## 0.15.4

### Patch Changes

- Updated dependencies [8453025]
  - @agent-native/toolkit@0.8.0

## 0.15.3

### Patch Changes

- e53a34e: Move the reusable ChatHistoryList and its stylesheet to the Toolkit chat-history entrypoint while preserving Core compatibility imports. Adopt it across first-party full-page chat sidebars, ship readable Toolkit source, and add generated-app guidance for selective app-owned UI customization.
- e53a34e: Add reusable provider API and staged dataset action factories, including opt-in custom provider registration and sanitized provider request audit summaries that narrow recorded audit metadata to safe request context.
- Updated dependencies [e53a34e]
  - @agent-native/toolkit@0.7.0

## 0.15.2

### Patch Changes

- 079e19a: Adopt focused Core client entrypoints and ship package migration metadata where applicable.

## 0.15.1

### Patch Changes

- b6d7f87: Move portable rich-editor, context presentation, and visual design controls into Toolkit while preserving Core compatibility re-exports, and add accurate side-effect metadata to capability packages.

## 0.15.0

### Minor Changes

- 6cd2c79: Add curated workspace app discovery and template remix workflows.

## 0.14.14

### Patch Changes

- 8e0afec: Keep empty Dispatch chat navigation from automatically opening the AgentSidebar.

## 0.14.13

### Patch Changes

- 10fb9f4: Preserve durable `ask_app` task handles and return retryable status-read details when transient polling transport failures outlast bounded retries.

## 0.14.12

### Patch Changes

- 7f5068c: Make dreams page responsive across all screen sizes: stat tile labels now truncate instead of clipping, stats render as a full-width grid (2-col on mobile, 4-col on md+), action buttons wrap on their own row, and the three-panel content grid stacks on mobile, goes 2-col on lg, and 3-col on xl.

## 0.14.11

### Patch Changes

- cdfa357: Fix infinite render loop in DreamsRoute caused by the `useEffect` fallback clearing `selectedDreamId` to `null` while `dreams` was still loading. Added a `dreamsQuery.isLoading` guard to prevent the fallback from running before data resolves.

## 0.14.10

### Patch Changes

- 7cfb087: Re-sync all vault secrets into the shared credential store at startup so upgraded encryption formats propagate without manually re-saving each key.
- 7cfb087: Resolve provider credentials from encrypted Dispatch vault secrets, keep hosted A2A agent discovery distinct from mounted workspace app inventory, and run long Analytics A2A tasks on the durable background worker.

## 0.14.9

### Patch Changes

- 8e6f022: Allow Dispatch hosts to link the AgentSidebar to a full-page Agent surface.
- 8e6f022: Improve collapsed Dispatch navigation spacing and sizing.

## 0.14.8

### Patch Changes

- 3c3a59d: Default the unified MCP gateway to expose all discovered workspace apps until an explicit access policy is configured.
- 3c3a59d: Return durable task handles for long-running MCP agent requests and expose
  grant-checked status polling instead of holding one MCP tool call open for the
  full agent run.

## 0.14.7

### Patch Changes

- 10dc602: Widen centered full-page Ask and Chat composers by 20% while keeping their responsive viewport cap.

## 0.14.6

### Patch Changes

- 1137302: Keep session replay identities isolated per browser tab so recordings from
  concurrent or duplicated tabs cannot be merged into a corrupt replay. Preserve
  signed DOM stylesheet, font, image, and other load-bearing resource URLs while
  continuing to redact navigation and diagnostic URL secrets. Recover long-lived
  tabs from replay upload identity conflicts by restarting once with a fresh
  snapshot, and report the content-free recovery outcome to Analytics.
  Stabilize Dispatch's deferred-navigation behavior under test-runner load.

## 0.14.5

### Patch Changes

- ee7b5b3: Prevent sync-driven request storms by preserving in-flight reads, filtering same-tab action echoes, targeting action-query invalidation, refreshing shared run state from change events, and backing idle Dispatch monitoring away from fixed polling.
- ee7b5b3: Remove the obsolete template cards from the Dispatch Apps page.
- ee7b5b3: Reduce the width and height of centered full-page chat composers for a more compact starting state.

## 0.14.4

### Patch Changes

- 38ca6fa: Polish the Dispatch overview and chat flow with cleaner navigation, view-transition routing, and a stable bottom-pinned chat composer.
- 38ca6fa: Restrict organization-wide Dispatch MCP app grants to owners and admins, default new gateways to Dispatch-only access, allow Dispatch itself in selected-app mode, and keep large app catalogs machine-readable for MCP hosts.
- 38ca6fa: Make sheets and toasts respond faster while respecting reduced-motion preferences.
- 38ca6fa: Show retryable error states when Dispatch data queries fail instead of rendering misleading empty content.
- 38ca6fa: Tenant-scope approval request status updates so requests can only be approved or rejected within their own workspace context.

## 0.14.3

### Patch Changes

- f43d34c: Fence approval/rejection status transitions so concurrent approvals cannot double-apply side effects.

## 0.14.2

### Patch Changes

- 6baca78: Move Slack's legacy single-workspace token under advanced setup while keeping managed OAuth credentials primary.

## 0.14.1

### Patch Changes

- dfbbf30: Keep the optional server tokenizer out of browser production bundles, publish Dispatch's Operations route, simplify Dispatch's sidebar identity and chat history, and route design-task creation into structured intake.

## 0.14.0

### Minor Changes

- d967304: Add managed multi-workspace Slack OAuth with Agent view and direct messages, team-aware threads, bounded native context, streaming task controls, channel identities, explicit memory, channel routines, and usage governance.
- d967304: Add verified Microsoft Teams and Discord interaction channel adapters, preserve Telegram topic and WhatsApp contextual-reply identity, and expose exact runtime capabilities in Dispatch setup.

### Patch Changes

- d967304: Apply app final-response guards to delegated A2A turns and resolve Slack sender profiles with request-scoped configured credentials.
- d967304: Preserve canonical Slack and Telegram request context across A2A delegation, resolve structured intake and domain workflows through workspace instructions and app capabilities, and return verified destination links for saved Content records, Analytics monitors, and published Forms.
- d967304: Redact provider request audit targets and harden managed integration persistence against concurrent callbacks and SQLite migration failures.
- d967304: Harden integration tenant isolation, service-principal identity, shared job routing, audit visibility, and usage-budget settlement.
- d967304: Add a shared integration catalog with accurate built-in messaging metadata and reusable client helpers for integration setup routes.

## 0.13.13

### Patch Changes

- 1d13434: Make framework polling cheaper with durable sync events, remove Dispatch's short app-list polling intervals, preview large DB admin cells by default to avoid accidental blob transfers, and require configured file storage for binary resource uploads instead of storing base64 blobs in SQL.

## 0.13.12

### Patch Changes

- 680b1eb: Keep Dispatch metrics available as an empty state when usage storage bootstrap or reads are unavailable.

## 0.13.11

### Patch Changes

- 823d635: Add a dedicated Automations page with sidebar navigation so scheduled and event-triggered jobs can be reviewed and toggled without restoring the old overview dashboard.
- 823d635: Surface outbound delivery-queue health on Destinations and add quiet overview shortcuts so cleaned-up overview capabilities stay discoverable without restoring the old dashboard. Localize those overview shortcut and delivery-queue labels across Dispatch locales.
- 823d635: Upgrade the workspace toolchain to TypeScript 7 (`tsc`) with a side-by-side TypeScript 6 API package for tools that still need programmatic access. Replace `@typescript/native-preview` / `tsgo` with the stable `typescript` 7 release.

## 0.13.10

### Patch Changes

- e310ac1: Make Telegram dispatch chats require an explicit linked identity and route cross-app messaging requests through the continuation-aware agent delegation path.

## 0.13.9

### Patch Changes

- 3995e4e: Simplify the Dispatch overview to just Ask Dispatch and the apps list.

## 0.13.8

### Patch Changes

- 9d8c83c: Route Dispatch agent settings through the shared settings tabs.

## 0.13.7

### Patch Changes

- b24446e: Add `@agent-native/toolkit` for reusable app-building UI, move shared template primitives into it, and keep core UI shim imports working through compatibility re-exports.

## 0.13.6

### Patch Changes

- 622d552: Remove retired scaffold aliases from template catalogs and app pickers.

## 0.13.5

### Patch Changes

- 2b27c0f: Avoid unsupported array helpers in Builder engine message caching and stabilize prep-load tests.

## 0.13.4

### Patch Changes

- 1d77419: Keep Dispatch cron schedule validation compatible with the shared lint and release gates.

## 0.13.3

### Patch Changes

- aa345cc: App shells use an outline-style raised surface ring and Dispatch left navigation can collapse to an animated icon rail.

## 0.13.2

### Patch Changes

- a6492db: Read Dispatch integration credentials from scoped secrets and move team management into Settings tabs.

## 0.13.1

### Patch Changes

- 4a73032: Make shared agent and default navigation drawers feel recessed behind rounded app content.

## 0.13.0

### Minor Changes

- 2a03c35: Upgrade framework and template React Router support to v8 and require the v8 runtime baselines.

### Patch Changes

- 2a03c35: Align dispatch landing-page redirects with the current router loader URL context.

## 0.12.3

### Patch Changes

- fd78baa: Localize Dispatch workspace pages and scheduling booking-link controls.

## 0.12.2

### Patch Changes

- c294aaa: Expand localized UI coverage across core client surfaces, Dispatch chrome, scheduling controls, templates, and the docs site.

## 0.12.1

### Patch Changes

- 6067f27: Fix right-to-left (`ar-SA`) layout in shared framework chrome. Physical directional CSS in the agent panel, command menu, language picker, shadcn `ui/*` primitives, settings/composer/org/sharing/onboarding panels, and the agent-conversation/blocks/rich-markdown styles is converted to logical utilities (`ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`/`text-end`, `border-s`/`border-e`), and directional icons are mirrored with `rtl:-scale-x-100`. No change to left-to-right rendering (logical utilities are identical to physical in LTR).

## 0.12.0

### Minor Changes

- 16356c2: Add a framework helper for opening the agent settings tab and standardize app settings access in Dispatch.

### Patch Changes

- 16356c2: Add framework localization support with shared i18n providers, locale preference actions, catalog loading helpers, guards, and docs.

## 0.11.9

### Patch Changes

- 4a0d3c4: Clarify Builder code-change handoff fallbacks when cloud agents are unavailable.

## 0.11.8

### Patch Changes

- d684bbf: Keep Dispatch full-page chat thread links type-safe while preserving deep-link handoff behavior.

## 0.11.7

### Patch Changes

- 6605885: Add opt-in URL sync for durable chat threads and route chat-first templates (chat, assets, and Dispatch) through `/chat/:threadId` deep links.

## 0.11.6

### Patch Changes

- 9a984f2: Add a framework audit log: a durable, complete, access-scoped, append-only record of who mutated what app data, when, from where, and — when it was the agent — in which run. Capture is automatic at the `defineAction` seam (default-on for mutating actions; read-only actions opt in via `audit.onRead`), with credential redaction, agent-vs-human actor attribution, and agent thread/turn linkage. Reads go through two new core actions every app inherits — `list-audit-events` and `get-audit-event` — scoped in SQL to the caller's identity and org. Stored in `agent_audit_log` (provider-agnostic), with a retention purge configurable via `AGENT_NATIVE_AUDIT_RETENTION_DAYS` (default 365) and a global kill switch `AGENT_NATIVE_AUDIT_ENABLED=false`. Distinct from observability (sampled telemetry) and tracking (fire-and-forget analytics).

## 0.11.5

### Patch Changes

- d9e93a3: Improve Dispatch default route SEO and social metadata titles.

## 0.11.4

### Patch Changes

- 7157583: Wire Dispatch's full-page chat into the shared chat handoff flow so it can morph into the agent sidebar while preserving the active thread.
- 7157583: Remove the broad shadow from Dispatch's centered chat composer.

## 0.11.3

### Patch Changes

- 8a74b0a: Add the Chat template as the public minimal app on-ramp and keep Starter as a legacy CLI alias.
- 8a74b0a: Add Dispatch automation status controls backed by jobs markdown resources.

## 0.11.2

### Patch Changes

- ca3efcf: Add the Chat template as the public minimal app on-ramp and keep Starter as a legacy CLI alias.
- ca3efcf: Add Dispatch automation status controls backed by jobs markdown resources.

## 0.11.1

### Patch Changes

- f16980e: Expose agent-chat plugin options for skipping first-turn workspace inventory and sending a compact starter tool catalog that expands from tool-search results.

## 0.11.0

### Minor Changes

- f81e032: Add token-efficient web content fetching for agents. `web-request` and `provider-api-docs` can now return extracted markdown, plain text, metadata, links, or bounded search matches instead of raw HTML, and `run-code` exposes `webRead()` plus pass-through options on `webFetch()` for compact web/document reduction.

## 0.10.4

### Patch Changes

- 1d0f069: Add staged provider API responses for Dispatch so broad provider searches can save bounded corpora and reduce them outside chat context.
- 8726f38: Teach all app agents that provider shortcut actions are not capability limits and that broad provider searches, joins, classifications, and absence claims should use provider API staging, saved responses, staged-dataset queries, or sandboxed code with explicit coverage reporting. Ensure lean, A2A, and MCP ask-agent registries include run-code when code execution is enabled, and give sandboxed code generic providerRequest/providerFetchAll helpers for broad paginated provider corpus work.

## 0.10.3

### Patch Changes

- c5abc5c: Fix extension secret setup guidance and hosted Dispatch template scaffolding.

## 0.10.2

### Patch Changes

- 3c1d3eb: Update dispatch provider APIs and scheduling internals for the runtime refresh.

## 0.10.1

### Patch Changes

- 40ed196: Lighten the outline button border in dark mode while keeping the `border-input` token (proper contrast) in light mode.

## 0.10.0

### Minor Changes

- 600f83d: **Custom provider registry** — register any API provider at runtime

  A new `custom_api_providers` SQL table (created on first use, additive) stores
  user/org-scoped provider registrations so the agent can call APIs that are not
  in the 24 built-in PROVIDER_CONFIGS:
  - `upsertCustomProvider`, `deleteCustomProvider`, `listCustomProviders`,
    `getCustomProvider` — CRUD helpers exported from `@agent-native/core/provider-api`.
  - `validateCustomBaseUrl` — SSRF-safe URL validation for registration time.
  - `createProviderApiRuntime` now accepts `getCustomProviders?: () => Promise<CustomProviderConfig[]>`.
    Custom providers are merged into the catalog after built-ins; they cannot
    shadow built-in ids.
  - Auth kinds supported for custom providers: `none`, `bearer`, `basic`,
    `api-key-header`. `google-service-account` and `oauth-bearer` are not
    supported (require out-of-band setup).
  - Credentials live in the existing secrets/credentials store — the provider
    row stores only credential key NAMES, never values.
  - SSRF guard (`isBlockedExtensionUrlWithDns`) is enforced at registration time
    and again at every request.

  **New Dispatch action: `provider-api-register`**

  Register, update, delete, or list custom providers:

  ```
  { operation: "upsert"|"delete"|"list"|"get",
    id, label, baseUrl, auth, docsUrls?,
    allowedHostSuffixes?, defaultHeaders?, notes?, scope? }
  ```

  **Updated Dispatch actions**

  `provider-api-catalog`, `provider-api-docs`, and `provider-api-request` now
  accept any provider id (built-in or custom) — the `provider` field is relaxed
  from `z.enum(BUILT_IN_IDS)` to `z.string()` with runtime validation against the
  merged registry. Unknown provider errors include the list of known provider ids.

  ***

  **Open docs fetching** in `provider-api-docs`

  `fetchProviderApiDocs` now allows ANY public `https`/`http` URL — not just
  URLs same-origin with registered `docsUrls`/`specUrls`. The SSRF guard and
  byte caps still apply. Registered docs/spec URLs remain available as curated
  starting points in the catalog output. The Dispatch `provider-api-docs` action
  description is updated to reflect this.

  ***

  **New `web-search` agent tool** (`packages/core/src/extensions/web-search-tool.ts`)

  Registers a `web-search` tool in dev and prod agent tool registries:
  - Input: `{ query: string, count?: number (default 5, max 10) }`.
  - **Pluggable backends** — at call time the first configured key wins:
    1. `BRAVE_SEARCH_API_KEY` → Brave Search API
    2. `TAVILY_API_KEY` → Tavily
    3. `EXA_API_KEY` → Exa
       Keys are resolved from the per-user/org credentials store first, then env vars.
  - Returns a title / URL / snippet list with guidance to follow up via
    `web-request` or `provider-api-docs`.
  - If no backend is configured, returns a helpful message listing the three keys.
  - Description: "Search the public web — use to find API docs, endpoints, or
    current information, then fetch promising URLs with web-request or
    provider-api-docs."

  **Framework secret registrations** (`register-framework-secrets.ts`)

  `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, and `EXA_API_KEY` are registered as
  optional workspace-scoped secrets so they surface in the settings UI.

- 600f83d: Add `saveToFile` and `fetchAllPages` to `provider-api-request` and `saveToFile` to `web-request`.
  - `saveToFile?: string` on `provider-api-request` and `web-request`: writes full response
    body to a workspace file path instead of returning it in context. Allows up to 20 MB
    (vs normal 4 MB). Returns compact summary `{ savedToFile, savedTo, status, bytes, contentType, preview }`.
  - `fetchAllPages?: { cursorPath, cursorParam, itemsPath?, maxPages? }` on `provider-api-request`:
    generic cursor pagination — re-issues requests until cursor is empty or maxPages (default 10,
    max 50) is reached; accumulates items from `itemsPath`. Combines naturally with `saveToFile`.
  - `workspace-files` tool added to sandbox bridge default allowlist.

## 0.9.3

### Patch Changes

- 31646a3: Keep Dispatch thread preview route metadata browser-safe by moving pure preview helpers out of server modules.

## 0.9.2

### Patch Changes

- 2da75f1: Resolve package-internal `@/*` imports to relative paths in published Dispatch
  dist files so consumer SSR builds do not try to load app-local aliases.

## 0.9.1

### Patch Changes

- 56888a3: Update React Router dependencies to 7.16.0.

## 0.9.0

### Minor Changes

- 1acd641: Add a shared provider API runtime for flexible, provider-aware authenticated HTTP requests, and expose provider API catalog/docs/request actions from Dispatch.

## 0.8.28

### Patch Changes

- d987847: Keep Dispatch route loaders from pulling server-only framework modules into the browser bundle.

## 0.8.27

### Patch Changes

- a56d93d: Remove compiler-verified dead code (unused imports, unused non-exported types,
  and side-effect-free unused locals) across the framework. No behavior or public
  API changes — only declarations the TypeScript compiler proves are unreferenced.
- a56d93d: Fix Messaging enable/disable and webhook setup fetches to use `agentNativePath()`, so they work under a base-path (workspace) mount instead of 404ing at the gateway root.
- a56d93d: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.

## 0.8.26

### Patch Changes

- 6e6fce7: Internal cleanup sweep: remove unused imports/variables and tidy code (no behavior change).

## 0.8.25

### Patch Changes

- 853ab71: Escape application-state and resource prefix queries so literal `%` and `_` characters do not over-match keys. Also make core store initialization retry after transient failures instead of caching rejected promises, and keep run SSE polling moving past corrupt persisted events.

  Search and rate-limit LIKE filters now treat user text literally, including chat-thread/debug searches and inbound-email sender matching.

## 0.8.24

### Patch Changes

- d4013f0: Remove compiler-verified dead code (unused imports, unused non-exported types,
  and side-effect-free unused locals) across the framework. No behavior or public
  API changes — only declarations the TypeScript compiler proves are unreferenced.
- d4013f0: Fix Messaging enable/disable and webhook setup fetches to use `agentNativePath()`, so they work under a base-path (workspace) mount instead of 404ing at the gateway root.
- d4013f0: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.

## 0.8.23

### Patch Changes

- c3852e0: Stop inbound email from impersonating real users. The inbound email adapter now
  derives a `senderVerified` flag from the provider's DKIM/SPF
  (`Authentication-Results`) results, and dispatch only grants a sender's real
  identity — their API keys, org secrets, personal instructions, and ownable data
  — when the message is DKIM/SPF-verified for the From domain AND that address is a
  real org member. Unverified or spoofed `From:` headers fall back to a synthetic,
  credential-less owner. Linked identities (`/link`) are unchanged. The legacy
  "trust the From header" behavior can be restored with
  `DISPATCH_TRUST_UNVERIFIED_EMAIL_SENDER=1` (off by default).

## 0.8.22

### Patch Changes

- aa80e15: Improve Dispatch overview stat card wrapping in narrow embedded windows.

## 0.8.21

### Patch Changes

- 5355ff0: Use generated image outputs as Open Graph images for Dispatch thread links.

## 0.8.20

### Patch Changes

- ff0fae2: Allow Brain and Dispatch sidebar chat threads to be renamed from their row menu.
- ff0fae2: Keep the Dispatch hero composer within the available content column on medium screens.
- ff0fae2: Promote Brain and Assets in public template catalogs and Dispatch workspace template defaults.
- ff0fae2: Only show Dispatch chat history in the sidebar while the Chat tab is active.

## 0.8.19

### Patch Changes

- 9f3a798: Add a full-page Dispatch chat route with sidebar thread history.

## 0.8.18

### Patch Changes

- 2ea399e: Expose selected Dispatch workspace skills, resources, and MCP server definitions to granted app agents at runtime.

## 0.8.17

### Patch Changes

- 1c0b51e: Keep MCP App host catalogs compact by default, hide one-time embed tickets from model-visible output, and keep host follow-up prompts separate from hidden context.

## 0.8.16

### Patch Changes

- 11362a2: Keep MCP App resource listing resilient to CSP metadata failures and invalid Dispatch app URLs.

## 0.8.15

### Patch Changes

- 3b1a0e5: Accept nested `params.embed` and `params.chrome` values in MCP `open_app` calls.

## 0.8.14

### Patch Changes

- 4a5dc8d: Retry transient agent-chat route-missing startup responses and harden Dispatch MCP embed fallback behavior.

## 0.8.13

### Patch Changes

- 0efeaec: Allow Dispatch-routed MCP app embeds to authenticate target apps with synced org A2A secrets.

## 0.8.12

### Patch Changes

- 5bf1ce0: Retry transient target MCP handshakes when Dispatch pre-mints cross-app embeds.

## 0.8.11

### Patch Changes

- 236f106: Pre-mint Dispatch MCP app embed sessions from open_app results so hosts can render inline apps without a follow-up helper call.

## 0.8.10

### Patch Changes

- 75223dd: Fix Dispatch-routed MCP App embed sessions and surface embed helper errors in the wrapper.
- 75223dd: Expose current extension ids to agents and wait for tracked async framework plugins before dispatching first serverless requests.

## 0.8.9

### Patch Changes

- 5173662: Lower default full-app MCP App embeds to a 720px app viewport.

## 0.8.8

### Patch Changes

- 0ba051e: Prevent Dispatch workspace app card text from collapsing at intermediate grid widths.

## 0.8.7

### Patch Changes

- bbaa675: Make Dispatch visible as an MCP app target and route Dispatch extension embeds through the local app session helper.
- bbaa675: Clarify MCP app embeds can target focused app routes as well as full app surfaces.
- bbaa675: Request taller full-app MCP App embeds.
- bbaa675: Scope pending Builder app placeholders to the creating branch context, hide stale entries, and let workspace users edit app display metadata.

## 0.8.6

### Patch Changes

- 789ba7d: Clarify starter app creation guidance, seed app descriptions, and remove starter/new-app leftovers from starter-derived apps.
- 789ba7d: Add Dispatch unified MCP gateway guidance and app-grant controls.
- 789ba7d: Tighten the Dispatch apps grid layout and progressively disclose template and hidden-app sections.

## 0.8.5

### Patch Changes

- 819cf59: Address MCP app route hardening and Dispatch vault cleanup edge cases from review.

## 0.8.4

### Patch Changes

- 15d9967: Clean up synced Dispatch vault secrets on delete and make DB timeout cleanup awaitable.

## 0.8.3

### Patch Changes

- 482e9db: Add SEO-friendly extension URLs with generated name slugs and extension page titles.
- 482e9db: Add Dispatch Vault UI controls for editing existing secrets.

## 0.8.2

### Patch Changes

- 3eb86c8: Allow extensions to resolve vault-backed keys from the active workspace and mirror Dispatch vault saves into the shared credential store.

## 0.8.1

### Patch Changes

- dbf8db4: Make the Dispatch source health column migration idempotent on temp workspace boot.

## 0.8.0

### Minor Changes

- 79a0eb9: Add Dispatch dreaming backend tables, actions, proposals, and safe recurring dream job setup.

### Patch Changes

- 79a0eb9: Expose package-provided actions through template action runners and add a full Dispatch Dreams settings editor.
- 79a0eb9: Expose Dispatch shadcn UI primitives for workspace-owned Dispatch template routes.
- 79a0eb9: Link the local Dispatch package during framework-development workspace creation and build Dispatch before local packing.
- 79a0eb9: Inherit Dispatch-managed workspace instructions, skills, and reference resources at runtime; seed and restore starter company, brand, messaging, guardrail, and voice resources; show and inspect each app's effective workspace context stack; gate All-app resource edits through Dispatch approvals when enabled; preview global impact and overrides before save; and expose read-only inherited workspace resources in app panels.
- 79a0eb9: Remove legacy workspace-resource sync actions and clarify runtime inheritance docs.
- 79a0eb9: Align local Drizzle peer resolution with the framework's libsql driver version.
- 79a0eb9: Route Telegram `/code` commands from Dispatch to the remote code-agent relay.

## 0.7.0

### Minor Changes

- f400c81: Add `create-pylon-ticket` action to Dispatch for escalating blockers, unmatched `#customer-*` routing, or follow-ups that need tracking — uses `PYLON_API_KEY` from the Vault. Instrument the agent chat with Sentry captures when the auth-error card stays visible past auto-recovery (`auth_error_card_stuck`) and when SSE reconnect times out (`reconnect_no_progress`) so we can chase the "occasional Reload UI required" symptom.
- ffd3d00: Add first-class workspace app audience metadata with route-level public/protected page access.

### Patch Changes

- d1a90ac: CLI + dispatch shell fixes from create-workflow feedback:
  - `create`: scaffold `packages/pinpoint` when the user selects `slides` or
    `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
    `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
    `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers
    every template with `@agent-native/*` workspace deps so a regression
    surfaces in CI instead of on the user's machine.
  - `create`: per-template progress messages during scaffolding
    (`Scaffolding Slides (3/4)...`, `Adding shared packages...`) and a
    concrete "this is done" stop message, replacing the single static
    "Working... no action needed" line that made a multi-app workspace
    feel hung.
  - `create`: detect `pnpm` on PATH before printing the outro. If it's
    missing, the next-steps block now leads with `npm install -g pnpm`
    instead of dumping the user at `zsh: command not found: pnpm`.
  - `create`: Dispatch is now always scaffolded into a new workspace
    rather than being a recommended-but-optional pick. The picker only
    lists the optional apps; the workspace note explains that Dispatch is
    always included as the control plane. `--template=forms` (or any
    non-Dispatch list) still works — Dispatch gets unioned in. New
    regression test asserts this.
  - Auth guard: local-dev convenience for `NODE_ENV=development`. When
    the `user` table has no real users yet, the first unauthenticated
    page GET transparently signs up (and signs in) a `dev@local` account
    and 302s back to the requested URL, instead of showing the sign-up
    form. A developer running `pnpm dev` lands straight in the app. Once
    any real account exists the auto-create short-circuit fires and the
    regular login flow takes over. Opt out with
    `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`. Production is unaffected.
  - `DispatchShell`: page-title info icon is now a click-driven Popover
    instead of a hover-only Tooltip, and the trigger button has a
    proper hover background so it reads as clickable. Clicking the icon
    (the natural gesture, and the only available one on touch) did
    nothing before.
  - `create`: clean up the partially-scaffolded directory when scaffolding
    fails (e.g. flaky network during the template download). Without this
    the first failure left the workspace dir on disk, and the next
    `agent-native create <name>` rejected the same name with "Directory
    already exists" — forcing a manual `rm -rf` before retrying.
  - Dispatch apps list: filter dotfile directories (e.g.
    `.agent-native-tmp-*` extraction sidecars) when reading the
    workspace's `apps/` directory. The temp dir is a sibling of the
    target so it appeared at the top of the apps grid mid-scaffold,
    looking like a stray entry.
  - Dispatch onboarding: register a "Create your first app" step at order
    5 so it sits above the Slack/Telegram secret-onboarding steps. A
    brand-new workspace was leading with "Connect Slack" before the user
    had even added an app, which felt confusing.
  - Agent system prompt (chat-in-browser-on-localdev): when a user asks to
    scaffold a new workspace app from a localhost browser tab, point them
    at \`npx @agent-native/core@latest add-app\` first since they're already in
    that terminal. The desktop / Claude Code / Codex / Builder.io
    alternatives still follow for general source-editing work.

- 97ca0db: Dispatch's catch-all `/$appId` route now falls back to first-party template deploy URLs (e.g. `http://localhost:8084` for forms in dev, `https://forms.agent-native.com` in prod) when no workspace manifest is loaded. Previously, visiting `/forms` on hosted dispatch — or in framework dev where each template runs on its own port — forced the auth guard, then dropped the user on dispatch's "Page not found" pane after the post-login reload. Now the catch-all reads the built-in agent registry and redirects to the real app.
- f80dc8c: Fix two bugs in `resolveCatchAllTarget` (the `/dispatch/<appId>` fallback resolver, used when no explicit dispatch route matches):
  - Honour `app.url` from the workspace manifest. Workspaces can point at externally-hosted apps via an absolute URL on the manifest entry; the resolver was ignoring that field and falling through to the local path. `app.url` now takes precedence over `app.path`.
  - Normalize `app.path` instead of silently rewriting to `/${appId}`. When the manifest path doesn't start with a slash (`path: "my-forms"`) the previous code returned `/${appId}`, which routed to the wrong app whenever an entry's mounted path differed from its id. Now the leading slash is just prepended, preserving the path.

  Both surfaced by the Builder PR-review bot on #651.

- b5b6f22: `resolveCatchAllTarget` now validates `app.url` is an absolute http(s) URL before letting it take precedence over `app.path`. Previously any non-empty string would win — including bare hostnames like `"forms.example.com"` (no protocol, browser would treat the redirect as a relative path inside the gateway and 404) or `javascript:` schemes (phishing vector). Mirrors the validation in `normalizeWorkspaceAppUrl` (deploy CLI), inlined to avoid pulling that module into the runtime path. 3 new spec cases (bare hostname rejected, non-http(s) scheme rejected, trailing slash stripped). Flagged by the Builder bot review on #652.
- d1a90ac: Integrations page: long connector names now truncate cleanly inside the tile and reveal the full name on hover. Previously the label could overflow past the tile edge on narrow grid columns.
- d1a90ac: Operations → Messaging tile layout cleanup. The Docs / "Open Slack apps" / "Open BotFather" header links now share a single ghost-button style with consistent external-link icons. Each tile gets a divider before its action footer so the Enable / Set up webhook buttons sit in a clear footer row. The disabled Enable button now explains _why_ via a tooltip, replacing the redundant "Save the required credentials before enabling…" helper paragraph.
- d1a90ac: Several feedback fixes:
  - **Dispatch back-button to `/dispatch/dispatch/overview`.** `dispatchNavLinkTarget` (the helper that decides whether NavLink should manually prepend the workspace mount prefix) read `window.__reactRouterContext.basename` to detect the router's basename. If that global wasn't set yet at render time, the helper double-prefixed the `to` prop, the router then prepended its own basename, and the resulting `/dispatch/dispatch/<route>` landed in browser history — clicking back from any dispatch page later took the user to that 404. The helper now mirrors `entry.client.tsx`'s basename calculation directly from `window.location.pathname`, removing the context-global race. `routerPath` (in both the package and the template copy) also iteratively strips the basename so any doubly-prefixed path that snuck into `application_state.navigate` doesn't get partially-stripped here and re-prefixed by the router back to the bad URL.
  - **"Use Builder" CTA stuck after connect (web).** The Builder upsell CTA in `AgentPanel` opens Builder in a `<a target="_blank">` tab, not a popup, so it never started the `useBuilderConnectFlow` polling loop — `useBuilderConnectUrl` was fetched once on mount and never refreshed, leaving the CTA in the "Use Builder" state after the user came back to the original tab. The callback success HTML now posts a `builder-connect-success` BroadcastChannel + window.opener message (mirroring the existing error-path broadcast), and `useBuilderConnectUrl` listens on BroadcastChannel + `window.message` + `focus` + `visibilitychange` + the existing `agent-engine:configured-changed` event, refetching `/builder/status` on any of them. Also dispatches `agent-engine:configured-changed` when status first reports configured so the rest of the chat tree updates without a full reload.
  - **Firebase `auth/popup-blocked` in desktop Builder connect.** Builder's `/cli-auth` page signs into Google via `signInWithPopup`, which calls `window.open()`. Inside the Electron OAuth `BrowserWindow` we create for the Builder flow, there was no `setWindowOpenHandler`, so Electron's default silently blocked the popup — Firebase reported `auth/popup-blocked`, the parent OAuth window never received the result, and the user saw a blank screen that then closed. The OAuth window now returns `action: "allow"` for https child popups and constructs the child as another `BrowserWindow` sharing the same `session` so Firebase's `window.opener.postMessage` handshake reaches back.
  - **`resolveScopedBuilderCredential` tracing.** The Builder credential lookup walked user → org → workspace silently; when "I connected Builder but chat says use Builder" reports come in, there was no way to tell which scope answered or whether none did. Each branch now logs the scope, email, orgId, and hit/miss outcome (matching the existing always-on tracing in `resolveSecret` for BUILDER\_\* keys).

- ce9e355: Default Dispatch vault access to all workspace apps, add manual grant mode, sync vault keys into encrypted app secrets, and fix org-scoped vault listing.
- ce9e355: Save generated workspace app descriptions, make Dispatch app metadata editable, and include workspace app names/descriptions in A2A agent context.

## 0.6.1

### Patch Changes

- 704951d: fix(dispatch): replace inline "Loading..." with skeletons + stop `/dispatch/dispatch` redirect loop

  Six dispatch loading states were rendering the literal string "Loading..." (or "Loading…", "Loading app status...") instead of skeleton placeholders. This made the UI feel cheap and inconsistent with the rest of the framework.

  Now using `<Skeleton>` placeholders shaped like the content that's about to render in:
  - `approval.tsx` — full-page approval preview card (was: centered "Loading...")
  - `overview.tsx` — Recent activity list under Operations detail (was: small "Loading..." next to the section header)
  - `vault.tsx` — Secrets tab count badge and the empty list area (was: inline "Loading...")
  - `workspace.tsx` — Workspace Resources count and tab list area (was: inline "Loading...")
  - `apps.$appId.tsx` — Workspace app detail card (was: "Loading app status...")
  - `app-keys-popover.tsx` — App-keys grant popover list (was: "Loading…")

  Also fixes a redirect loop on `/dispatch/dispatch` (the catch-all hit when something tries to navigate to dispatch from inside dispatch). The catch-all loader resolved the dispatch entry from the workspace manifest and redirected to `app.path` (`/dispatch`), but `useActionQuery`'s 2s poll re-fired the `window.location.assign(href)` effect each tick, leaving the page stuck on a "Loading…" state with the URL refreshing forever. Both `loader` and the new `clientLoader` now short-circuit to `appPath("/overview")` when `appId === "dispatch"`, and the component renders `<Navigate replace>` for the same case so SPA navigations resolve immediately.

## 0.6.0

### Minor Changes

- 04fe544: feat(integrations): redesign the Integrations page as service-grouped Connectors. The page now groups by credential key (OpenAI, Stripe, Slack, …) across every app in the workspace, and the new Connect dialog creates the vault secret, grants it to every app that wants it, and syncs in one flow. Old per-app progress cards and individual integration rows are replaced by a flat list of providers with their connect status.

### Patch Changes

- 04fe544: fix: bounce `/dispatch/<workspace-app-id>` to `/<workspace-app-id>` so Builder.io's "navigate to /<id>" calls — and any OAuth round-trip whose callbackURL captured that wrong path — land on the actual workspace app instead of a 404 inside Dispatch's chrome.
- 04fe544: fix(dispatch): make the `/dispatch/<appId>` server-side bounce work in production deploys and after live workspace changes by reading the same env-→file-→filesystem manifest fallback chain that the rest of agent discovery uses, instead of only checking `AGENT_NATIVE_WORKSPACE_APPS_JSON`.

  Core now exports `loadWorkspaceAppsManifest()` and the `WorkspaceAppManifestEntry` type from `@agent-native/core/server/agent-discovery`, so other server entrypoints can resolve the workspace manifest without re-implementing the fallback.

## 0.5.1

### Patch Changes

- 98d56cd: Increase vertical spacing between sections on Dispatch pages so section headings (Getting started, At a glance, Operations detail, etc.) read as distinct groups instead of running together.

## 0.5.0

### Minor Changes

- dd3090e: Add a three-dots menu to each workspace app card with **Hide from list** (per-viewer), **Restore to list**, and **Remove from list** (for pending Builder branches). Hidden apps are reachable from a "Show N hidden apps" expander at the bottom of the page. Also add an "Add a template" section to the Apps page that lists first-party templates not yet installed under `apps/` and scaffolds them via `agent-native add-app` on click. New actions: `archive-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, `list-available-workspace-templates`, `scaffold-workspace-app`.

### Patch Changes

- dd3090e: Wire `scaffold-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, and `list-available-workspace-templates` into the `dispatchActions` registry. Followup to the actions added in the previous release — they were imported but never exposed to the agent.

## 0.4.0

### Minor Changes

- 8fa51d9: Add agent actions for managing workspace apps from Dispatch: `scaffold-workspace-app`, `archive-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, and `list-available-workspace-templates`. Backed by the new archived-apps + available-templates surface in `app-creation-store`.

## 0.3.0

### Minor Changes

- 10d8f30: Add a Dispatch thread debugger with cross-source thread search and deep agent run inspection.

## 0.2.20

### Patch Changes

- d749754: Top-align command palettes so result count changes do not shift their viewport position.

## 0.2.19

### Patch Changes

- 9e11b24: Top-align command palettes so result count changes do not shift their viewport position.

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
