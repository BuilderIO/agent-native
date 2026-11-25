# @agent-native/dispatch

## 0.43.2

### Patch Changes

- 4a34f01: The `an` skill now describes when a live app view helps, carries the user's selection into follow-ups, updates the same view after a change and reads back what was saved. Dispatch's MCP server serves the skill through the MCP Skills extension, so hosts that support Skills over MCP get it with the connector.
- f3976d7: Starting an app branch for an email Builder does not recognize now retries with the connected account's user id whatever status Builder answers with. When there is no account to fall back to, the failure says the email is not a member of the connected Builder space instead of calling it temporary.
- feadc42: An app pane in ChatGPT now tells the host it is ready as soon as ChatGPT's bridge is read, instead of after a five second wait for the host handshake, so the pane stays open. The open-app tool description now asks the model to open the pane for show, open, draft, chart, calendar, and dashboard requests.
- 969463c: Hosted apps on the Dispatch chat home open in place and no longer show an external-link arrow on the Open button.
- Release all public npm packages with a patch version bump.
- 7f630e8: Rewrite Dispatch and core cross-app MCP tool descriptions as neutral, factual capability descriptions so hosts like ChatGPT do not flag prescriptive cross-tool instructions as suspicious.
- ccf8c31: Restore the last app pane after a reload when its saved state is valid. The pane read no longer gets dropped when the first mount is discarded, and a saved pane that is malformed is reported as unreadable instead of being treated as never saved.
- 11f193e: Route requests about GitHub issues and pull requests to Tasks even when they mention messages, while email and inbox requests still go to Mail.
- 343d243: Fix email change in multi-app workspaces: Dispatch's identity policies now ship in core, so any app sharing the database can rekey. Workspace apps no longer answer 503 `org-domain-missing` for an org without an allowed domain; the registry token names the org by id instead. Add `setupDispatch({ hostedCatalog: false })` to hide Builder-hosted apps from Dispatch lists.
- aecb9db: Show suggested actions as a labeled summary, and open the existing target instead of failing when it already exists.
- Updated dependencies [0f7bf06]
- Updated dependencies [e466d90]
- Updated dependencies
- Updated dependencies [459726e]
- Updated dependencies [0315ffa]
- Updated dependencies [124141d]
- Updated dependencies [4ad86d5]
- Updated dependencies [f037abc]
- Updated dependencies [971ad70]
- Updated dependencies [631ee7c]
  - @agent-native/toolkit@0.234.0
  - @agent-native/agentkit@0.234.0

## 0.43.1

### Patch Changes

- 969523d: Show readable suggested action details and open an existing workspace app when creation finds it.
- 88e0754: Take the sidebar toggle from the visible workspace app after another app was kept alive, so a retained app's hidden frame no longer shadows the one on screen.
- 7188162: Make an embedded app's chat rail on `/dispatch/apps/:appId` send the app frame's own browser tab id instead of Dispatch's, so asking the app chat to open something navigates the app frame instead of bouncing Dispatch to its overview.
- f3ff142: Fix workspace app chat session routing for cross-origin mounted apps.
- 98cd62f: Use a caller's scoped remote MCP OAuth connection for app actions and provide an authorization link when a target requires a connection.
- 6cd1113: Allow embedded workspace apps and browser pages to request fullscreen.
- df6374d: Route email and message requests to Mail before matching service pointers, while routing GitHub issues and pull requests to Tasks.
- Release all public npm packages with a patch version bump.
- b1197d4: Fix A2A browser tab and viewport mode propagation, add turn-scoped foreground viewport lock and early open_app pane commit, upgrade AppCapabilityManifest to v2 with route template validation, and add rendered screen verification receipts.
- Updated dependencies [6f4b56e]
- Updated dependencies [a57a58f]
- Updated dependencies [c71955a]
- Updated dependencies [a57a58f]
- Updated dependencies [a57a58f]
- Updated dependencies [7c866e8]
- Updated dependencies [6f84c01]
- Updated dependencies [a57a58f]
- Updated dependencies [a57a58f]
- Updated dependencies [c541b37]
- Updated dependencies
- Updated dependencies [a57a58f]
- Updated dependencies [c3bcccd]
- Updated dependencies [bb20dd7]
- Updated dependencies [2a7cf8c]
- Updated dependencies [4b68858]
- Updated dependencies [b755252]
- Updated dependencies [87dfdb6]
- Updated dependencies [a57a58f]
  - @agent-native/toolkit@0.233.0
  - @agent-native/agentkit@0.233.0

## 0.43.0

### Minor Changes

- f76439b: Add saved pointers: remember-pointer stores a name for an object in a workspace app (for example "todo list" for a doc), resolve-pointer looks one up over MCP, and route-app-intent opens a matching pointer's object before it asks the model. The route-app-intent cache key moves to v2 because pointers are now part of its input.

### Patch Changes

- 3a066b3: Open the app pane for a new chat's first message as soon as the send names its thread, instead of waiting for the chat URL to settle. The routed app now appears at route latency rather than after the chat route's loader returns.
- 8ed972b: Skip restoring a previous session's saved app pane on a new chat so routed prompts do not flash an old app before opening the routed pane.
- b578994: Chat-first Dispatch asks its app route which app a sent message is about while the agent's turn starts, and opens that app's pane as soon as the route answers instead of waiting for the agent to open it. It starts the app's embed session right away. If the agent then opens the same app, that pane moves to the agent's page; if it opens a different app, that app replaces it. Nothing opens for a chat-only, failed, unconfigured or late answer. Nothing opens either when the answer arrives after a newer message, after a send was rejected, after the agent or the person changed the pane, or after the person left that chat. `@agent-native/core/client/agent-chat` exports `reportAgentChatComposerSubmit`, `withdrawAgentChatComposerSubmit`, `subscribeAgentChatComposerSubmit` and `agentChatPreviousTurnText`; the toolkit chat reports each visible send through them.
- 205f078: Open apps connected from another workspace beside the chat, the same way first-party hosted apps open.
- 6454dfb: Keep requests about the current app's data in context when choosing a workspace app, including when a saved pointer matches another app.
- 563035a: A Dispatch app action that the app refuses before running (invalid parameters, an action the app doesn't have, a call that was never sent) now reports that nothing was changed, instead of "write outcome may be unknown". One mistyped call no longer stops the rest of the turn's app actions, reads included, in every app.
- 1faef32: Dispatch now shows the app beside the chat when the agent works in it. An app opened beside a chat is visible instead of sitting in a hidden panel, the panel keeps its width when the width utility is missing, an open requested before a new chat has an id is kept until it has one, and delegating to an app's agent opens that app. The agent is told to open the screen for show and open requests and to send follow-ups on an open app to that app's own agent.
- 7279520: Expose enabled direct app action tools in the Dispatch MCP connector catalog.
- 032c910: A saved Dream memory proposal is now marked applied and audited even when copying it to the shared memory directory falls behind; the delay is reported afterwards.
- 505f39c: Include verified first-party MCP claims when minting document embed sessions for canonical and SSO-registered workspace targets.
- baf0f51: `open_app` takes an `intent` in the user's words and picks the app itself when `app` is not given. An explicit `app` still wins, and a request that routes to no app returns a clear error instead of opening anything.
- 4163448: Require confident chat-first routing and disambiguate workspace apps by installation identity.
- b2299d0: Dispatch now prefers the workspace app that owns a domain over a connected third-party tool for the same domain, sends requests to create or draft something to the owning app's agent so the item opens beside the chat as an unsaved draft, and opens its own screens with navigate before summarizing them.
- b2299d0: An app opened beside a Dispatch chat now fills the side panel. The app's own chat rail is only added when the app takes the main area; beside the chat it took the whole panel and left the app frame 0 pixels wide.
- bac2e7e: Allow new Slack channel scopes to retry after temporary sender or conversation lookup failures without changing existing scope policies.
- f7bcd0f: Prevent a late thread snapshot save or stale thread URL sync from navigating back to `/chat/<threadId>` after the user or agent has already navigated away from `/chat` (for example to `/apps`).
- Release all public npm packages with a patch version bump.
- 862e5bf: Starting or continuing a coding run on a paired computer asks for approval each time.
- 1a0a9db: Every action core shares with all apps now decides its MCP exposure. Review comments, suggestions, version history, sharing reads, Creative Context, user groups, `upload-image`, `manage-automations`, `navigate` (in Dispatch too) and `view-screen` are served to outside agents with `mcpTool: "search"`: `tool-search` finds them and `call-tool` runs them, but they stay out of `tools/list`. Credential, account-connection, workspace-settings, staged-dataset, personal-preference and admin-review actions are `mcpTool: false`, and so is Dispatch's `view-screen`, which summarizes its run-debugging, vault and audit screens. It and the `view-screen`s of Calendar, Clips, Content and Forms now declare `readOnly: true`. Deleting someone else's review comment, deciding a suggestion or proposal, restoring a version, unsharing, Creative Context imports, purges, memberships and governance, archiving a context pack, and user-group writes now ask outside agents (MCP, HTTP, CLI, A2A and automation calls) for approval through `isOutsideAgentCall`, which `@agent-native/core/action` now re-exports. The app's UI and its own agent don't ask, though the agent calls those actions directly rather than from sandbox code or parallel batches. An action marked `"search"` stays listed where an app's `mcp.connectorCatalog` or `mcpApp.compactCatalog` already lists it.
- d799e8b: Add shared preview and interaction checks for generated workspace apps and extensions, and improve workspace app creation guidance.
- Updated dependencies [bfea22b]
- Updated dependencies [bf07e40]
- Updated dependencies [062955d]
- Updated dependencies [05d86d4]
- Updated dependencies [ac21d0b]
- Updated dependencies [5be6e23]
- Updated dependencies [830feff]
- Updated dependencies [b578994]
- Updated dependencies [ac21d0b]
- Updated dependencies [6facea0]
- Updated dependencies [234a3ba]
- Updated dependencies [ac21d0b]
- Updated dependencies [fbab2ca]
- Updated dependencies [ac21d0b]
- Updated dependencies [7e639f5]
- Updated dependencies [6d231e9]
- Updated dependencies [d4e0116]
- Updated dependencies [226913b]
- Updated dependencies [4163448]
- Updated dependencies [1faef32]
- Updated dependencies [f7bcd0f]
- Updated dependencies [0eeea8c]
- Updated dependencies [e0eaf3f]
- Updated dependencies [75c90a5]
- Updated dependencies [c8d851d]
- Updated dependencies [ac21d0b]
- Updated dependencies [ac21d0b]
- Updated dependencies
- Updated dependencies [554a6aa]
- Updated dependencies [798b8b1]
- Updated dependencies [75c90a5]
- Updated dependencies [ca69494]
- Updated dependencies [2308970]
- Updated dependencies [56ca9e7]
- Updated dependencies [8815d89]
- Updated dependencies [786235c]
- Updated dependencies [caec4be]
- Updated dependencies [b879e94]
- Updated dependencies [626773e]
- Updated dependencies [e675278]
- Updated dependencies [bc7c1b3]
- Updated dependencies [4b67d85]
- Updated dependencies [862e5bf]
- Updated dependencies [6938e7c]
- Updated dependencies [eb5c241]
- Updated dependencies [66de1ad]
- Updated dependencies [99491ba]
- Updated dependencies [e01adee]
- Updated dependencies [ac21d0b]
- Updated dependencies [88dad0f]
- Updated dependencies [3ed4a65]
- Updated dependencies [5f3dacf]
- Updated dependencies [d7de14c]
- Updated dependencies [a911ca6]
- Updated dependencies [bb6eb2c]
  - @agent-native/toolkit@0.232.0
  - @agent-native/agentkit@0.232.0

## 0.42.10

### Patch Changes

- 2755d62: Add `billing.commercialSurfaces` to `agent-native.json` (env `AGENT_NATIVE_CONFIG_BILLING_COMMERCIAL_SURFACES`). It defaults to `"show"`, which changes nothing. `"hide"` removes credit units and amounts, plan upgrades, free-credit offers and referral rewards: usage reads as dollars and tokens (a run reports its provider cost and no credits), existing credit alerts can't be listed, changed or delivered and new ones can't be created, stored credit-alert notices drop out of the inbox, the credit notice, credit-limit email and run-details credits row are left out, a credits-limit error offers only Retry in the card and the transcript, the referral action returns nothing, and the Builder connect popover, model picker and first-run setup drop the free-credit pitch. A composer host sets the Builder choice's caption with the `builder.creditsOffered` adapter. `commercialSurfacesHidden()` (from `@agent-native/core/client/app-config`) and `deploymentUsageBilling()` let an app follow the same setting, and `AgentKitRoot` takes `showRunCredits`. With `notifications.usageLimitNotices: false`, usage-limit alerts are no longer evaluated or sent on any channel.
- 50f7168: Dispatch can now run a granted workspace app's actions directly. Set `dispatch.directAppActions` (env `DISPATCH_DIRECT_APP_ACTIONS=true`) to add `list_app_actions`, `call_app_action`, and `read_view` to Dispatch's agent and MCP tools; they call the target app as the signed-in user, only for apps that user has granted, and return in about a second instead of running the app's agent through `ask_app`. The setting is off by default, and with it off Dispatch's tools and `ask_app` are unchanged.

  Dispatch app discovery now honors the workspace's `deployment.workspace.appsDirectory` and `appInclude` settings, and shows the `icon` set for an app in the deployment manifest or in `.agent-native/workspace-apps.json`. Apps listed without a description no longer break MCP task discovery.

  `setDispatchAppActionHeaderProvider` (from `@agent-native/dispatch/server`) lets a deployment add headers to each direct app action connection, such as a per-turn grant the target app's MCP turn grant admitter recognizes. It can't replace `Authorization`.

  A full MCP catalog (`catalog_scope: "full"`) now honors `externalAgents.writes: "ask_app_only"`: only reads and the compact builtins stay directly callable, and writes still go through `ask_app`. `mcpToolCallWasNotSent` (from `@agent-native/core/mcp-client`) tells a refusal `callTool` raised before sending apart from a failure after the call may have run.

- Release all public npm packages with a patch version bump.
- Updated dependencies [9f49abc]
- Updated dependencies [2755d62]
- Updated dependencies [d863c6a]
- Updated dependencies [3d92e2e]
- Updated dependencies
  - @agent-native/toolkit@0.231.0

## 0.42.9

### Patch Changes

- 3fc2440: Add the MCP-only `route-app-intent` action, which picks the granted app that should be on screen for a chat request using Decisions. `open_app` now waits at most 15s for a target's embed session and stops the target request when it gives up.
- Release all public npm packages with a patch version bump.
- 2f65a06: MCP Apps outside a directory listing now open embed tools as the full app in the host's side panel: the server keeps the session an action minted, or mints a full-app session for the page the result links to, instead of falling back to a plain link. Directory listings still mount only scoped widgets.

  A full-app panel acts as its verified owner, as a signed-in browser does: it runs actions, including UI-only ones, through the app's own UI, in deployed workers as on the server. Its session token in the request header is that proof, since the panel runs on the host's origin and cannot keep the UI capability cookie a signed-in browser uses; a session carried only by cookie still needs a same-origin request. It cannot reach MCP or A2A approvals, sign-in and account changes, connections, OAuth starts, stored secrets and provider keys, developer routes, the app's own agent chat or automations, which it can read but not change, the public `/mcp` endpoint, the embed start route, an app's own `auth` routes, or any OAuth start, callback, connect or disconnect route, on GET too; it can read but not write app routes that store credentials by name, such as a template's `PUT /api/pylon/key`. Those still need a browser login. Actions declare the same with `requiresSignedInBrowser: true`, which the framework sets on its credential, member, service-token and key-policy actions and Dispatch sets on its vault, grant, app-access and linked-identity actions and on creating a browser chat session. A panel's signed token refuses those actions even after it expires or is revoked.

  A panel opened by `create_embed_session`, by an app's own `open_app`, or by Dispatch for its own pages gets that full-app session unless the caller asks for `chrome: "minimal"`, which stays a read-only view. Before, those panels got a read-only session, so the app's approval-gated actions, such as moving an issue to trash, failed from inside the panel.

  Dispatch's `open_app` asks the target app for an embed session whenever an MCP host calls it, so the full app opens in the host's side panel without the caller passing `embed: true`, and passes an explicit `embed: false` on so no panel opens.

  An action that returns another app's embed start URL, such as `open_app`, declares `opensAnotherAppEmbed: true` so the MCP server keeps that URL, whether the app runs on its own origin or under another mount on this one. Other actions keep only a session this app minted for the caller.

  When `open_app` cannot get a session from the target app, its result says why in `embedUnavailable` instead of looking like a plain link, and it waits at most 15 seconds for the target before answering with the link, stopping the target request when it gives up.

  In a workspace that shares one sign-in across apps, a page open in an MCP host's side panel reads its session under its own app mount, which the panel session covers, instead of the shared origin route, so the panel no longer reports that it couldn't reach the server.

  `read_view` reports load errors and failed requests from the app open beside the chat in `errors`, including whether a failed request carried the panel session (or a different one) and the server's reason for refusing it, so a blank or stuck panel says why instead of returning empty text.

  Hashed build assets are served with `Access-Control-Allow-Origin: *`, so an app opened in an MCP host's side panel can load its code from the host's sandbox instead of rendering blank.

  A full-app panel's reads that carry its session in the URL, as the app's own requests do, now count as the panel's own, so it can get the UI capability its approval-gated actions need. Only a session cookie still needs same-origin proof.

  `open_app` given only an app id opens that app's home page instead of refusing the call for a missing view or path.

  An app open in an MCP host's panel no longer sends its first-touch attribution to the server, which refused that cookieless request and reported it as a failed request in `read_view`.

- 428b8b9: Relay authenticated cross-origin workspace frame chat submits into the active Dispatch chat.
- Updated dependencies [f6464e1]
- Updated dependencies [816c571]
- Updated dependencies [3fc2440]
- Updated dependencies [dce0894]
- Updated dependencies [dce0894]
- Updated dependencies [dce0894]
- Updated dependencies [0794eec]
- Updated dependencies [817593c]
- Updated dependencies [675f590]
- Updated dependencies [6c6a245]
- Updated dependencies [01e4cc6]
- Updated dependencies
- Updated dependencies [8360101]
- Updated dependencies [f53f27f]
- Updated dependencies [d8c2381]
- Updated dependencies [2e1e77e]
- Updated dependencies [428b8b9]
- Updated dependencies [5c2d0ab]
  - @agent-native/toolkit@0.230.0

## 0.42.8

### Patch Changes

- c28f853: A fresh Dispatch install no longer creates the retired, unused `vault_secrets` table. Databases that already have it keep it untouched, and the Vault keeps its keys in `app_secrets`.
- d9515da: Scope app creation settings writes to their owner.
- f152dfe: The MCP gateway and workspace app chat proxy forward app context and errors more reliably, and workspace app routes and cards handle mounted app paths.
- Release all public npm packages with a patch version bump.
- Updated dependencies [a4a4f9e]
- Updated dependencies [988cdee]
- Updated dependencies [dfe5aa0]
- Updated dependencies [f152dfe]
- Updated dependencies [fceb6b5]
- Updated dependencies [425c9ac]
- Updated dependencies
- Updated dependencies [9af0433]
- Updated dependencies [79bc394]
- Updated dependencies [e79c1ae]
- Updated dependencies [a6ccc79]
- Updated dependencies [cf9ff10]
  - @agent-native/toolkit@0.229.0

## 0.42.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- 77f6fe8: The Dispatch Vault now stores its keys only in `app_secrets` and no longer reads or writes `vault_secrets`. `app_secrets` gains nullable `label`, `provider` and `created_by` columns, and a key's id is its `app_secrets` row id. The Vault page lists the organization's keys (or your own solo workspace's), a key created or edited in the Vault is marked with `created_by`, and a rename moves the stored ciphertext with the row. `vault_grants` gains a nullable `credential_key`, which core's manual-mode check now reads instead of joining `vault_secrets`; grants from before this release grant nothing until `credential_key` is backfilled. The table stays in existing databases, untouched, until it is dropped. The new `guard:no-vault-secrets-table` fails when source reads or writes it.
- Updated dependencies
- Updated dependencies [75f2dbb]
  - @agent-native/toolkit@0.228.2

## 0.42.6

### Patch Changes

- 33a7fca: Fix the app chat rail on `/dispatch/apps/<appId>` for mounted workspace apps. Dispatch now always declares inline MCP App support when it asks an app for an embed session, so apps no longer hide `create_embed_session` from it. When an app's chat still can't connect, its chat button now focuses the rail's Retry button instead of doing nothing.
- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.228.1

## 0.42.5

### Patch Changes

- Release all public npm packages with a patch version bump.
- ef8ad16: Dispatch no longer keeps a plaintext copy of vault keys. A saved key is written only as the encrypted `app_secrets` row and `vault_secrets.value` stays empty; the masked preview is read from the encrypted copy. The `sync-vault-to-app` action and the "Sync" buttons are removed, since apps read vault keys from the credential store. `vault_secrets` is now refused by the agent SQL tools and extension SQL, and the new `guard:no-unsealed-secret-columns` flags a new secret-named column that is not marked sealed.
- Updated dependencies [ade88da]
- Updated dependencies [8656de2]
- Updated dependencies [c8c081c]
- Updated dependencies [da0d6d2]
- Updated dependencies [353cb43]
- Updated dependencies [40362af]
- Updated dependencies [8656de2]
- Updated dependencies [8175f2d]
- Updated dependencies [54b3cc3]
- Updated dependencies
- Updated dependencies [8930066]
- Updated dependencies [bea9322]
- Updated dependencies [b6222c2]
- Updated dependencies [78738f3]
- Updated dependencies [bdefc2e]
  - @agent-native/toolkit@0.228.0

## 0.42.4

### Patch Changes

- Release all public npm packages with a patch version bump.
- ec21102: Failed resource uploads, resource saves, and community app installs now use the shared write-failure toast, so the notice says why the save failed, such as being offline or lacking permission.
- 36106a3: Show a saved integration access token as connected on its Settings page, refresh composer integrations when a key is saved, and register Dispatch's provider API runtime so its connected integrations appear. Composers can now claim a paste as app context (`onPasteContext`). A checkbox set to `"indeterminate"` now shows a filled dash instead of a check mark. When the saved token cannot be read, the integration page says so and offers Try again instead of showing no action.
- a467c58: Show one shared toast when a save fails instead of failing silently. `useActionMutation` now announces a failed write that nothing else handles (`errorNotification: "auto" | "shared" | "caller"`, plus an `errorLabel` title), `@agent-native/core/client/write-failure` adds `reportWriteFailure` for writes that are not mutations, and `AppProviders` mounts the toast. A typed 4xx refusal shows its own message, offline, timeout and permission failures show translated text, and a 5xx stays generic. Background saves and mutations that render their own error opt out with `errorNotification: "caller"`.
- 0f27dbe: Give a hosted workspace app its own session and its own route in the pane. A same-origin app now loads its own path instead of an embed session that could only read its document, and a deep app URL opens that route rather than the app home.
- Updated dependencies [ba1a7d3]
- Updated dependencies [48d9de3]
- Updated dependencies [d1fa5c5]
- Updated dependencies [6e8b91a]
- Updated dependencies [cd176a0]
- Updated dependencies [0f27dbe]
- Updated dependencies [17bf02d]
- Updated dependencies [4a3c8c7]
- Updated dependencies [7f5db5c]
- Updated dependencies [f94438c]
- Updated dependencies [46ed84c]
- Updated dependencies [3142f57]
- Updated dependencies
- Updated dependencies [ec21102]
- Updated dependencies [36106a3]
- Updated dependencies [ba1a7d3]
- Updated dependencies [36074ef]
- Updated dependencies [a467c58]
- Updated dependencies [d4f3450]
- Updated dependencies [6189d88]
- Updated dependencies [7c7bf12]
  - @agent-native/toolkit@0.227.0

## 0.42.3

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [5e251c0]
- Updated dependencies [5ee10e8]
- Updated dependencies [9aabcfb]
- Updated dependencies
  - @agent-native/toolkit@0.226.0

## 0.42.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- 930602e: Give a hosted workspace app its own session and its own route in the pane. A same-origin app now loads its own path instead of an embed session that could only read its document, and a deep app URL opens that route rather than the app home.
- Updated dependencies
  - @agent-native/toolkit@0.225.1

## 0.42.1

### Patch Changes

- 484471d: Show the Workspace apps rail for organizations that have no domain yet, such as a newly created Builder.io account, instead of a "Couldn't load data" error.
- Release all public npm packages with a patch version bump.
- Updated dependencies [9108a0b]
- Updated dependencies [59b8c47]
- Updated dependencies
- Updated dependencies [7557e39]
- Updated dependencies [aeb3d12]
- Updated dependencies [bce674a]
  - @agent-native/toolkit@0.225.0

## 0.42.0

### Minor Changes

- 6552f04: Let organizations hide Agent-Native.com hosted apps in Dispatch, group Dispatch's app pages into Pinned apps, Apps, and Agent-Native.com hosted apps, and keep the sidebar to pinned apps.
  - Organization owners and admins get a "Show Agent-Native.com hosted apps" switch under Settings › Organization › Apps, backed by the new `get-hosted-apps-settings` and `set-hosted-apps-settings` actions (recorded in Dispatch's audit log, on by default). When it is off, Agent-Native.com hosted apps leave Dispatch's app lists, `list_apps`, and the Dispatch agent's app context; `list-connected-agents` still returns them marked `hiddenFromLaunchers`, and `call-agent` by name still reaches them. An unreadable stored value hides Agent-Native.com hosted apps and Settings offers to repair it.
  - Core adds `registerAgentContextAgentFilter` and `discoverAgentContextAgents` so an app can narrow the peers its own agent is shown (`<available-apps>`, relevant apps, @-mention Connected Agents, `describe-workspace-apps`) without changing `discoverAgents` routing.
  - Home, New chat, and All apps show Pinned apps, Apps, and Agent-Native.com hosted apps sections. The sidebar shows pinned apps, or until something is pinned, three suggested apps, above an All apps link. Every app row has a visible pin button, and pins stay in sync across surfaces. The toolkit apps rail accepts optional `sections` and `onTogglePinned` (pin changes go to the host instead of a whole layout); without them it renders as before.

### Patch Changes

- e9a3946: Dispatch's home page checks which workspace apps you can open in a handful of database queries instead of about a dozen per app, so the app list no longer slows down as the workspace grows. Core gains `resolveAccessMany` to check many resources of one type at once, with the same results as `resolveAccess`.
- Release all public npm packages with a patch version bump.
- 4e36f27: Creating a workspace app now tells the framework when it starts the scaffold command or deletes a half-created app folder, so a failed create-app call that already touched disk stops the agent run instead of being retried as if nothing was saved.
- 559011e: Start pnpm through a shell on Windows, where it is a `pnpm.cmd` shim. `agent-native create` no longer says pnpm is missing when it is installed, `agent-native amplify-stream` can run its build, `agent-native deploy` can build a workspace's apps, and Dispatch can add an app to a workspace there.
- 7abe86d: New-workspace-app instructions now tell the agent to keep `configureClientRouterBasename()` in `app/entry.client.tsx`, matching the shipped templates.
- Updated dependencies [6552f04]
- Updated dependencies [aa0b323]
- Updated dependencies
- Updated dependencies [810b9e0]
- Updated dependencies [7abe86d]
  - @agent-native/toolkit@0.224.0

## 0.41.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [0d88792]
- Updated dependencies [10735e3]
- Updated dependencies [70c5c8f]
- Updated dependencies
- Updated dependencies [110efd1]
  - @agent-native/toolkit@0.223.1

## 0.41.0

### Minor Changes

- 5761203: Builder Workspaces support. When `BUILDER_WORKSPACE_PROJECT_ID` is set, the workspace's apps are built in Builder: Dispatch's create-app surfaces (the create-app popover, `/new-app`, Build app, community install and template remix) link to the workspace in Builder, and app-creation actions return a `builder-managed` result with that link instead of creating anything. Core adds `getBuilderWorkspaceProjectId` / `getBuilderWorkspaceUrl`, an opt-in preview step (`WORKSPACE_PREVIEW_JOIN_ORG=1`, development + `AUTH_DISABLED` only) that adds the dev account to the workspace org, a `guard:workspace-app-scope` script in the workspace template, and Builder-compatible app id validation in `add-app`.

### Patch Changes

- 4fa3202: Add `runtime.apiBaseUrl` (`AGENT_NATIVE_CONFIG_RUNTIME_API_BASE_URL`, or `window.__AGENT_NATIVE_CONFIG__.apiBaseUrl`) so a UI served from another origin can reach the app's server. `agentNativePath()` and `appApiPath()` return URLs on that server, requests addressed to it carry credentials, relative URLs are never rewritten (a host page that embeds the app keeps its own `/api` calls), and framework and template client code now build every server URL with those helpers; and origins in `CORS_ALLOWED_ORIGINS` are matched with the same normalization for credentialed responses and are trusted by the sign-in origin check. Sign-in from such a UI happens on the server and returns to the UI page through `/_agent-native/auth/ui-return`, which redirects only to those allowlisted origins. Preflights from allowed origins now also admit any extra request headers they ask for, and cookie-writing POSTs such as consent accept an origin listed in `CORS_ALLOWED_ORIGINS`.
- eeef9e4: Dispatch opens on the chat home instead of the apps list, the home heading is one type step smaller with room above it, and the Connect AI card sits inside the composer edges.
- 828d50e: Show Builder users where to find their workspace when they visit standalone Dispatch.
- Release all public npm packages with a patch version bump.
- c57b733: Fix workspace sign-in session creation for canonical Agent-Native apps after MCP tool visibility hardening.
- a0356c6: Lower the default usage alert from $100 a day to $20 a month, and move defaults still at $100 a day to the new limit. `USAGE_ALERT_DEFAULT_MONTHLY_USD` replaces `USAGE_ALERT_DEFAULT_DAILY_USD`, which stays as a deprecated alias.
- Updated dependencies [3a2fa31]
- Updated dependencies [92d54bb]
- Updated dependencies [23cf2ea]
- Updated dependencies [92d54bb]
- Updated dependencies [92d54bb]
- Updated dependencies
- Updated dependencies [8cdee8a]
- Updated dependencies [033d9ad]
- Updated dependencies [7138000]
- Updated dependencies [3a2fa31]
- Updated dependencies [3a2fa31]
- Updated dependencies [2428fde]
- Updated dependencies [2428fde]
- Updated dependencies [eacd478]
- Updated dependencies [95841d4]
- Updated dependencies [92d54bb]
- Updated dependencies [f527363]
- Updated dependencies [3a2fa31]
- Updated dependencies [3a2fa31]
- Updated dependencies [3a2fa31]
- Updated dependencies [d795784]
- Updated dependencies [4699487]
  - @agent-native/toolkit@0.223.0

## 0.40.44

### Patch Changes

- Release all public npm packages with a patch version bump.
- 568b298: Add an owner-only Builder backup status inspection that reports bounded metadata without downloading branch files.
- Updated dependencies
- Updated dependencies [39cb8ce]
  - @agent-native/toolkit@0.222.2

## 0.40.43

### Patch Changes

- Release all public npm packages with a patch version bump.
- 25daf38: Expose bounded stage codes when Builder branch readback cannot be verified.
- Updated dependencies [86af196]
- Updated dependencies [c96a41d]
- Updated dependencies
  - @agent-native/toolkit@0.222.1

## 0.40.42

### Patch Changes

- 65cb1d5: Require Core 0.222.0 or newer for authenticated Builder branch readback.
- 1ccb574: Use mounted Workspace app paths for embedded agent chat sessions.
- Release all public npm packages with a patch version bump.
- 3901677: Verify Builder branch files through authenticated full-backup readback, revision and byte-integrity checks, and exact reviewed community-template hashes. Add an owner-only verification action without enabling community installs.
- Updated dependencies [ede5c57]
- Updated dependencies [7e08199]
- Updated dependencies [c038e00]
- Updated dependencies [51e8de9]
- Updated dependencies
- Updated dependencies [7e08199]
- Updated dependencies [f8c2ba6]
- Updated dependencies [78fa714]
- Updated dependencies [0bf6393]
- Updated dependencies [8adaead]
- Updated dependencies [a54e178]
  - @agent-native/toolkit@0.222.0

## 0.40.41

### Patch Changes

- 3e6443d: Use mounted app MCP endpoints when Dispatch shares the app host.
- 64b6332: Route Workspace app links through Dispatch's nested app route so child pages resolve on mounted deployments.
- 1fe5d77: Support member-scoped MCP identity delegation and preserve Workspace app deep links through flat route shells.
- e086032: Apps that Dispatch creates keep first-run onboarding off in development, like the first-party templates, so a local run opens straight into the app.
- e548712: Embed a workspace app by its own path when its registry `url` is this Dispatch's page for it. The embed request was rejected and the fallback framed Dispatch inside Dispatch, so apps with a home page of `/` rendered blank and apps with another home page returned 404.
- 0ab7e59: Chat history row menus in the Dispatch sidebar now use text-only menu items that join arrow-key navigation and typeahead, so Copy session ID and Watch session are reachable from the keyboard. Archiving a chat from that menu is no longer styled as a destructive action, since archived chats can be restored.
- Release all public npm packages with a patch version bump.
- 12a91c6: Show MCP approval reviews inside the app, in its own theme and components. When a signed-in reader opens a review link, an app that opts in now sends them to its home page, with the grant id in the URL fragment (`#mcpApproval=<id>`). The fragment survives the redirects that apps' home routes often make. `AppProviders` then shows the review in place of the app: who the call reaches, every argument, times in the reader's time zone, the client that asked and when it was connected, and a warning when the identical call already ran. It leads with who asks and for what ("Claude Code wants to create event"), and after a decision it keeps one line naming the request. Email addresses wrap only after their "@", never inside a name. Approve and Deny go through the same framework route and token as before, and a decision whose answer is lost is checked against the grant's state before the review says it wasn't saved. At a pending or approved review's deadline, the review asks the server for its state, timing the deadline on the server's clock, so a device clock that runs fast or slow doesn't end the review early or leave it showing "approved" late. The review is shown only in a top-level window, never under `sessionBypass`, on a public page or in another app's document. It sits outside the phone hand-off and first-run onboarding. Sign-in still happens at the link itself, so the link works after sign-in. An app whose shell renders `AppProviders` opts in with `createAgentChatPlugin({ mcp: { appApprovalPage: true } })`, or `appApprovalPage: true` on `mountMCP`; every bundled template and Dispatch do. Without it, a review link keeps the framework's plain page, which works in any app. In an app whose custom authentication has no `getBrowserSession` hook, the review says the app can't confirm the reader's sign-in instead of asking them to sign in, and the route's `401` carries `reason: "sign-in-unavailable"` to tell the two apart. The review's JSON now includes `locale` and `servedAt`, and `@agent-native/core/client/mcp-approval` exports the browser helpers that read and decide a review. On every approval surface (this page, the plain page and the in-client form), a field the summary already shows is left out of the field list but kept in the details: the call's one recipient argument when it holds only addresses (a call that names people under several, such as `to` and `bcc`, keeps each, so the reader sees who is copied how), and a time zone that a time in the summary already shows. A value the schema lists as a choice, including a boolean, reads in words (its `oneOf` or `anyOf` title, or else the enum value split into words, so `externalOnly` reads "External only", while a value that isn't an identifier, such as `America/New_York`, stays as written), and a time zone field reads by name ("Pacific Time"). A time whose zone shares the reader's offset but is another zone, such as London and Lagos in October, also shows the call's own time, naming its zone in full ("United Kingdom Time"), since that zone's own row is left out. `mountMCP` refuses `appApprovalPage` with a route prefix other than `/_agent-native`, the only one the app's review reads.
- f635856: Allow Dispatch to pair with the next Core prerelease series.
- a6e38cf: Preserve trusted request origins and mounted app paths when proxying embedded Workspace chat.
- 91ec685: A failed session lookup now answers a retryable 503 (`session_unavailable`) instead of the 401 a signed-out visitor gets, and is reported once with its real cause and the request id. The failed-request packet now carries the request id of the request it ran in. Dispatch's "Couldn't load data" card shows that id, and a workspace gateway read that fails now logs its cause, the gateway's own request id and elapsed time, and a gateway that does not answer in time reports `workspace_gateway_timeout` instead of `workspace_gateway_unavailable`.
- f635856: Preserve app-only visibility when Dispatch overrides the built-in embed helper so Workspace app sessions reach their iframe without exposing the one-time ticket to the model.
- 2e8f454: Compile with `noImplicitOverride` and `noFallthroughCasesInSwitch`, and, where the code already passes them, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Optional fields that legitimately hold `undefined` are now typed `T | undefined`. No runtime behavior changes.
- 62b1459: Fix embedded workspace app chats on path-mounted deployments.
- Updated dependencies [94dab1c]
- Updated dependencies [0ab7e59]
- Updated dependencies [f717042]
- Updated dependencies [0ab7e59]
- Updated dependencies [9a61c1d]
- Updated dependencies [0ab7e59]
- Updated dependencies [0ab7e59]
- Updated dependencies [99c97eb]
- Updated dependencies [0ab7e59]
- Updated dependencies [0ab7e59]
- Updated dependencies [9c559ff]
- Updated dependencies [9fd95b5]
- Updated dependencies [2938b17]
- Updated dependencies [0ab7e59]
- Updated dependencies [0c8b261]
- Updated dependencies [cc341a4]
- Updated dependencies [180ecbe]
- Updated dependencies [0ab7e59]
- Updated dependencies [723fac2]
- Updated dependencies [0ab7e59]
- Updated dependencies [c2a6e7e]
- Updated dependencies [656b02e]
- Updated dependencies [1cd201c]
- Updated dependencies [c2a6e7e]
- Updated dependencies [bdfea6d]
- Updated dependencies [4173583]
- Updated dependencies [4173583]
- Updated dependencies [369ceab]
- Updated dependencies [d569c61]
- Updated dependencies [e086032]
- Updated dependencies [ee67a21]
- Updated dependencies [ef8111a]
- Updated dependencies [0ab7e59]
- Updated dependencies
- Updated dependencies [7199312]
- Updated dependencies [12a91c6]
- Updated dependencies [8254996]
- Updated dependencies [0ab7e59]
- Updated dependencies [f20824d]
- Updated dependencies [ef46f92]
- Updated dependencies [b14bed7]
- Updated dependencies [f83c054]
- Updated dependencies [0ab7e59]
- Updated dependencies [a9c0fa9]
- Updated dependencies [eaa780a]
- Updated dependencies [d9cfcd4]
- Updated dependencies [82efd47]
- Updated dependencies [0ab7e59]
- Updated dependencies [2e8f454]
- Updated dependencies [90395b3]
- Updated dependencies [7ee0542]
  - @agent-native/toolkit@0.221.0

## 0.40.40

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [ddd3bd1]
- Updated dependencies [4ea7d64]
- Updated dependencies
- Updated dependencies [0c211bc]
- Updated dependencies [b73b8ef]
  - @agent-native/toolkit@0.220.0

## 0.40.39

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [838e1ae]
- Updated dependencies
- Updated dependencies [86429da]
- Updated dependencies [7b293b2]
  - @agent-native/toolkit@0.219.0

## 0.40.38

### Patch Changes

- de3f844: Sign Dispatch's own workspace apps gateway read as the signed-in member with the deployment secret, so the receiver keeps the member's identity. Signing it with the organization secret made the registry refuse it, and a Dispatch with no deployment manifest to fall back on showed "Couldn't load data" (`workspace_gateway_rejected`).
- Release all public npm packages with a patch version bump.
- 84e4b2e: Show owned and shared chats in separate Dispatch history sections with independent paging and owner and access details.
- Updated dependencies [84e4b2e]
- Updated dependencies
- Updated dependencies [84e4b2e]
- Updated dependencies [fc038a0]
  - @agent-native/toolkit@0.218.0

## 0.40.37

### Patch Changes

- b07c13b: `describe-workspace-apps` now shows each app's authored "when to use" guidance, so the agent sees the same text the ranking matched on. Workspace usage tools now say plainly that they have no customer data and point to the app's own customer or billing actions or the owning app, instead of leading with the owner/admin permission rule.
- Release all public npm packages with a patch version bump.
- Updated dependencies [6c3f3cb]
- Updated dependencies [4c43f86]
- Updated dependencies
- Updated dependencies [9e4119f]
  - @agent-native/toolkit@0.217.0

## 0.40.36

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [31a1f1e]
  - @agent-native/toolkit@0.216.0

## 0.40.35

### Patch Changes

- 32ecc17: Refresh the curated community QR file pin to match the tracked template.
- Release all public npm packages with a patch version bump.
- 985e9de: Refresh the curated QR template pin after the Core 0.214.0 release.
- 7d32864: Refresh the QR community app file pins during release versioning so they match the current template.
- 5f880cd: Keep the QR community app package pin aligned with its current manifest.
- 7ba1d99: Keep the curated QR app installer pinned to the current reviewed template manifest.
- 0aa618c: Fix workspace app embeds when the target returns its start URL through MCP metadata.
- 4b0bb1e: Usage metrics tools now say they only cover this organization's members and return a typed error pointing to the owning app when asked about an external customer's usage.
- Updated dependencies [f8f4b9e]
- Updated dependencies [0b58010]
- Updated dependencies
- Updated dependencies [4fd6b35]
- Updated dependencies [11a11d9]
- Updated dependencies [aa79d54]
  - @agent-native/toolkit@0.215.0

## 0.40.34

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [05d1481]
  - @agent-native/toolkit@0.214.0

## 0.40.33

### Patch Changes

- e9efe95: Keep the curated QR catalog pinned to the current template files.
- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.213.1

## 0.40.32

### Patch Changes

- Release all public npm packages with a patch version bump.
- b58658d: Allow organization owners to opt in to current-member A2A delegation with capped member permissions and durable audit provenance. Improve app discovery and Dispatch routing for connected analytics and customer credit questions.
- Updated dependencies
- Updated dependencies [b58658d]
  - @agent-native/toolkit@0.213.0

## 0.40.31

### Patch Changes

- Release all public npm packages with a patch version bump.
- b697ec4: Use organization-scoped secrets for workspace app registry authentication and show which Dispatch query failed.
- Updated dependencies
  - @agent-native/toolkit@0.212.1

## 0.40.30

### Patch Changes

- 96e2cf6: Discover and rank authorized workspace apps across the organization directory, and add Lab-gated installs from reviewed, pinned community app templates.
- Release all public npm packages with a patch version bump.
- Updated dependencies [71749d3]
- Updated dependencies [9d61445]
- Updated dependencies [96e2cf6]
- Updated dependencies
- Updated dependencies [ae5a212]
- Updated dependencies [71749d3]
- Updated dependencies [71749d3]
- Updated dependencies [9fcbe67]
- Updated dependencies [66ae94a]
  - @agent-native/toolkit@0.212.0

## 0.40.29

### Patch Changes

- f60152f: Require approval for `needsApproval` actions on every surface. HTTP action routes and generated Workers entries now run an approval-gated call only for the signed-in app UI (or its MCP directory widget); a bearer token, MCP OAuth token, org service token, A2A peer, or other HTTP caller gets `409 approval_required`, and an unproven browser call gets `403 ui_capability_required`. The app's client now presents its UI capability with every write from a signed-in session, so the 403 and one retry are only the fallback for an expired or rejected capability. `revoke-org-service-token` and the credential, membership, and app-access actions in core, Dispatch, and Scheduling now ask for approval on every call, with "always allow" off.
- Release all public npm packages with a patch version bump.
- Updated dependencies [4fdf78c]
- Updated dependencies [ab1a9e8]
- Updated dependencies [67514ae]
- Updated dependencies [b451cb2]
- Updated dependencies
  - @agent-native/toolkit@0.211.0

## 0.40.28

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.210.2

## 0.40.27

### Patch Changes

- Release all public npm packages with a patch version bump.
- d65df24: Bind hosted workspace registry tokens to mounted paths and use the configured path during receiver validation.
- Updated dependencies [de17c2f]
- Updated dependencies [3a73a99]
- Updated dependencies
  - @agent-native/toolkit@0.210.1

## 0.40.26

### Patch Changes

- Release all public npm packages with a patch version bump.
- 0cfbd4d: Include the MIT license text in the published package.
- Updated dependencies [6c7c90e]
- Updated dependencies [7028ea5]
- Updated dependencies [7ade653]
- Updated dependencies [4c34d33]
- Updated dependencies
- Updated dependencies [108b9d9]
- Updated dependencies [ca67d21]
- Updated dependencies [79545c9]
- Updated dependencies [ff3a8dd]
- Updated dependencies [0cfbd4d]
- Updated dependencies [ed34578]
- Updated dependencies [7337569]
- Updated dependencies [7028ea5]
- Updated dependencies [41e43db]
  - @agent-native/toolkit@0.210.0

## 0.40.25

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [ce4eca0]
- Updated dependencies
- Updated dependencies [95aa388]
- Updated dependencies [36fc751]
- Updated dependencies [f99e655]
- Updated dependencies [f99e655]
- Updated dependencies [95aa388]
  - @agent-native/toolkit@0.209.2

## 0.40.24

### Patch Changes

- 2743662: Use the shared app permission policy for organization owner and admin access to Dispatch administration. Dispatch now requires `@agent-native/core` 0.206.0 or later, the first release with that policy.
- Release all public npm packages with a patch version bump.
- 517fade: Say why a workspace app answers 503 "Workspace app access is temporarily unavailable". The 503 body now carries a `code` (and, when a Dispatch registry reply arrived, `upstreamStatus`, `audience`, and `detail`), and each cause is logged once per instance. A new `checkWorkspaceAppAccess` returns the cause; `isWorkspaceAppAccessAllowed` keeps its `true` / `false` / `"unavailable"` contract. Dispatch logs why it refused a registry token (server-side only; the 401 stays a fixed refusal), using the new `diagnoseA2ATokenFailure` from `@agent-native/core/a2a`.
- Updated dependencies [e90b90a]
- Updated dependencies [5b201d1]
- Updated dependencies [ce01559]
- Updated dependencies
- Updated dependencies [c139e35]
- Updated dependencies [c139e35]
- Updated dependencies [e5a64ae]
- Updated dependencies [e6e1f56]
- Updated dependencies [73da788]
  - @agent-native/toolkit@0.209.1

## 0.40.23

### Patch Changes

- Release all public npm packages with a patch version bump.
- 3ab5193: Drop the caller-supplied `size` from Builder upload attachments and measure it on the server, reject invalid attachments up front with an `invalid_attachment` error, and teach the turn-into-app browser-host guide to attach Project instructions and knowledge files verbatim, so a bad or missing attachment no longer reads as a temporary Builder outage or a silent drop.
- 3b9d3cd: Show how long each tool call took in Thread Debug.
- Updated dependencies [fadfb1b]
- Updated dependencies [7407dca]
- Updated dependencies [980bd9f]
- Updated dependencies [7407dca]
- Updated dependencies
- Updated dependencies [d6a3ea3]
  - @agent-native/toolkit@0.209.0

## 0.40.22

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [9cb95d8]
- Updated dependencies [afe2ee7]
- Updated dependencies
- Updated dependencies [4434457]
- Updated dependencies [0fb4de3]
- Updated dependencies [cde733c]
  - @agent-native/toolkit@0.208.0

## 0.40.21

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [77c15ee]
- Updated dependencies [e913bfb]
- Updated dependencies [1c4a192]
- Updated dependencies [4452c7f]
  - @agent-native/toolkit@0.207.1

## 0.40.20

### Patch Changes

- 5f419fe: Preserve Agent Teams parent context when opening runs from Dispatch navigation.
- Release all public npm packages with a patch version bump.
- Updated dependencies [3d09f9f]
- Updated dependencies [128f43e]
- Updated dependencies [dfcc0de]
- Updated dependencies [eae7aa3]
- Updated dependencies [43d0aa8]
- Updated dependencies [a9c8414]
- Updated dependencies [19cd58b]
- Updated dependencies [aa34418]
- Updated dependencies [18384b3]
- Updated dependencies [ccddd3a]
- Updated dependencies [2f52659]
- Updated dependencies [5debd13]
- Updated dependencies
- Updated dependencies [e818cf9]
- Updated dependencies [e818cf9]
- Updated dependencies [ecfe037]
- Updated dependencies [d7da131]
- Updated dependencies [d44b119]
- Updated dependencies [cdc66e3]
- Updated dependencies [f8930b5]
- Updated dependencies [d7da131]
- Updated dependencies [d4854b8]
- Updated dependencies [3451273]
- Updated dependencies [70bf54c]
  - @agent-native/toolkit@0.207.0

## 0.40.19

### Patch Changes

- 0889356: Redirect the deprecated Dispatch integrations route into Settings and preserve mounted OAuth return paths.
- a19c641: Send the Dispatch origin to embedded workspace apps so their chat controls can open the host sidebar.
- df48a4e: Bind cross-app embed-session tokens to the active organization ID while preserving the authenticated user identity.
- Release all public npm packages with a patch version bump.
- Updated dependencies [e88f35c]
- Updated dependencies [80e66f8]
- Updated dependencies [58b7507]
- Updated dependencies [58b7507]
- Updated dependencies [0889356]
- Updated dependencies [3f0fe0f]
- Updated dependencies [e174642]
- Updated dependencies [d6f1e18]
- Updated dependencies
- Updated dependencies [792ba44]
- Updated dependencies [8f0ffa5]
- Updated dependencies [d6f1e18]
- Updated dependencies [d6f1e18]
- Updated dependencies [be0d784]
- Updated dependencies [68deb1e]
- Updated dependencies [af7acb9]
- Updated dependencies [217260d]
- Updated dependencies [6e9fccf]
  - @agent-native/toolkit@0.206.0

## 0.40.18

### Patch Changes

- 1b1d976: Distinguish confirmed automation work, explicitly declared no-op skips, and undelivered failures in run history and automation status. Preserve failure causes and recovery codes without pausing legitimate no-op runs.
- Release all public npm packages with a patch version bump.
- 401bc5e: Require an organization on the request before creating or materializing a workspace app record, so `workspace_apps` rows are no longer inserted with a null `org_id`. Orgless listing stays read-only, and existing null-org rows are left untouched.
- 5a3890a: Thread Debug search now matches an exact thread ID, the ID of the app object a thread was opened on (a deck, design, clip, document, and so on), or the thread's source URL, so pasting any of those pulls up the matching threads and their runs.
- 06bda81: Removed Sentry auth token from sync script
- Updated dependencies [b7e32e4]
- Updated dependencies [ab41d2b]
- Updated dependencies [de66ff4]
- Updated dependencies [947f911]
- Updated dependencies [4fe4088]
- Updated dependencies [cbc151c]
- Updated dependencies [3dc0aeb]
- Updated dependencies [9236359]
- Updated dependencies [1b1d976]
- Updated dependencies
- Updated dependencies [f325447]
- Updated dependencies [cc79bd1]
- Updated dependencies [8418b84]
- Updated dependencies [004f2a9]
- Updated dependencies [701c672]
- Updated dependencies [ae5aed6]
  - @agent-native/toolkit@0.205.0

## 0.40.17

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [c8bbbd4]
- Updated dependencies [4ba5ea5]
- Updated dependencies
- Updated dependencies [4c1d77f]
  - @agent-native/toolkit@0.204.0

## 0.40.16

### Patch Changes

- Release all public npm packages with a patch version bump.
- 69d237c: Thread Debug lets owners and admins of the observability super organization (`AGENT_NATIVE_OBSERVABILITY_SUPER_ORG_ID`) inspect threads from every user and organization, including cross-app sources whose users are not in the Dispatch organization.
- Updated dependencies [b717c70]
- Updated dependencies
- Updated dependencies [2842af8]
  - @agent-native/toolkit@0.203.1

## 0.40.15

### Patch Changes

- 6b0f888: Show per-run provider or Builder credit costs in chat, and keep historical usage without billing metadata unclassified across usage dashboards.
- Release all public npm packages with a patch version bump.
- 2b08ee1: Remove background fills from the Dispatch app card grid.
- Updated dependencies [8944abb]
- Updated dependencies [6b0f888]
- Updated dependencies [d317d31]
- Updated dependencies
- Updated dependencies [6f748b3]
- Updated dependencies [de755c7]
  - @agent-native/toolkit@0.203.0

## 0.40.14

### Patch Changes

- Release all public npm packages with a patch version bump.
- b52ed3a: Bind cross-app MCP tokens to their endpoint, preserve verified user identity before organization fallback, and deduplicate organization-principal A2A submissions.
- 42355e4: Dispatch shows configured first-party apps in its launchers by default.
- c8fa837: Render hosted sign-in pages on the server, blur the signup form panel backdrop, and use the shared Calendar wave across signup pages and the homepage hero.
- dbe2b81: Fix the thread debug inspector: folded run ids no longer appear as duplicate standalone rows, a deep-linked run outside the most recent window is fetched explicitly instead of silently showing the latest run, and thread-scoped traces (no run id) are now visible in the Thread tab.
- Updated dependencies [b22060c]
- Updated dependencies [a983e22]
- Updated dependencies [123cf36]
- Updated dependencies [a652cbc]
- Updated dependencies [ef0662e]
- Updated dependencies [ae80a65]
- Updated dependencies [a9879f8]
- Updated dependencies
- Updated dependencies [edc7f35]
- Updated dependencies [053539c]
- Updated dependencies [c8fa837]
- Updated dependencies [84e173d]
- Updated dependencies [fa322d4]
- Updated dependencies [dfff955]
  - @agent-native/toolkit@0.202.0

## 0.40.13

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [88908c5]
- Updated dependencies [cc3c820]
- Updated dependencies [a78f2a0]
- Updated dependencies [bdb9e68]
- Updated dependencies [bb72f96]
- Updated dependencies
- Updated dependencies [5d05eb6]
- Updated dependencies [cbfea3c]
- Updated dependencies [b88b078]
  - @agent-native/toolkit@0.201.1

## 0.40.12

### Patch Changes

- 43694e6: Use Builder.io wording and one-click account activation across setup, recovery, voice, files, design, and Code Agents.
- d63fd6c: Show a deployment's own apps when the workspace registry refuses the signed-in user (HTTP 403) instead of an error card; an HTTP 401 from the registry still fails loudly.
- Release all public npm packages with a patch version bump.
- 2e9fa5f: Owners and admins now run on their organization's credentials (Builder.io connection, model provider keys, and other keys) ahead of their own, which stay as the fallback; members keep their own first. Key saves default to the organization for owners and admins and ask who can use the key. When the role can't be read, every key form, Email included, says so with a retry instead of saving.
- 2e9fa5f: Exclude test identities from metrics and non-auth email on every deployment through one rule, `isTestIdentity` (reserved `.test`/`.invalid`/`.localhost`/`.example` domains, the `+autoz` QA marker, and `AGENT_NATIVE_TEST_IDENTITY_EMAILS`). `sendEmail()` now returns `{ status: "sent" | "suppressed" }`; auth mail passes `authCritical: true` and still reaches test identities. Test identities are dropped from `to`, `cc`, and `bcc` alike (each logged), a real `cc` recipient stands in for a test-identity `to` (a `bcc` recipient never does), and a send left with no `to` or `cc` recipient is suppressed; `sendEmail()` now also delivers `bcc`. The `/_agent-native/auth/session` response now carries a server-resolved `testIdentity` boolean, so browser analytics, session replay, and exception capture skip configured identities too without the configured list reaching the browser.
- Updated dependencies [2e9fa5f]
- Updated dependencies [1bbb9fa]
- Updated dependencies [43694e6]
- Updated dependencies [7c73c56]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies
- Updated dependencies [2e9fa5f]
- Updated dependencies [c46307b]
- Updated dependencies [81a5946]
  - @agent-native/toolkit@0.201.0

## 0.40.11

### Patch Changes

- b5a3453: Bundle Dispatch view-screen's built-in action dispatch with static action imports so production builds can resolve Dreams and connected-agent actions.
- Release all public npm packages with a patch version bump.
- ab62f9c: Fix packaged Dispatch catch-all routes crashing during server-side rendering.
- 9d8b0b6: Replace workspace catch-all loading UI with a layout-matched skeleton.
- Updated dependencies [4aa4088]
- Updated dependencies [bf2b2ae]
- Updated dependencies [73c2373]
- Updated dependencies [563e22a]
- Updated dependencies [73c2373]
- Updated dependencies [53f0c01]
- Updated dependencies [0c17540]
- Updated dependencies
- Updated dependencies [5113a23]
- Updated dependencies [9a09590]
- Updated dependencies [73c2373]
- Updated dependencies [73c2373]
- Updated dependencies [73c2373]
- Updated dependencies [73c2373]
- Updated dependencies [4bee69d]
- Updated dependencies [7ec9079]
- Updated dependencies [73c2373]
  - @agent-native/toolkit@0.200.0

## 0.40.10

### Patch Changes

- ebface7: Harden the boundaries behind the most-reported breakage. A closed chat stream now asks the server for the run's real state before the UI shows an outcome, and a user message sent during an active run waits instead of erroring. Sign-in state is one shared fact with one navigator, so reloads no longer flash to sign-in. Credential state is one typed value, so the credits banner and chat errors agree and activation can no longer replace an organization's Builder connection. Attachments resolve through one typed reference. Background automations record their real failure cause and pause after repeated identical failures instead of re-failing every tick. Error capture classifies and aggregates floods, groups one error into one issue, and filters third-party noise at one boundary. Tool-call errors keep a redacted reason, and human-in-the-loop pauses are no longer counted as errors. Expected action failures are typed 4xx responses, action hooks back off and stop on terminal errors, and a guard rejects new bare `throw new Error(...)` in actions. The shared command menu opens from the focused agent composer.
- Release all public npm packages with a patch version bump.
- Updated dependencies [452757b]
- Updated dependencies [6f27cff]
- Updated dependencies [a1e74f5]
- Updated dependencies [a80ad13]
- Updated dependencies [a1e74f5]
- Updated dependencies [ebface7]
- Updated dependencies
- Updated dependencies [5b643b7]
- Updated dependencies [c13429a]
  - @agent-native/toolkit@0.199.0

## 0.40.9

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [4e85ccd]
- Updated dependencies
  - @agent-native/toolkit@0.198.8

## 0.40.8

### Patch Changes

- 1f2c8d5: Scope workspace dependency checks to Core apps, resolve Dispatch admin email settings through typed app config, and require Core 0.198.6 or newer for Dispatch.
- Release all public npm packages with a patch version bump.
- 8866527: Provide tooltip context throughout the Dispatch layout.
- 52d8c49: Use the browser-safe integration catalog in Dispatch messaging settings so production builds don't pull server plugins into the client bundle.
- Updated dependencies [48586af]
- Updated dependencies
- Updated dependencies [b147194]
- Updated dependencies [3ba09b7]
  - @agent-native/toolkit@0.198.7

## 0.40.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- 4dfe557: Keep homepage submissions in the active full-page chat and hide unavailable request ID actions.
- Updated dependencies [0670eb1]
- Updated dependencies [77540af]
- Updated dependencies [df12726]
- Updated dependencies
- Updated dependencies [4dfe557]
  - @agent-native/toolkit@0.198.6

## 0.40.6

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.198.5

## 0.40.5

### Patch Changes

- 85a87e6: Split ChatFirst navigation from its pane bundle, preserve queued chat intent through provider preparation, and keep client-only SSR stubs constructible.
- cefc33b: Align full-page chat headers to the pane edges and remove the extra gap below them.
- Release all public npm packages with a patch version bump.
- df67544: Store uploaded icons in private blobs with scoped metadata and verified image reads.
- Updated dependencies [85a87e6]
- Updated dependencies [cefc33b]
- Updated dependencies [7a25922]
- Updated dependencies [df67544]
- Updated dependencies [2fdd284]
- Updated dependencies [c82ae28]
- Updated dependencies
- Updated dependencies [c650ba5]
- Updated dependencies [9fa81ab]
- Updated dependencies [20d3bb8]
  - @agent-native/toolkit@0.198.4

## 0.40.4

### Patch Changes

- 036c2c7: Tighten test-only assertions for the dev auth secret and the Dispatch auth plugin so they fail when the behavior they name breaks. No runtime change.
- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [ce1245c]
- Updated dependencies [e6de282]
- Updated dependencies [d2b14cf]
  - @agent-native/toolkit@0.198.3

## 0.40.3

### Patch Changes

- 181ca1d: Keep the package changelog in Dispatch's route wrapper so generated workspaces can render the shared Settings page during SSR.
- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [63c4c02]
  - @agent-native/toolkit@0.198.2

## 0.40.2

### Patch Changes

- d09fdb0: Keep full-page chat headers and history controls aligned with the conversation surface.
- Release all public npm packages with a patch version bump.
- Updated dependencies [0b127e9]
- Updated dependencies [4873d09]
- Updated dependencies [d09fdb0]
- Updated dependencies
- Updated dependencies [d25ddc1]
- Updated dependencies [affa25c]
- Updated dependencies [b1bbe7e]
- Updated dependencies [905b078]
- Updated dependencies [6a627af]
  - @agent-native/toolkit@0.198.1

## 0.40.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- fb3eacd: Show only apps mounted in the active workspace in Dispatch app views.
- Updated dependencies [20cd76f]
- Updated dependencies [bbe8cbf]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies
- Updated dependencies [8853f61]
- Updated dependencies [afbee14]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies [b6ffae6]
- Updated dependencies [8853f61]
  - @agent-native/toolkit@0.198.0

## 0.40.0

### Minor Changes

- 8fd97ec: Let workspaces choose which hosted first-party apps they offer with `agent-native.builtinAgents` (`mode: "all" | "none" | "selected"`, `include`) in the root or standalone `package.json`. Dispatch's app list now follows that config instead of always adding the chat-first defaults, and local workspaces outside the framework repo link built-ins to their hosted URLs.
- 1fd5c7a: Restore the searchable Dispatch app directory and localize its action labels.

### Patch Changes

- b8845eb: Bound framework list reads and remove the vault-wide resync from process startup.
- 9e87b45: Align settings content widths and controls with the shared settings layout.
- 29d7dfa: Include CHANGELOG.md in the published package so the Settings route no longer fails to load with an Internal Server Error.
- Release all public npm packages with a patch version bump.
- bee46b1: Dispatch always renders the redesigned Settings, with no feature flag.
- b8845eb: Scope ownable reads and writes to their authorized user, organization, or share.
- Updated dependencies [f2e8ffe]
- Updated dependencies [023ee9b]
- Updated dependencies [47985fe]
- Updated dependencies
- Updated dependencies [fa62fdf]
  - @agent-native/toolkit@0.23.1

## 0.39.0

### Minor Changes

- 108074a: Standardize full-page AgentKit chat homes and restore the Dispatch workspace app launcher.

### Patch Changes

- 08fec9a: Allow Desktop workspace sign-in to mint shared app sessions when Dispatch pane SSO is off.
- Release all public npm packages with a patch version bump.
- a20f0b4: Fix member offboarding and email-change rekey on migrated app databases. Apps declare their own identity columns with `registerIdentityColumns()` from `@agent-native/core/org`, share tables made by `createSharesTable()` are recognized by shape, Better Auth sessions keyed by `user_id` are revoked, and org member routes log the underlying failure instead of discarding it.
- a20f0b4: Usage estimates read the organization's default model instead of the old deployment-wide `agent-engine` row.
- a20f0b4: Add the {App} › Channels page to the redesigned Settings (behind the `settings-redesign` flag): Slack, Google Docs, Telegram, WhatsApp, Discord, Microsoft Teams, and Email, each with its state, a page with the adapter's own required variables, the webhook URL to copy, and setup that only owners and admins can run. Owners and admins save, replace, and remove a channel's credentials there in any app, stored as the organization's workspace secrets, so a template no longer has to declare channel keys. New core actions `list-messaging-channels` and `manage-messaging-channel` (`save-credentials`, `enable`, `disable`, `remove-credentials`, `register-webhook`) back the page, so the agent can set up and switch channels too; the `/integrations/:platform/enable|disable|setup` routes share the same operations. `EnvKeyConfig` gains `deploymentOnly` for keys the runtime reads only from the environment, which Google Docs' service account key sets. Google Docs joins the channel catalog. Apps can add their own settings to a channel's page with `registerChannelSettingsExtensions`, and Clips shows its Slack link previews there. The old Integrations panel now lists the variables each adapter reports instead of a hardcoded set, which listed the wrong WhatsApp keys and missed Telegram's webhook secret. Dispatch's Messaging page uses the shared channel helpers from core.
- a20f0b4: Dispatch's Settings page has one implementation: `@agent-native/dispatch/routes/pages/settings` exports `DispatchSettingsPage({ changelog })`, and the Dispatch template renders it with its own changelog. With `settings-redesign` on, the Dispatch layout renders Settings full width, Members keeps the Dispatch access column, and Dispatch › General shows a Workspace group (Chat-first workspace, Resources, Connect apps) while core Preferences owns the interface language. The route's default export now matches the template's page: it gains the Account and Integrations tabs, links Resources to `/workspace`, and drops the Delivery card and page title wrapper.
- a20f0b4: Settings polish follow-ups:
  - `@agent-native/core/client/settings` now exports `KeyValueDialog` (with `KeyValueDialogMode` and `KeyValueDialogProps`) and the `ApiKeyEntry` and `ApiKeysListing` types, so an app page can add or replace a key in place instead of sending people to Settings › API keys.
  - `NewKeyMenu` takes `size` (`xs`, `sm`, or `default`) and `variant` props and no longer restyles its trigger; `triggerClassName` is for layout only. The default is `xs` secondary, the group heading action size. The sub-agent dialog's credential picker uses the dialog control size, and the Dispatch Vault's New button uses `size="default"` instead of size classes.
  - The custom integration dialog shows "Connecting…" and "Testing…" beside the spinner while a connect or test runs.
  - Removed catalog keys that nothing reads anymore: `agentChat.settings.storage.missing`, `agentChat.settings.storage.missingPublicUrl`, `agentChat.settingsOrg.invite.close`, `agentChat.settingsShell.account.newEmailPlaceholder`, and `agentChat.settingsSubAgents.browseDirectory`.

- 9199a7f: Standardize chat home suggestions and restore the compact Dispatch app grid.
- a20f0b4: Move the toolkit's Button, Switch, Select, and Input to shadcn new-york-v4 sizing. Buttons are 36px by default and 32px at `sm`, with new `xs`, `icon-xs`, `icon-sm`, and `icon-lg` sizes. `outline` is now the v4 bordered outline (`border bg-background shadow-xs`, with `bg-input/30` in dark mode) instead of an accent fill, and a new `outline-destructive` variant (outline with red text) marks destructive row actions; it maps to the design-system `danger` intent with `outline` emphasis. Switch is 32x18 with a `size` prop (`sm` is 24x14), SelectTrigger and Input take `size="sm" | "default"` (32px or 36px), Toggle is 36px (`sm` 32px), and TabsList is 36px. Alert sets `text-sm` on the root, so titles are 14px, and AlertDescription uses relaxed leading. Adds the shadcn `InputGroup` (`InputGroupAddon`, `InputGroupInput`, `InputGroupButton`, `InputGroupText`, `InputGroupTextarea`) for fields with icons or inline actions. Dispatch's local Button, Switch, Input, Tabs, Toggle, and AlertDialog now re-export the toolkit's, so its tabs and toggles follow the same heights and its confirm dialogs stack above toolkit dialogs. The Dispatch app search matches the 32px toolbar buttons beside it. Settings row, retry, and group-heading buttons use `outline` instead of `secondary`; dialog Cancel buttons stay `secondary`.
- Updated dependencies
- Updated dependencies [a20f0b4]
  - @agent-native/toolkit@0.23.0

## 0.38.15

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [880740b]
- Updated dependencies [55c9666]
- Updated dependencies [55c9666]
- Updated dependencies
  - @agent-native/toolkit@0.22.3

## 0.38.14

### Patch Changes

- Release all public npm packages with a patch version bump.
- ed3801e: Remove nonessential source comments.
- Updated dependencies [d462819]
- Updated dependencies [797b3e2]
- Updated dependencies [e76947b]
- Updated dependencies
- Updated dependencies [adc7497]
- Updated dependencies [797b3e2]
- Updated dependencies [ed3801e]
- Updated dependencies [e7b6fcc]
- Updated dependencies [e76947b]
- Updated dependencies [2397f94]
  - @agent-native/toolkit@0.22.2

## 0.38.13

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [7e8a10a]
- Updated dependencies
  - @agent-native/toolkit@0.22.1

## 0.38.12

### Patch Changes

- 7eb9cbb: Scope provider credentials to their endpoints, coalesce workspace app access checks, and support desktop authenticator sign-in.
- Release all public npm packages with a patch version bump.
- Updated dependencies [dbb10d5]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
  - @agent-native/toolkit@0.22.0

## 0.38.11

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [6ff4d47]
  - @agent-native/toolkit@0.21.3

## 0.38.10

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [2ba6541]
  - @agent-native/toolkit@0.21.2

## 0.38.9

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.21.1

## 0.38.8

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [21fdd86]
- Updated dependencies [4917d34]
- Updated dependencies
- Updated dependencies [ac01083]
- Updated dependencies [21fdd86]
- Updated dependencies [185e25d]
  - @agent-native/toolkit@0.21.0

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

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
