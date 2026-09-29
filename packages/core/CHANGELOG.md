# @agent-native/core

## 1.0.0

### Major Changes

- ea6123a: Remove the legacy settings view from agent chat surfaces.

### Minor Changes

- e977e59: Automatically expose eligible backend actions as WebMCP tools on authenticated app pages.

### Patch Changes

- 0a07d1a: Route chat "What went wrong?" feedback through the shared Agent-Native form so its configured Slack integration receives the chat and request context.
- 4af2889: Use the cube loader for app shells and agent activity, with long-running hints delayed to five minutes.
- a1b4ae8: Make recurring automation actions available to delegated Agent-Native turns.
- 8fe0f75: fix: keep authentication email links on their canonical HTTPS origin
- 6675922: Fail closed when collaborative client initialization cannot load a valid state, with typed retryable errors and no outbound updates before synchronization succeeds.
- 0fee765: Keep MCP OAuth callbacks from returning to chat until the saved server is connected.
- 1f8e13c: Route managed Google OAuth through the provider-aware root callback on standalone apps.
- Release all public npm packages with a patch version bump.
- c2b2ca7: Track usage of the MCP server an app exposes. Every `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read` now emits an analytics event through the framework's provider-agnostic `track()`, so the metrics land in whichever provider the app has configured (PostHog, Mixpanel, Amplitude, webhook, Agent-Native Analytics).

  Event and property names follow PostHog's MCP analytics vocabulary — `$mcp_tool_call`, `$mcp_tool_name`, `$mcp_duration_ms`, `$mcp_is_error`, `$mcp_client_name`, `$mcp_vendor_client`, … — so PostHog's MCP dashboards work with no mapping layer. Both transports report identically: the events are emitted from the shared server builder, with the handshake captured at the HTTP mount where the client's own name and version are on the wire.

  Tool results are never sent. Tool arguments are off by default; set `MCP_ANALYTICS_PARAMETERS=true` (`observability.mcpCaptureParameters`) to include them as redacted `$mcp_parameters`, or `MCP_ANALYTICS=false` (`observability.mcpEvents`) to turn the events off entirely.

- 5820376: Use a monochrome Agent-Native mark in app sidebars.
- c2b2ca7: Name agent traces by what started them. Background automation runs now emit `background_automation_run:<job name>` as their span name (plus a `run_label` property carrying `recurring-job:` / `manual-automation:` / `automation:`), and a chat turn that sets `usageLabel` emits `agent_run:<label>` instead of a bare `agent_run`.

  `sendToAgentChat` accepts a `usageLabel`, which rides the submit payload through the composer and the chat request body to that label.

- 8edbd88: Preserve custom OpenRouter model IDs selected in Agent settings.
- 3feb9ce: Make Builder.io free-credit activation consent a compact one-click popover with an existing-account fallback during onboarding.
- 8239ce1: Show the Connect AI setup card above shared chat composers when provider credentials fail.
- c2b2ca7: Make the agent output-token ceiling configurable and stop scheduled runs from silently getting a smaller one than chat.
  - `agent.maxOutputTokens` (env `AGENT_MAX_OUTPUT_TOKENS`), `agent.mainChatMaxOutputTokens` (default 64K) and `agent.emptyResponseRetryMaxOutputTokens` (default 128K) are declared app-config fields, so the global cap is no longer a bare `process.env` read and an app can set it from `defineAppConfig`. Every value is still clamped down to the model's documented ceiling.
  - The background automation runner now passes the same model-aware ceiling the interactive paths pass. It previously passed none, so every scheduled job and dispatched automation ran at the flat per-engine default — a lower completion budget than chat, on exactly the runs that emit the largest single tool call.
  - A `max_tokens` stop is now recognised as truncation when tool-call parts are present, not only when they are absent. A tool call cut off mid-arguments used to read as a schema error: the model was told to "retry with arguments that match the tool schema" and re-sent the same oversized payload against the same ceiling until the identical-error breaker ended the turn, with the tool never executed. The retry now raises the ceiling and the error names the real cause.

- ef5d097: Restore hosted first-run onboarding after email verification and sign-in redirects.
- 5b7a8ea: Replace flashing skeleton pulses with a smooth whole-surface loading shine.
- 48b09d5: Add shared shine and rotating loading labels to the app shell, and slightly enlarge active tool-call cube loaders.
- Updated dependencies [844fa10]
- Updated dependencies [4af2889]
- Updated dependencies
- Updated dependencies [dcc9f89]
- Updated dependencies [163dd55]
- Updated dependencies [5b7a8ea]
  - @agent-native/toolkit@0.18.0
  - @agent-native/recap-cli@0.5.21

## 0.197.0

### Minor Changes

- b8845eb: Bound framework list reads and remove the vault-wide resync from process startup.
- 7032734: Add an Ink setup wizard to `agent-native create` with project previews and clear cancellation and help behavior.
- 8fd97ec: Let workspaces choose which hosted first-party apps they offer with `agent-native.builtinAgents` (`mode: "all" | "none" | "selected"`, `include`) in the root or standalone `package.json`. Dispatch's app list now follows that config instead of always adding the chat-first defaults, and local workspaces outside the framework repo link built-ins to their hosted URLs.
- 82ad87c: Move optional integration, ingestion, telemetry, and CLI packages out of Core's install-time dependency graph. Features now load peers on demand and report a typed install error when invoked without them. `initServerSentry` is now async and callers must await its `Promise<boolean>` result. Auth pages can use injected renderers, with a plain HTML fallback; without an injected renderer, the form is rendered after client hydration. Remove the decorative WebGPU ocean background from Core's auth and onboarding UI.
- 6d1b545: Make background sync opt-in and refresh local agent edits from the chat run stream.
- b8845eb: Remove `getAllSettings()` and `listSettingsByKeySegments()`; use `getSetting()` or `getSettings(keys)` when the required keys are known. Remove `CollabPluginOptions.resolveCollabDocumentId` and its whole-table lazy-seed lookup; use `resolveSourceIdFromCollabDocumentId` to map a collaboration document id to its keyed source row. These exported APIs are removed because they require table-wide reads.
- bee46b1: The redesigned Settings is now the only Settings for every app, with no feature flag. `SETTINGS_REDESIGN_FLAG` is deprecated and no longer registered; `useFeatureFlag` and `useFeatureFlagState` read it as on, so apps generated from older templates that still check it keep the redesigned layout.
- f12a2de: Add a speech-synthesis route: `POST /_agent-native/speak` turns text into
  `audio/mpeg` bytes through the request's own `OPENAI_API_KEY`, and
  `@agent-native/core/client/speak` exposes it to app code as `fetchSpeechClip`.

  It returns 400 with `reason: "no-provider"` when no key is configured, so a
  caller can fall back to the browser's speech synthesiser without mistaking an
  unconfigured app for a failing one. Every other refusal carries its own reason,
  and an empty 200 from the provider is reported as a failure rather than played
  as silence.

### Patch Changes

- c3a770e: Expose the model's tool-call ID in action run context so apps can correlate each invocation with its progress and results.
- b99ba49: Keep visitors on beta when they arrive there without a beta session.
- fa62fdf: Allow routes to skip first-run onboarding while keeping the session gate active.
- 4dae8b5: Allow Better Auth endpoints through the auth guard under a custom framework route prefix.
- f2e8ffe: Center empty chat composers correctly and make send buttons circular across shared chat surfaces.
- f396b49: Cast the scheduled failure-alert retry timestamp as `bigint` so PostgreSQL can run lease recovery on empty tables.
- 9e87b45: Align settings content widths and controls with the shared settings layout.
- 320d884: Report Builder-routed usage in Builder credits and show connected workspace credit balances to admins.
- 4dae8b5: Follow server-driven run continuations in the native chat runtime.
- c9129d5: Match the app shell backdrop to chat and square the open right-sidebar seam.
- 23c2487: Allow apps to opt out of built-in sign-in marketing pages.
- 4b0cea2: Report removed AgentKit chat imports in Doctor and include version-matched migration guides in diagnostics.
- c37bd18: Match chat sidebar surfaces to app navigation and reduce composer spacing.
- b6ce4c6: Deduplicate restored assistant messages when a server snapshot uses a new message ID.
- f12a2de: Export `isUniqueViolation` from `@agent-native/core/db`. Apps that let a
  partial unique index arbitrate a race — two schedulers allocating the same
  sequence number, say — otherwise have to re-implement the Postgres/SQLite
  error sniffing that `db/client.ts` already does.
- f12a2de: Require a session on `POST /_agent-native/speak`, and bound the request before
  it is parsed. The route previously enforced authentication only in production
  and otherwise resolved `OPENAI_API_KEY` anonymously, so an unauthenticated
  caller on any other deploy could spend its speech credits. It also parsed the
  whole body before checking the script length, and never bounded `instructions`.
  Callers that relied on anonymous synthesis now receive 401.

  An anonymous caller is answered with the `no-provider` result rather than 401,
  because that is the one reason the client starts browser speech: a no-login
  reader would otherwise hear nothing instead of the local voice. No provider key
  is resolved for them either way.

- 0ca16fe: Report `db-queries` and `db-connects` in Server-Timing alongside `db-ops`, so a request's SQL statement count can be read without counting pool connects as statements.
- 57e0a0f: Keep argument-dependent permission errors retryable, isolate terminal delegated-agent failures from parent turns, and alert on stale delegated tasks.
- 4af4f69: A production server build now refuses to run on local PGlite: `node .output/server/index.mjs`, `agent-native start`, and Docker need `DATABASE_URL` set to Postgres, just like a hosted function. For local development, use `pnpm dev`, which still runs on PGlite. Netlify, Vercel, and Lambda invocations are now detected without `NODE_ENV=production`, so a fresh Netlify site with no `DATABASE_URL` refuses sign-up with `HostedRuntimeLocalDatabaseError` instead of a PGlite install error; `netlify dev` and `vercel dev` still count as local. Instead of exiting at boot, a Node or Docker server without a database now skips its boot migrations with the same message and stays up. On every host, while a deploy is missing a setting that sign-in needs, the server answers every sign-in page, including an app's own `loginHtml`, with an uncached 503 setup page that names each one: `DATABASE_URL`, and `BETTER_AUTH_SECRET`, or `A2A_SECRET` in a workspace, where it also derives the auth secret. A workspace missing only `A2A_SECRET` still signs in, and the in-app notice names it. Apps with a custom `getSession` keep their own sign-in page. A sign-up or sign-in refused for a missing setting now says so instead of showing a generic failure. The `/_agent-native/ping?configuration=1` probe reports these from the same checks the refusals use, so it also recognizes app-prefixed database URLs and the workspace-derived auth secret. A hosted function or production server build now requires its auth secret even when `NODE_ENV` is `test` or `development`, matching the database refusal. The async A2A processor now decides from the same host markers, so a started production server build or a hosted function without `NODE_ENV` counts as production too, so a bare `node .output/server/index.mjs` or Docker server without `NODE_ENV` answers 503 until `A2A_SECRET` is set instead of accepting unsigned tasks, and the configuration probe names `A2A_SECRET` exactly when that happens. `netlify dev`, `netlify serve`, `vercel dev`, and `sam local` (`AWS_SAM_LOCAL=true`) count as local for the database, auth secret, and A2A checks, even with `NODE_ENV=production`.
- 1fd5c7a: Restore the searchable Dispatch app directory and localize its action labels.
- f12a2de: Export `NarrowContainerProvider` and `useInNarrowContainer` from
  `@agent-native/core/blocks`. Width-sensitive blocks (today `diff`) already
  choose a container-appropriate default inside `tabs` and `columns`; apps that
  render a borrowed block in their own narrow column — such as a Plan edition
  story — can now opt into the same behaviour instead of getting a split diff
  crushed into a half-width box.
- 7220a4d: Keep development hosting markers on the local runtime path.
- 19256a9: Refresh the retry cooldown after repeated automation identity failures so blocked jobs do not starve later scheduled jobs.
- 56d047a: De-duplicate Settings and Team button wrappers into shared PrimitiveButton and apply ghost hover resets conditionally so solid primary buttons preserve text-primary-foreground on hover.
- f2f6f43: Keep fresh triggers eligible while bounded stale Mail expiry leaves a backlog.
- 4a681b7: Let `ffmpeg-static` run its install script in generated projects, so the binary is actually downloaded and the deploy's ffmpeg bundling has something to copy. Also stop the workspace YAML merge from skipping an entry because its name appears in a different section.
- 023ee9b: Keep home chat visible while provider readiness is checked.
- 4969087: Add `callAgent` to `IntegrationsPluginOptions`. It defaults to `true`; set it to `false` to leave `call-agent` out of messaging turns, which matches what agent-chat's `workspaceApps` tool group already allows on the web. `call-agent` is in `DEFAULT_INITIAL_TOOL_NAMES`, so it is on every first request even when it is not in `initialToolNames`. A deployment that shares no A2A secret with the first-party apps therefore had messaging turns calling `analytics` or `content` and getting back `401 Invalid or expired A2A token`, when the app's own connection had the answer.
- 2197b46: Add `initialToolNames` to `IntegrationsPluginOptions`. Messaging turns sent every action the app passed in on their first request; an app with a large action surface can now name the tools to load up front, as it already does for agent-chat, and the rest stay discoverable through `tool-search`. Unset, the behaviour is unchanged.
- a8ec661: Load LaunchDarkly evaluation only when its action runs so unrelated app cold starts do not load the server SDK.
- 0a86389: First-run onboarding extensions can run before or after provider setup, contribute their steps to progress, and wait for completion before leaving. Manual setup skips capabilities already satisfied by sign-in, including Mail's Gmail connection.
- a826bbe: Align Mail's startup skeleton with its current inbox layout.
- 83f709e: Enforce recurring sweep deadlines, cancel abandoned Mail work, and stop notification fanout after a sweep aborts.
- df7e3ce: Keep stale mail events out of trigger selection when a sweep cannot check expiry.
- 3f9c125: Keep stale trigger expiry and terminal writes inside the background sweep budget.
- Release all public npm packages with a patch version bump.
- 5430f9c: Connecting an MCP client now gives an account without an organization its default one, so the connection is scoped to it. The consent page no longer offers Personal to people who belong to an organization.
- b8845eb: Scope MCP configuration and connections to the authenticated user and organization, and keep anonymous sessions out of MCP.
- 0ea21e5: Fix blank local visual-edit screens: the design bridge now adds the preview token to multi-line `import { … } from` clauses, such as Vite's pre-bundled dependency chunks.
- 61770e5: Route serverless database requests through Neon pooling, cap function pools at one connection, and record observed per-request query counts.
- ebf5f34: Avoid loading unrelated settings when enumerating MCP and scoped settings.
- 9c186fc: Add localized labels for trace eval promotion.
- c86c6fa: Read the session once per page load and lower the per-request auth cost. The session bootstrap, analytics, `useSession`, and the beta-lane probe now share one signed-in answer, and a focus or visibility change inside that 30-second lifetime re-reads it when it expires if the tab is still focused. The identity-rekey probe and the `active-org-id` preference are cached per process for 15 seconds and dropped on writes; the preference is also keyed by an httpOnly org-selection cookie that every org change made by the caller and every new session rotates, so that browser reads its current org on every instance. The legacy cookie path reads its user row once. Storage secrets are fetched in one batch, `file-upload/status` detects each provider once, and the onboarding summary is shared across the components that show it and, like the upload status, waits until startup reads have finished.
- 15d1110: Export and import a portable text resource pack (secrets redacted).
- 369632b: Promote a completed production trace into a CI eval case.
- b6ce4c6: Keep AgentKit approval continuation output in its canonical chat message instead of folding it into the server placeholder.
- 47985fe: Export the shared agent-engine readiness check for client-side submit preflights.
- c65d6a8: Limit cross-app discovery and delegation to requests that need peer-owned data or capabilities.
- f25679f: Load the built-in model catalog when a visible `AssistantChat` picker has no host-provided catalog.
- cfedd43: Ignore global sidebar events and preference updates while the Agent sidebar is disabled.
- 7032734: Clarify optional reply text in Observability eval promotion.
- cae86e4: Skip schema catalog probes and release-owned runtime migrations during hosted function requests, even when NODE_ENV is unset.
- 7342b95: Keep sign-in working inside Builder preview iframes: session, embed, and UI-capability cookies (and Better Auth's session cookie) now use `SameSite=None; Secure; Partitioned` when a dev server is served through Builder's HTTPS preview tunnel, and HTTPS detection lives in one shared helper.
- fa62fdf: Improve provider setup controls, status retry backoff, and suggestion contrast.
- 9071b38: Let command menu items take a stable `value`, so keyboard selection survives an item's text changing while it is shown.
- 7161ec2: Keep AgentKit runs active while a server-driven continuation starts.
- d2ba564: Keep agents from repeating completed mutations, stale reads, disabled features, or oversized discovery searches, and let them summarize cleanly when a loop is stopped.
- b8845eb: Scope ownable reads and writes to their authorized user, organization, or share.
- 9e35bba: Add core observability labels for promoting traces into evals.
- b8845eb: Bound automation trigger claims to the scoped FIFO head.
- 5430f9c: Switching organizations without an organization no longer leaves the account outside its organization; the request now keeps the current one.
- 58fe222: Expose the existing per-user Jev credential lookup to server actions so template features can use a saved key without a separate configuration path.
- 0e8e6f8: Clarify the required-text prompt when promoting trace evaluations.
- 734137b: Persist notification channel and sent-event completion so idempotent sweep retries do not replay deliveries.
- 4dae8b5: Preserve chat attachments while keeping pending selection tab-scoped and non-blocking.
- 92020c0: Let apps replace the markup and copy of framework emails with `overrideTransactionalEmail(id, render)`, returning HTML or a React element from typed props. This covers verify signup, reset password, magic link, both email-change emails, organization invites, Builder credit limit, and the resource-shared notification. The resource-shared notification is now in the transactional email catalog as `core.resource-shared`. Catalog definitions accept an optional `previewAsync`, and the new `renderTransactionalEmailPreviewAsync` renders it so overridden framework emails preview with the app's design. `preview` and `renderTransactionalEmailPreview` keep their synchronous contracts.
- 09b3645: Link the visual-edit skill to its worked usage guide.
- 8d5f335: Run the esbuild JavaScript launcher through Node so production builds work on Windows.
- 90048ab: New workspaces skip the 24-hour install delay for every `@agent-native` package, so a same-day framework publish no longer blocks `pnpm install`.
- Updated dependencies [f2e8ffe]
- Updated dependencies [023ee9b]
- Updated dependencies [47985fe]
- Updated dependencies
- Updated dependencies [82ad87c]
- Updated dependencies [57e0a0f]
- Updated dependencies [fa62fdf]
- Updated dependencies [82ad87c]
  - @agent-native/agentkit@0.5.1
  - @agent-native/toolkit@0.23.1
  - @agent-native/recap-cli@0.5.49

## 0.196.0

### Minor Changes

- a20f0b4: Add the redesigned Settings shell behind the `settings-redesign` feature flag: a page registry (`defineSettingsPage`, `registerSettingsPages`, `SETTINGS_PAGE_IDS`), Account, Connections, Agent, Organization, and app groups with role-gated pages, search, a sticky header, and a mobile drawer. `SettingsTabsPage` waits for the flag behind a layout-matching skeleton and bridges today's props and tabs into the new pages, so templates keep working unchanged. Also adds `useFeatureFlagState`, which tells a flag that is still loading apart from one that evaluated off.
- a20f0b4: Settings links keep working in the redesigned Settings (`settings-redesign` flag). One redirect table (`@agent-native/core/navigation`) maps today's tab ids, nested ids, section hashes, `#secrets:KEY`, `?section=`, and `agent-panel:open-settings` sections onto the new pages, and the shell rewrites a legacy URL to the page's own path while keeping its query. `buildSettingsRoute(page, sub?)` builds page routes (the old `a:b:c` form and base-path argument still work), `buildSettingsEntryRoute` is exported, and today's Settings opens the closest tab for a new page id. Search indexes translated rows from core's sections, flashes the row it opens, and hides owner and admin pages from members. The shell records the open page in the tab-scoped `settings-view` application state, the agent sees it as `settingsPage` in `<current-url>`, and a new `open-settings-page` tool opens any page. With the flag on, `/extensions` opens the app's Extensions page (or its General page when it has none), Mail's `/team` opens Members, and `/settings/integrations/secrets/KEY` opens API keys on that key. `buildSettingsRoute` keeps a secret key's case (`integrations:secrets:OPENAI_API_KEY` is `/settings/integrations/secrets/OPENAI_API_KEY`), so the Voice section's key links open that key with the flag on or off. With the flag on or off, a settings request dispatched with only a hash (run recovery's agent limits, the composer's model link) opens that section instead of the Agent overview.
- a20f0b4: Turn `OrgSwitcher` into an account menu (also exported as `AccountMenu`). The button shows the signed-in person's photo, name, and current organization. The menu lists organizations, invitations, domain matches, and Create organization, then Settings (with the `⌘,` hint), Usage, a "Get apps and extensions" drill-in when `utilityLinks` are passed, and Log out. Invite member, Organization settings, Profile, and the Tools header leave the menu, and Log out leaves Settings › Account. `settingsPath` and `profilePath` are deprecated and ignored.
- a20f0b4: Cmd+, (Ctrl+, off macOS) opens Settings from any page, including inside inputs, and every command menu has a Settings command showing the shortcut. The agent panel's options menu links to Settings > Integrations. New exports from `@agent-native/core/client/navigation`: `useSettingsShortcut`, `SettingsShortcut`, `openSettingsPage`, `isSettingsShortcutEvent`, `isSettingsRoutePath`, `settingsPagePath`, and `OPEN_SETTINGS_PAGE_EVENT`.
- a20f0b4: Provider keys are now checked by asking the provider which models they reach. Add the `check-provider-key` action (`{ provider, key?, baseUrl?, scope? }`) and the `fetchProviderModels` client helper that calls it, for OpenRouter, Ollama, Anthropic, OpenAI and OpenAI-compatible gateways, Google Gemini, Groq, Mistral, and Cohere. A failed check returns `ok: false` with a `code` (`rejected`, `wrong-provider`, `missing-key`, `invalid-endpoint`, `unreachable`, `provider-error`) and a reason such as "This looks like an Anthropic key." or "Groq keys start with gsk\_.". A key with another provider's prefix is refused before it is sent anywhere. A saved key is only checked against its saved endpoint (`baseUrl` without `key` is a 400), and checking the organization's key (`scope: "org"`) is for owners and admins (403 otherwise).

  Saving a provider key through `/_agent-native/agent-engine/api-key` now runs the same check for every provider, not only OpenRouter, and refuses a rejected key (400) or one it couldn't verify (502), with the `code` in the response.

  A key its provider rejected during a chat now shows as rejected instead of silently being skipped: `GET /_agent-native/secrets` reports `status: "invalid"` with `rejectedAt`, and `manage-agent-engine` `list` reports `credentialRejected` and `credentialRejectedAt`, until a call with the key succeeds or it is replaced.

- a20f0b4: Add "Restrict personal API keys", an organization setting owners and admins change with the new `manage-provider-key-policy` action. While it is on, members' own model provider keys and personal Builder.io connection are skipped by every credential resolver (their chats use organization providers), members can't save new personal provider keys or connect a personal Builder.io account, and a chat with no usable key says "Owners and admins restricted personal API keys." Owners and admins keep their own keys, nothing is deleted, and turning it off restores members' keys. Reading the setting as an owner or admin lists each affected member and the providers that stop, and every change is audited.
- a20f0b4: Builder.io connections are now explicit: the organization's and a member's personal connection. Builder status reports `grants` (OAuth grants and stored key pairs, told apart by `kind`), `effective`, and `canConnect`; `/builder/connect?scope=org|personal` and `/builder/disconnect` with `{ scope }` act on one connection, with owner/admin enforced for the organization's. `useBuilderConnectFlow` exposes the new fields and `start({ scope })`, and `BuilderConnectionMenu` and `BuilderConnectCard` take a `scope`, so a member riding the organization's connection no longer sees a Reconnect that would shadow it.
- a20f0b4: Each model provider now keeps the models its owner checked, and only checked models appear in the chat model picker and the default-model select. A selection is stored at the same scope as the provider's key: a member's personal key uses their own selection, and the organization's selection belongs to owners and admins. With nothing checked, a provider shows its recommended models as before.
  - New actions: `get-provider-models` (read the selection per provider and scope, with the recommended models) and `manage-provider-models` (`set` or `reset`; `scope: "org"` needs an owner or admin and is refused with 403 otherwise). Organization changes are recorded in the organization audit trail.
  - `manage-agent-engine` `list` reports each engine's `supportedModels` as the models the picker offers, plus `recommendedModels` and `modelSelection` (`default`, `selected`, or `unreadable`). `/_agent-native/agent-model-defaults` offers the organization's checked models.
  - Connecting Builder.io no longer hides other providers' models: providers with their own key show next to the Builder.io models. Builder.io model groups are labeled with a "· Builder.io" suffix ("OpenAI · Builder.io") so they read apart from a group on the provider's own key. Groq, Mistral, and Cohere show once they have a key, and Ollama shows once its models are checked.
  - A chat already on an unchecked model keeps running on it. When nothing picked a model and the engine's default is unchecked, chats use the first checked model.
  - `MultiTabAssistantChat` builds its model list with the same loader as `useChatModels`, so it now also swaps in Ollama's installed models.

- a20f0b4: With the `settings-redesign` flag on, Settings › Model shows Organization providers (the organization's Builder.io connection and keys), Personal providers (a member's own Builder.io connection and keys, and the ChatGPT subscription while its lab is on), and Organization settings (Default model, Restrict personal API keys with a confirm that lists affected members, and Max iterations). Members see organization providers, the default model, and max iterations read-only. A key its provider rejected shows in red with Replace key, and a member's personal key reads "Not used while personal API keys are restricted." with Remove while the restriction is on.
  - New `ProviderDialog` (from `@agent-native/core/client/settings`) is the one writer for a provider key, with `add`, `manage`, and `add-from-service` modes: it checks a pasted key (or Ollama endpoint) by listing the models it reaches, lists them as checkboxes, takes an optional OpenAI endpoint URL, sets who can use the key, and removes a provider after a confirm that lists what stops. Chat recovery and Clips' AI setup open it with the flag on. `AgentProviderSetupForm` is deprecated and keeps working for one release.
  - New read-only action `list-model-providers`: each provider's organization and personal key (masked; members see only that an organization key exists), its endpoint, when its provider rejected it, whether personal API keys are restricted for the caller, and the stored default model.
  - Settings search finds the Model page's rows (Default model, Max iterations, Restrict personal API keys, the provider groups, and each provider by name). Run recovery's Settings link opens Max iterations by its section instead of setting the URL hash.
  - `list-model-providers` also reads legacy workspace rows the credential resolver uses (the organization's `workspace` row, and the caller's pre-organization solo row), marked `legacyWorkspaceRow`, so a key that powers chats never lists as absent. Removing a provider through `DELETE /_agent-native/agent-engine/api-key` deletes the matching legacy row too, so a removed key stops working.
  - The Add provider dialog offers a provider whose key was rejected as Replace key at that key's scope, so chat recovery can replace a rejected personal or organization key. With nothing new to add, it offers the saved keys as explicit replaces instead of silently overwriting one.
  - On the Model page, model counts and the Default model show placeholders while models load, and a failed read shows "Couldn't load this setting." with Try again instead of reading as no models. Background agents and rows a template adds to the Agent overview (`agentAdditionalContent`) stay on the Model page until their own pages land.

- a20f0b4: With the `settings-redesign` flag on, Settings › Agent › Instructions, Memory, Skills, and Files list resources in Personal, {Org name}, and From Dispatch groups (Memory adds a Learnings group instead of From Dispatch). The organization group is read only for members, and From Dispatch is read only with an All apps chip and an Open Dispatch link in workspace apps. Instructions adds your personal AGENTS.md from a dialog, Memory adds a memory or a learning, Skills has an Add skill menu (Describe it to the agent, Upload a skill file), and Files has an Add file menu (Upload file, Create file); owners and admins get the same add menu on the organization group. Each row has Open, Download for text files, and Remove behind a confirm dialog. `ResourcesPanel` takes `settingsGroups` and `openResourceRef` for these pages. With the flag on or off, resource trees refetch after agent writes, so a memory or skill the agent saves appears without a reload, and a member opening an organization resource gets the read-only editor.
- a20f0b4: With the `settings-redesign` flag on, Settings › Agent › Sub-agents lists every agent the main agent can delegate to, each once: {Org} apps (first-party and workspace apps with their reachability and URL), External agents, and Custom agents. Owners and admins get a Connect agent directory dialog (Microsoft Foundry, Gemini Enterprise, Anthropic Managed Agents, or any A2A agent by URL, plus a Global A2A Registry link) and an Edit or Remove menu on each agent; members see the list read only and can add personal custom agents by describing them to the agent or writing them. `?connect=` deep links and legacy Connected agents, Agent directory, and Remote agents links open this page. `AgentsSection.tsx` now exports `useRemoteAgents`, `AgentAddForm`, `AgentEditForm`, and `readAgentConnectRequest`. With the flag on or off, the connected agents list refetches after agent writes and says when it could not load instead of showing an empty list, and a peer's register-back link opens its Connected agents list.
- a20f0b4: Registered and ad-hoc secrets now report `usedFor` (what each key powers, per app and feature) and `managedBy` (the Settings page that owns a key). Add the `preview-secret-removal` action to preview what stops or switches when a key is removed, including model picker and default model effects. Deleting a managed key (Builder.io credentials, S3 storage fields, channel tokens, calendar tokens) from the secrets routes now returns 409 naming its owner unless the owner surface passes `?managedBy=<id>`.

  API keys now shows managed keys read-only with their owner, and each channel under Integrations can remove its stored credentials.

- a20f0b4: With the `settings-redesign` flag on, Settings › API keys shows Your keys (each "{mask} · Used by {feature}"), Organization keys for owners and admins, and Managed by integrations (collapsed behind "Show N keys"; read-only, each linking to the page that owns it, with calendar tokens only while Meetings is on). A model provider key's Manage opens the provider dialog; other keys offer Test, Replace value, and Delete key. Add key takes a name, value, and who can use it (members are locked to Just me). Delete key lists what stops, per app and feature, before it deletes.
  - New read-only action `list-api-keys`: every saved key the credential resolver can use for the caller, including legacy `solo:<email>` and organization `workspace` rows, with its mask, what uses it, its model provider, its owner page when another page manages it, and whether the caller can replace, delete, or test it. Members never see organization keys, and managed organization keys list without a mask. It also lists registered keys nobody has saved yet.
  - New action `delete-api-key { name, scope, storedScope }` deletes exactly one listed row. It refuses managed and Vault-synced keys, needs an owner or admin for organization keys, is audited, and fails with 404 when nothing was removed.
  - New client helpers `saveApiKeyValue` and `testSavedApiKey` wrap the secrets routes, so key values never pass through an action.
  - Automation webhook signing secrets (`automation-webhook:*`) are now managed by Automations, so API keys lists them read-only and the secrets delete routes refuse them. The storage manager's route is now `infra`, the Infrastructure page id.
  - The voice input settings link to a missing key opens Settings › API keys instead of Integrations. A model provider key (Gemini, OpenAI, Groq) opens the provider dialog for that provider; any other key opens Add key with its name.

- a20f0b4: With the `settings-redesign` flag on, Settings › Integrations shows Builder.io first (under Recommended until it's connected, then under Connected), connected MCP servers, and the catalog by category with four tools each and "See more". Messaging channels and the Email row are no longer on this page. Builder.io has its own page at `/settings/integrations/builder` with the organization and personal connections, what Builder.io powers, and a disconnect confirmation that lists what stops working, including whether the default model switches to another provider or chats stop. Settings search finds every catalog tool and Builder.io. The legacy Integrations panel no longer keeps the Recommended badge on Builder.io once it's connected. New `manage-builder-connection` action: the agent and the page read the organization and personal Builder.io connections and the default model's dependence on Builder.io, and disconnect either one, with the organization connection limited to owners and admins on the server.
- a20f0b4: Add the {App} › Channels page to the redesigned Settings (behind the `settings-redesign` flag): Slack, Google Docs, Telegram, WhatsApp, Discord, Microsoft Teams, and Email, each with its state, a page with the adapter's own required variables, the webhook URL to copy, and setup that only owners and admins can run. Owners and admins save, replace, and remove a channel's credentials there in any app, stored as the organization's workspace secrets, so a template no longer has to declare channel keys. New core actions `list-messaging-channels` and `manage-messaging-channel` (`save-credentials`, `enable`, `disable`, `remove-credentials`, `register-webhook`) back the page, so the agent can set up and switch channels too; the `/integrations/:platform/enable|disable|setup` routes share the same operations. `EnvKeyConfig` gains `deploymentOnly` for keys the runtime reads only from the environment, which Google Docs' service account key sets. Google Docs joins the channel catalog. Apps can add their own settings to a channel's page with `registerChannelSettingsExtensions`, and Clips shows its Slack link previews there. The old Integrations panel now lists the variables each adapter reports instead of a hardcoded set, which listed the wrong WhatsApp keys and missed Telegram's webhook secret. Dispatch's Messaging page uses the shared channel helpers from core.
- a20f0b4: Owners and admins can pick the provider for Voice input, Image generation, and Embeddings with the new `manage-service-providers` action (org setting `service-providers`). Batch voice transcription tries the organization's choice first when the user's own provider is auto, then the usual Builder.io, Gemini, Groq, OpenAI order. Embeddings no longer turn off when several providers are available: `defaultEmbeddingFamily` uses the organization's choice, or Builder.io, then Gemini, Cohere, and Voyage, and `resolveDefaultEmbeddingFamily()` applies it for the current request. `/_agent-native/voice-providers/status` reports the choice as `orgProvider`.
- a20f0b4: Add one S3-compatible file storage form (`StorageSettingsForm`) used by Settings, the onboarding checklist, and templates, backed by the new `get-file-storage` and `manage-file-storage` actions. Saving and clearing storage now requires an organization owner or admin on the server, and Clear credentials asks for confirmation before it deletes every saved storage key. Onboarding steps can declare a `kind: "file-storage"` method, and upload providers that serve files without a public URL set `publicBaseUrlOptional: true`.
- a20f0b4: With the `settings-redesign` flag on, Settings › Organization › Infrastructure is a real page for owners and admins: Builder.io setup, the services and who powers each (AI model, file storage, Voice input, Image generation, Embeddings, and the Builder.io-only services), and the read-only environment (database, hosting and every app's address, required variables). Choosing a service's provider updates its row before the server answers and rolls back on failure. The new `get-infrastructure-status` action (owners and admins, `orgAdministration` group) reports the database provider and host, the hosting platform and app addresses, which deploy variables are set (never their values), and the app profile's Required/Recommended tags; `resolveDeployPlatform()` and `getInfrastructureStatus()` are exported from `@agent-native/core/server`. Background agents move from the bridged Model page to Infrastructure's Services list.
- a20f0b4: Audit log: organization owners and admins can read their organization's settings and admin trail. A new `admins` visibility makes an event readable by the org's owners and admins (and its owner), never by other members; `private` events stay with their owner, admins included. `list-audit-events` and `export-audit-events` take `scope: "organization"` (owners and admins only, 403 otherwise) plus `app`, `beforeMs`, and `offset` filters, and `list-audit-events` returns `hasMore` and `nextOffset`. Every event now records the app that wrote it in a new nullable `app` column. A thrown 401 or 403 is recorded as a `denied` attempt instead of an `error`. Default model changes, app member and permission roles, workspace app access, and file storage are now `admins` events (they were `org` events every member could read), and org member role changes and Builder.io connect and disconnect are now recorded (org-scoped connections as `admins` events, personal ones as `private`). New helpers `orgAdminAudit` and `recordOrgAdminAuditEvent` in `@agent-native/core/audit` record other settings changes the same way.
- a20f0b4: Settings gets an Audit log page for organization owners and admins, behind the `settings-redesign` flag. It lists the organization's settings and admin changes newest first, filters by time range and app, shows the Agent as the actor when the agent made the change, marks refused attempts, pages with "Show N more", and opens each event's details. `list-audit-events` accepts `includeApps: true` to also return the app ids with events in the scope.
- a20f0b4: `get-usage-metrics` now covers every app by default and takes an `app` filter (`"all"`, `"current"`, or an app key). Results add a per-app breakdown (`byApp`) that sums to the totals, the apps with usage (`apps`), `appScope`, and `currentAppKey`. The deprecated `appId` parameter still filters to one app, and today's Usage settings tab still shows the current app.
- a20f0b4: Add the redesigned Settings › Usage page behind the `settings-redesign` flag: Overview and Activity tabs, range, app, and Everyone / Just you filters, metric tiles, a usage history chart by feature, app, or model, top chats, top people, your alerts with an edit dialog, and tool and model call charts. Amounts read as Builder.io credits when the agent runs on Builder.io and as estimated dollars otherwise. `get-usage-metrics` now also returns `dailyBy` (the daily history split by feature, app, model, and surface), `byUser`, `topChats`, and `toolCalls`.
- a20f0b4: Add the Organization General, Members, Authentication, and Apps pages to the redesigned Settings (behind the `settings-redesign` flag), exported as `OrgGeneralPage`, `OrgMembersPage` (takes `appRoles`), `OrgAuthenticationPage`, and `OrgAppsPage` from `@agent-native/core/client/org`. `GET /_agent-native/org/me` now returns `signInMethods` (email and password, Google, GitHub) to owners and admins, and the new `list-sign-in-methods` action gives the agent the same view.

  Permission change: the cross-app (A2A) secret is now owner-only on the server. Admins get a 403 from reveal, set, and sync, and `org/me` omits `a2aSecretSet` for them, matching the UI. `canManageOrgDomain` now allows admins, matching the server, which already let admins set email domain auto-join. New `canManageOrgA2ASecret` helper. The legacy `auth` settings section now opens Organization › Authentication.

- a20f0b4: Split Account into Profile, Preferences, and Security pages behind the `settings-redesign` flag. Profile has the photo, an inline name field, and a Change email dialog; Preferences has Interface language, Timezone, and the Voice transcription picker (moved off the Agent page); Security has Add or Change password and two-factor dialogs plus separate Request a copy and Request deletion rows. Every row has a search entry. `AccountSettingsCard` keeps working for the old Settings and now shares the pages' request logic. The compact voice picker now reports a failed read or save instead of showing Batch as the saved choice.
- a20f0b4: Build the app's group in the redesigned Settings (behind `settings-redesign`): a General page with Agent › Default model (owners and admins change it, members see it read-only), the app's own groups, and This browser › Demo mode, with app areas as tabs; Notifications when the app passes it; Automations with the viewer's real role, a member footnote, and New automation in the header; MCP server with an about line and an Integrations footnote; Creative context and What's new with header chips; and Labs as one group named after the app. `SettingsTabsPage` gains `generalGroups`, `appAreas`, `notifications`, `notificationsSearchEntries`, and `mcpAbout`, which also render as today's tabs with the flag off. Labs now show each lab's `defaultEnabled` while loading and when `get-labs` fails (with an error line), and hide labs the server didn't register; `useLab` and `useLabState` accept a lab definition to use its default until the server answers. Flag-off Settings' Automations tab now shows members "You can manage automations you created." The `agent-model-defaults` route reports the organization's default as `orgDefault`.
- a20f0b4: First-run "Choose your setup" and Settings › Organization › Infrastructure now read one list of shared services, `WORKSPACE_SERVICES` (exported from `@agent-native/core/onboarding`): AI model, file uploads and storage, Voice input, Image generation, Embeddings, and the Builder.io-only Design system intelligence, Background agents, and Browser automation. App profiles tag each of these capabilities with its `service` id (and `builderOnly` for the Builder.io-only ones), Infrastructure's Required/Recommended tags come from those ids, and the first-run Builder.io card lists them from the profile instead of a fixed list, so "Connected agents" and "Hosting and deployment", which Builder.io doesn't provide, are gone and Assets' Video generation shows as Builder.io-powered. The Email delivery onboarding step no longer saves `RESEND_API_KEY` or `SENDGRID_API_KEY`: it explains the host variables, and it's hidden when the deployment already provides email. With the `settings-redesign` flag on, "Skip and configure manually" opens Agent › Model for everyone, where the no-provider empty state adds a provider key in one click.
- 108074a: Standardize full-page AgentKit chat homes and restore the Dispatch workspace app launcher.
- 56a0c5b: Export a reusable Builder credit notice so sidebars can place it above their footer divider.

### Patch Changes

- 80a16c4: Show delegated task progress as compact chat cards.
- a20f0b4: Deleting a provider key from Settings › API keys no longer removes a Vault-synced or managed endpoint or older key name saved beside it, so the provider keeps working until Vault syncs again.
- 490b16a: Preserve assistant text in order with tool calls and results when resuming an approved chat action.
- c636eb2: Keep the active chat tab visible in the tab strip.
- 65fd4ed: Notify users when a Builder credits-limit error stops a run and surface live credit exhaustion beside the organization switcher.
- 80a16c4: Show Mail rule changes with the filter icon and render successful automation changes as focused chat cards.
- d898975: Restore hosted app signup pages with app descriptions and inline Learn more links.
- e4c71b1: Show automation failure reasons, classify missing MCP tools, and email owners once per failure streak with one-click unsubscribe.
- e1ef371: Improve light-mode auth form contrast and hide the redundant manual cross-app sign-in button on canonical hosted apps.
- 7af9d3f: Refine AgentKit activity labels, approval details, and shared action cards.
- a20f0b4: Owners and admins who activate a new Builder.io account now connect it for the organization, matching how they connect an existing account. Members still activate personally.
- 8a9a428: Use Builder's active quota to report credit exhaustion and identify its daily or monthly period.
- a20f0b4: Owners and admins run on their organization's Builder.io connection first, whether it's an OAuth grant or a key pair, so a personal connection kept from before a promotion no longer shadows it. Their own connection stays the fallback when the organization has none.
- a20f0b4: The Builder.io OAuth callback decides where a connection is saved from the connector's current role in the organization the flow started in, so a promotion, demotion, restriction change, or organization switch during sign-in can't leave a personal grant that shadows the organization's connection or skips the personal API key restriction. The personal API key restriction view reads every member's Builder.io grant in a few batched queries instead of one per member.
- 6175ad8: Keep MCP-only actions available on external MCP routes.
- a20f0b4: In dev, a connection reset from a server-side socket now returns an error response and is logged, instead of closing the browser's request with an empty response.
- a20f0b4: In Vite dev, framework responses close their connection to Nitro's worker, so a burst of requests no longer fails with `read ECONNRESET` when the worker drops idle keep-alive sockets.
- 65fd4ed: Persist event automation deliveries in a FIFO queue with bounded retries and a terminal failure state; expose an awaited event bus API for durable acceptance.
- 7c22552: Export `emailQuote` from `@agent-native/core/server` so templates can quote user-authored notes in notification emails.
- a20f0b4: Previewing first-run onboarding with `?onboarding=preview` now ends when "Skip and configure manually" opens Settings, so the preview no longer covers the Settings page it opened.
- 80a16c4: Show successful preference and appearance updates as compact chat cards.
- a20f0b4: Return the JSON error from framework routes that fail after reading the request body instead of leaving the client waiting, and stop voice transcription from cancelling its provider call once the audio upload has been read.
- a20f0b4: Owners and admins can invite members when email isn't configured. The invite dialog says invites won't be emailed, and the confirmation says the invite was saved unless the server reports the email went out. `canInviteOrgMembers(role)` now checks only the role; drop any second `emailConfigured` argument.
- Release all public npm packages with a patch version bump.
- e7685e8: Clarify the Builder monthly credit limit label.
- a20f0b4: Fix member offboarding and email-change rekey on migrated app databases. Apps declare their own identity columns with `registerIdentityColumns()` from `@agent-native/core/org`, share tables made by `createSharesTable()` are recognized by shape, Better Auth sessions keyed by `user_id` are revoked, and org member routes log the underlying failure instead of discarding it.
- a20f0b4: Removing a member lets you hand their data to anyone in the organization through a searchable picker, not only people on the loaded page, and member search drops the previous query's results as soon as you type. The invite form sends every valid address when one row is malformed, and flags that row inline instead of blocking the submit. Invites with no app role picked no longer send an app id the server rejects.
- e783ff4: Preserve display-only attachment markers when chat submissions use serialized attachment metadata.
- c26c809: Keep first-run onboarding in control until its startup screen is ready.
- a20f0b4: Email changes and member offboarding now also rewrite `author_email` on Content suggestion proposals and their creation records, instead of refusing to run because those columns had no identity policy.
- c786d97: Remove the Personal choice from the account menu and resolve accounts that picked it back to their organization, so connecting Builder.io works again.
- 80a16c4: Show successful share and visibility changes as compact chat cards.
- a20f0b4: Route warmup no longer prefetches `.data` for paths the server answers itself (`/mcp`, `/.well-known`, `/api`, `/assets`, and the framework namespace), so links such as the MCP Connect page stop logging 404s.
- ddcd0b0: Make legacy session revocation authoritative across server instances and prevent caching authenticated session responses.
- a20f0b4: Settings' "Back to {App}" returns to the page you came from even when the agent panel is closed. The return path used to be recorded only while the panel was mounted.
- a20f0b4: Settings › Model and Settings › Infrastructure lead with Builder.io as the recommended setup. With no provider, the Model empty state offers Connect Builder.io as its primary action and Add provider as the secondary one, and the header returns to Add provider once a provider is set up. Infrastructure heads the page with a Recommended Builder.io row, and Builder.io-only services are marked "Builder.io only" with a Connect Builder.io action in place.
- a20f0b4: The scaffolded `agent-native-toolkit` skill now says Settings is not a sidebar item: it opens from the account menu and ⌘, (Ctrl+, elsewhere), and apps keep the `/settings` route.
- a20f0b4: Save model provider keys at the scope the caller picks. Members save personal keys instead of getting a 403, an owner's or admin's organization key no longer deletes their personal key for that provider, and removing a key takes the same `scope`.
- a20f0b4: Security: the default model (the `agent-engine` setting) is now stored per organization, and only organization owners and admins can change or clear it. Before, it was one row for the whole deployment that any signed-in user could change or delete. `manage-agent-engine` `set` refuses members with a 403 (`default_model_admin_required`), `/_agent-native/agent-engine/disconnect` requires owner or admin, and both record audit events (target type `agent-default-model`), including refused attempts. A signed-in user with no organization keeps their own default. The old deployment-wide row is still read as a fallback for one release, so existing deployments keep their default until each organization saves its own. Saving a provider key can now pick that provider as the default in the same request (`defaultModel` on `saveAgentEngineProviderSettings`), so Settings no longer needs a separate Apply step. `manage-agent-engine` `list` reports `canUpdateDefault` and `defaultSource`.
- a20f0b4: One Google Gemini key now powers chat models, voice input, embeddings, and image generation. Settings registers and writes `GOOGLE_GENERATIVE_AI_API_KEY`; keys saved under the older `GEMINI_API_KEY` name keep working everywhere, and removing the Gemini key removes it under both names. New `resolveGeminiApiKey()`, `resolveSecretWithAliases()`, and `readGeminiDeployCredentialEnv()` in `@agent-native/core/server`, and `GEMINI_API_KEY` / `secretKeyNames()` in `@agent-native/core/secrets`.

  An older `GEMINI_API_KEY` row saved at another scope, such as Brain's workspace key, now appears with the custom keys so owners and admins can remove it, and `DELETE /_agent-native/secrets/adhoc/:name` accepts `?scope=user|workspace` to remove the listed row rather than a same-named personal one.

- a20f0b4: Split `TeamPage` into reusable Organization sections (`OrgGeneralSection`, `MembersSection`, `GroupsSection`, `AuthenticationSection`, `AppsAccessSection`) exported from `@agent-native/core/client/org`. The Team page renders exactly as before.
- a20f0b4: In the redesigned Settings (behind `settings-redesign`), a link to today's tab for an app area, such as `/settings/alerts`, now opens that area on the app's General page (`/settings/app/alerts`) instead of falling back to Profile.
- a20f0b4: Export `ReadOnlySettingValue` from `@agent-native/core/client/settings`, so a template's own Settings rows can show members a value with a lock and a tooltip saying who can change it.
- a20f0b4: New apps scaffolded from the default template open the redesigned Settings full height when `settings-redesign` is on, without their own Back link, title, or language card (the shell has Back to {App}, and core Preferences owns the interface language), and gain a `settings.$.tsx` splat route so `/settings/<page>` links resolve. With the flag off the scaffold's Settings page is unchanged.
- a20f0b4: The scaffolded apps' agent-native-toolkit, context-awareness, and secrets skills describe the redesigned Settings: its page ids and groups, `buildSettingsRoute` links, the `settings-view` application state, and the `open-settings-page` tool.
- a20f0b4: Polish the redesigned Settings › Agent pages (Model, Instructions, Memory, Skills, Files, Sub-agents). Empty groups now show a guided empty state with the action that fills them, and Model starts a workspace with no provider at "Add a model provider" with Add provider and Connect Builder.io. Page, row, and group-heading actions use the toolkit button sizes and variants, rows share one trailing edge, and scope tags are outline badges. Dialogs submit with Enter, stay disabled until valid, show a spinner and a "Saving"-style label while working, and keep a failed save open with the server's message. The sub-agent connect and edit forms use labeled toolkit fields.
- a20f0b4: Settings polish follow-ups:
  - `@agent-native/core/client/settings` now exports `KeyValueDialog` (with `KeyValueDialogMode` and `KeyValueDialogProps`) and the `ApiKeyEntry` and `ApiKeysListing` types, so an app page can add or replace a key in place instead of sending people to Settings › API keys.
  - `NewKeyMenu` takes `size` (`xs`, `sm`, or `default`) and `variant` props and no longer restyles its trigger; `triggerClassName` is for layout only. The default is `xs` secondary, the group heading action size. The sub-agent dialog's credential picker uses the dialog control size, and the Dispatch Vault's New button uses `size="default"` instead of size classes.
  - The custom integration dialog shows "Connecting…" and "Testing…" beside the spinner while a connect or test runs.
  - Removed catalog keys that nothing reads anymore: `agentChat.settings.storage.missing`, `agentChat.settings.storage.missingPublicUrl`, `agentChat.settingsOrg.invite.close`, `agentChat.settingsShell.account.newEmailPlaceholder`, and `agentChat.settingsSubAgents.browseDirectory`.

- a20f0b4: Only the organization owner can invite admins: `POST /_agent-native/org/invitations` now refuses an admin's `role: "admin"` invite with a 403, and in the bulk shape lists each such entry under `failed`. A signed-in user with no organization reads `get-infrastructure-status` and sees Organization › Authentication, Apps, Infrastructure, and Audit log only on a single-tenant self-hosted deployment; `/_agent-native/org/me` reports this as `soloDeploymentAdmin`. `fetchProviderModels` now calls the `check-provider-key` action. The Invite members dialog, Email domain auto-join, Shared secret, and Workspace URL rows are localized, and the default scaffold's home page shows the account menu, which holds Log out.
- a20f0b4: With the `settings-redesign` flag on, each catalog integration opens its own Settings page at `/settings/integrations/<id>` instead of a full-screen dialog. The page keeps the Settings sidebar, shows "Integrations › {logo} {name}" in the header with its Connect, Add access token, or Set up action, and has the brand-tinted example prompts (clicking one asks the agent), what it does and what the agent can see, a callout when a provider or admin has to act first, and Connection and Information groups. Connecting stays on the page: OAuth opens in a popup, a token in a dialog, and provider setup in the connect dialog. Browser Back and the breadcrumb return to Integrations, a reload of the page works, and an unknown id shows a not-found state under the breadcrumb. Old Integrations links for a channel go to its Channels page. Channels rows and pages now show each service's brand logo, and channel pages gain the prompts hero, Developer and Category rows, and a copyable webhook URL; Slack's page is the app's Slack settings plus Agent in Slack, with Set up on its row. Builder.io's page shows its logo in the breadcrumb.
- a20f0b4: Settings search fields (the sidebar search, Integrations, Members, and the group people picker) and the MCP integration dialog use the toolkit `InputGroup` instead of hand-positioned icons. The MCP integration dialog now uses toolkit form controls with inline URL validation. What's new uses a secondary button to expand older updates, dialog close buttons are labeled Close, and the local-schedules notice wraps its environment variable on narrow screens.
- c9a1253: Suppress expected Vite import-analysis warnings when loading runtime Agent-Native configuration files.
- bb56060: Run background agent turns as the member who submitted the turn.
- 9199a7f: Standardize chat home suggestions and restore the compact Dispatch app grid.
- f10632d: Let expanded organization pickers fill sidebar footer space.
- 3ac7f50: Match signup Learn more link color to its description in dark and light themes.
- 355870c: Preserve retryable HTTP status on transient Google OAuth refresh failures.
- a20f0b4: Move the toolkit's Button, Switch, Select, and Input to shadcn new-york-v4 sizing. Buttons are 36px by default and 32px at `sm`, with new `xs`, `icon-xs`, `icon-sm`, and `icon-lg` sizes. `outline` is now the v4 bordered outline (`border bg-background shadow-xs`, with `bg-input/30` in dark mode) instead of an accent fill, and a new `outline-destructive` variant (outline with red text) marks destructive row actions; it maps to the design-system `danger` intent with `outline` emphasis. Switch is 32x18 with a `size` prop (`sm` is 24x14), SelectTrigger and Input take `size="sm" | "default"` (32px or 36px), Toggle is 36px (`sm` 32px), and TabsList is 36px. Alert sets `text-sm` on the root, so titles are 14px, and AlertDescription uses relaxed leading. Adds the shadcn `InputGroup` (`InputGroupAddon`, `InputGroupInput`, `InputGroupButton`, `InputGroupText`, `InputGroupTextarea`) for fields with icons or inline actions. Dispatch's local Button, Switch, Input, Tabs, Toggle, and AlertDialog now re-export the toolkit's, so its tabs and toggles follow the same heights and its confirm dialogs stack above toolkit dialogs. The Dispatch app search matches the 32px toolbar buttons beside it. Settings row, retry, and group-heading buttons use `outline` instead of `secondary`; dialog Cancel buttons stay `secondary`.
- 4b62043: Stop deduping `@tabler/icons-react` in app builds so the toolkit icon catalog resolves the Tabler version it was generated from, instead of failing with `MISSING_EXPORT` when the app installs a newer Tabler that renamed icons.
- a20f0b4: The integrations catalog and the custom integration dialog are translated into every built-in locale. The `mcpIntegrations` strings now load from the Core chat catalogs, like `contextXray`, instead of rendering English in every language.
- Updated dependencies [7af9d3f]
- Updated dependencies
- Updated dependencies [230c5f0]
- Updated dependencies [108074a]
- Updated dependencies [a20f0b4]
  - @agent-native/agentkit@0.5.0
  - @agent-native/recap-cli@0.5.48
  - @agent-native/toolkit@0.23.0

## 0.195.0

### Minor Changes

- 5c48dff: Render action changes as grouped, persistent in-chat cards.
- 01329c3: Add automatic personal memory recall and simple personalization settings.

### Patch Changes

- 55c9666: Expose provider logo identities for model selectors through the shared resource catalog.
- 880740b: Match attached Connect AI card spacing and stacking across chat surfaces.
- 8d96fa6: Include bounded action images in MCP tool results without exposing binary data in text or structured content.
- 247c699: Refine the Human Review rollup into a compact, divided list.
- 8f246ad: Allow budgeted action keepalive requests to use PUT as well as POST.
- 55c9666: Expose configured chat model groups and an opt-in explicit recovery state for unavailable stored model selections.
- 5c48dff: Queue approval edit prompts safely and keep saved Mail and Calendar action cards readable.
- 29969ab: Clarify agent summary controls and queued feedback in Human Review.
- 32ce77a: Improve Human Review search and clarify the summary regeneration action.
- Release all public npm packages with a patch version bump.
- aa8193d: Keep OAuth popups navigable from app pages and the MCP sign-in form. Framework pages now send `Cross-Origin-Opener-Policy: same-origin-allow-popups`, so a popup opened on the inert waiting page is no longer severed from its opener and left blank with an "allow popups" error. Validated embed-session responses keep `same-origin`.
- 55c9666: Document the approved inline background-conversation pattern for object-owned AI surfaces, share stable receipt identity across clients and scoped servers, and authorize explicit loading of the exact protected background thread without adding it to ordinary scoped history.
- 9fbf637: Include all grouped-run feedback in Human Review rollups.
- f261320: Keep provider setup retries compact so connected chat surfaces preserve balanced spacing.
- f47133b: Refine shared action cards for Calendar scheduling and Mail drafts.
- d1db66e: Preserve approved action arguments and failed tool-result status when resuming an in-app agent call.
- 9fbf637: Group recurring automation runs in Human Review by resource and search prompt and outcome text.
- 5b7f665: Add breathing room between the file-storage prompt and its connection options.
- 5c48dff: Keep completed action cards visible while related actions run and let users deny approvals without starting a revision prompt.
- Updated dependencies [880740b]
- Updated dependencies [55c9666]
- Updated dependencies [55c9666]
- Updated dependencies
  - @agent-native/toolkit@0.22.3
  - @agent-native/agentkit@0.4.1
  - @agent-native/recap-cli@0.5.47

## 0.194.0

### Minor Changes

- d462819: Move framework chat surfaces to AgentKit while preserving chat history, recovery, context, attachments, model selection, runs, and message actions. This removes the old assistant-ui transcript and stream owners, the `AssistantChat.createAdapter` prop, the public `AssistantMessageActionBar` export, and the adapter APIs `createAgentChatAdapter`, `createCodeAgentChatAdapter`, `createAgentChatRuntimeAdapter`, `codeAgentTranscriptEventsToContent`, and `codeAgentTranscriptHasPendingApproval`, plus their adapter-only options and event types. Use AgentKit `runtime` or `createTransport` for custom chat implementations.
- 21055c8: Add durable suggestion proposals with independently reviewable members and atomic decisions for an exact observed member set.

### Patch Changes

- 797b3e2: Commit one initial collaborative XmlFragment seed atomically and return the winning Yjs state to concurrent editors.
- 7ecd4d7: Bound API key settings reads so stalled requests show an error with a retry option.
- b863d1f: Use stable-ref router links in sidebar tooltips and menus.
- a902062: Isolate first-party auth sessions and clear lingering embed identities on logout.
- b0b63b4: Trace Undici in Node server builds so SSRF dispatchers load in deployed functions.
- 214d5f3: Give human-review votes and summary actions immediate, accessible feedback.
- fdb196d: Restore Chat's missing model provider recovery and attachment-preserving retry.
- e76947b: Return safe, source-specific Figma errors and preserve composer feedback for failed context operations.
- Release all public npm packages with a patch version bump.
- adc7497: Anchor storage setup to upload controls and keep it hidden until an upload is requested.
- 467eb06: Register a configured workspace app when its organization owner first opens it.
- fce2dc1: Keep organization app-access recovery controls available when a workspace app is disabled.
- b0760e2: Keep action widgets visible when transcript text is truncated, preserve full widget results through ledger recovery, add the missing release ledger columns, log framework request errors that escape Nitro's Vite middleware, and treat incoming read resets as client disconnects during development.
- adc7497: Show storage setup only after a user requests a file upload.
- b0760e2: Render action chat widgets in AgentKit history with their stored inputs and results. Let actions select successful calls and project the bounded result fields needed to restore each widget.
- 57d1d39: Show Human Review thread owners' email addresses and open linked designs in the editor.
- ed3801e: Remove nonessential source comments.
- 9ec2f7e: Include the workspace app id in Google OAuth state so the root callback relay can return to the initiating app.
- 8362ebb: Support app-shaped loading skeletons for built-in app layouts.
- a17945a: Recover interrupted write tool results before retrying side effects.
- a050521: Preserve queued resource uploads when checking storage availability fails.
- 77acfd8: Keep organization-scoped observability previews from resolving user credentials.
- e7b6fcc: Share a joined quick-copy control, People/Agents tabs, and agent destinations between Content and Clips.
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
  - @agent-native/agentkit@0.4.0
  - @agent-native/toolkit@0.22.2
  - @agent-native/recap-cli@0.5.46

## 0.193.0

### Minor Changes

- 7e8a10a: Gate chat until an LLM provider is ready and show setup choices when file storage is missing.

### Patch Changes

- cbf8a52: Use the local workspace app ACL when no Dispatch directory is mounted.
- 9328cc4: Give API key provider buttons a soft background and comfortable spacing.
- Release all public npm packages with a patch version bump.
- 8700be3: Report Slides file storage readiness and omit absent AgentKit runtime run IDs.
- c625807: Remove external-link markers from internal settings navigation.
- 7582194: Tighten local development sign-in spacing and collapse account options by default.
- a6b2eaa: Forward typed action cooldowns through HTTP Retry-After headers.
- 2a87449: Make human review responsive and clearer, add search and artifact filtering, and allow the configured super-organization's admins to review other organizations without cross-tenant writes.
- 0f78444: Remove framing around API key provider logos.
- 8791318: Preserve canonical identity in analytics and align Clips completion events with recording attempts.
- d12f203: Human review runs are easier to scan, and expanded details have a clear boundary.
- d52c9a0: Use TypeSafe AI's Jev logo in API key settings.
- af54bfd: Clarify usage trends with a labeled value axis and group repeated recent prompts by occurrence.
- Updated dependencies [7e8a10a]
- Updated dependencies
  - @agent-native/toolkit@0.22.1
  - @agent-native/agentkit@0.3.1
  - @agent-native/recap-cli@0.5.45

## 0.192.0

### Minor Changes

- ef74b99: Expose Builder referral links and show eligible invite prompts in credit usage and limit cards.
- dbb10d5: Remove the split auth marketing UI and route app entry pages through the shared sign-in flow.
- 39a89d0: Add bounded composer reference contracts and authenticated cross-app reference reads for Design and Slides, preserving receiver-owned access checks and explicit failures.
- 39a89d0: Add declarative context dialogs for URL attachment and paginated multi-selection, with validation, cancellation, batch callbacks, and localized shared controls. Expose the additive picker configuration through AgentKit while preserving existing submenu pickers.

  Add read-only website composer source requests and the server-side readComposerWebsiteSource helper. Website references retain bounded extraction status, warnings, rendering provenance, and explicit truncation, while failed extraction remains an error.

- da924dd: Improve public share previews and recover Calendar bookings safely after Zoom outcomes.

### Patch Changes

- 05a2561: Persist localhost bridge tokens only after the bridge successfully binds and authenticates.
- 05a2561: Keep visual-edit bridge credentials paired across repeated app opens and explain how to recover when a running bridge has a different token.
- 251bd76: Do not treat deployment fallback credentials as a completed Builder OAuth connection.
- 3e2cecb: Use the cataloged Agent Chat key for the Observability expand label.
- 7eb9cbb: Scope provider credentials to their endpoints, coalesce workspace app access checks, and support desktop authenticator sign-in.
- d9f5334: Include chat turn IDs in running events so app chrome can track overlapping turns.
- 39a89d0: Allow localized search placeholders for composer context categories and reuse the standard upload label for the first context-menu action.
- 39a89d0: Add connected cascading composer context menus with declarative search, list, link, loading, error, retry, and pagination behavior, plus persistent footer actions for existing links or modal workflows. Apps register authorized data loaders or local choices instead of rebuilding picker views. Allow host file-staging adapters through PromptComposer and AgentKitComposer while preserving shared upload controls and attachment chips, with an opt-out from ordinary text-file inlining when the host already extracts those files. Document scope resets and source-version refreshes, with localized defaults in every supported locale.
- 39a89d0: Add opt-in hierarchical composer context menus, attachment status and recovery controls, bounded immutable context snapshots, and a shared quick-start submission handle. AgentKit awaits a beforeSend hook and carries the same context metadata through immediate and queued submissions. Composer drafts, files, and context can be staged before provider setup while submission remains gated; hosts can use `submissionDisabled` without disabling staging.
- b3d823e: Use the Agent Chat catalog key for the observability expand label.
- Release all public npm packages with a patch version bump.
- 516469d: Keep existing-account mode selected when a Builder connection attempt fails.
- 3df50a1: Allow apps to disable raw browser-session tools with `frameworkTools.browserSessions`.
- 3df50a1: Show one recent usage prompt per chat turn.
- 39a89d0: Add shared prompt-home layout, controlled template/recent library tabs, and template cards with semantic design-system controls, native link slots, and explicit loading, empty, and error states. Include home geometry in Toolkit styles and the app-shell ejection unit, with localized component documentation.
- 39a89d0: Add a shared semantic template preview dialog with an inset viewport size, responsive thumbnail rail, keyboard selection, explicit loading/error/empty states, and app-owned rendered content. Align template menus beside captions, reveal them on hover or keyboard focus while keeping them visible on touch devices, and preserve direct primary activation and consistent card dimensions.
- 51ea25f: Prevent concurrent or unreadable memory-index updates from silently dropping entries.
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
  - @agent-native/agentkit@0.3.0
  - @agent-native/recap-cli@0.5.44

## 0.191.0

### Minor Changes

- 6ff4d47: Export the CDN-safe upstream status mapper for Builder-backed JSON routes.

### Patch Changes

- 6ff4d47: Include Android's resizing visual viewport policy in the default app shell.
- 8aee298: Revoke Better Auth sessions and clear stale cookie scopes on logout.
- caf68f7: Fit real Design and Slides canvases inside Human Review previews.
- Release all public npm packages with a patch version bump.
- 6ea2df9: Use the existing localized expand label in observability review previews.
- 6ff4d47: Private blob providers can resolve credentials from request context.
- 51ea6c2: Align assistant message feedback and backend actions into separate groups.
- 04b3a91: Bound first-run onboarding summary loads so a stalled response cannot leave the setup screen on its skeleton indefinitely.
- 6ff4d47: Apply safe request handling to SSRF-safe cross-origin redirects.
- 6ff4d47: Open links in AgentChat messages in a new tab.
- 6ff4d47: Stop agent turns after three tool errors that repeat across changing arguments.
- 6ff4d47: Render OAuth account ownership conflicts as safe, readable callback errors.
- Updated dependencies
- Updated dependencies [6ff4d47]
  - @agent-native/agentkit@0.2.13
  - @agent-native/recap-cli@0.5.43
  - @agent-native/toolkit@0.21.3

## 0.190.0

### Minor Changes

- 0c3cac4: Allow app-owned handlers to run in the signed recurring-job sweep, and respect explicit AgentSidebar placement, open-state, and shortcut settings.
- 946b570: Add a share success callback to the shared resource sharing control.
- e5583a2: Add real Design and Slides previews to human-review rollups.

### Patch Changes

- 9de280f: Add the floating copy button to the annotated-code block (commented/walkthrough code snippets), matching the standard code block.
- b412854: Include the SSRF dispatcher runtime dependency in serverless bundles.
- 98a7a33: Use bounded thread context to select relevant Jev tools, memories, and app references before the first model response.
- 28fe02e: Show the Builder connect choice above the model menu and New Deck dialog.
- 81695b5: Keep hosted-harness chat on the app's configured sidebar side.
- bd4b018: Keep the dev React Router browser manifest relative for same-origin requests, so client-side navigation works behind dev proxies that rewrite the Host header.
- 01660b0: Show a Builder subscription link when AI credit limits stop a chat run.
- cd72523: Join server tracking events to the authenticated request identity when the explicit user matches it.
- e2f6175: Fix the expand label in Human Review thread details.
- Release all public npm packages with a patch version bump.
- 2ba6541: Link Custom keys to API settings and keep the composer surface opaque.
- 5087a2c: Expose the recurring background-jobs switch through typed runtime configuration.
- c8d264d: Remove Cloudflare Pages from workspace deploy and the standalone build. `agent-native deploy` now defaults to Netlify and accepts only `netlify` or `vercel`. `NITRO_PRESET=cloudflare_pages` fails like any unsupported preset. Standalone Cloudflare Workers stays on `cloudflare_module`.
- 790e245: Render first-party app social preview images with the sign-in page's Geist branding, headline, and open-source badge; label share cards with the full product name, site name, and URL; version the image URL from the sign-in copy so edits refresh cached previews automatically; and keep `Cross-Origin-Resource-Policy: cross-origin` on OG image responses so browser-rendered link previews no longer show a broken image.
- Updated dependencies
- Updated dependencies [2ba6541]
  - @agent-native/agentkit@0.2.12
  - @agent-native/recap-cli@0.5.42
  - @agent-native/toolkit@0.21.2

## 0.189.0

### Minor Changes

- debfb07: Add a primary Continue with Agent-Native action to hosted sign-in pages.
- d261070: Add per-message and beginning-of-chat revert controls for autosaved resources.

### Patch Changes

- Release all public npm packages with a patch version bump.
- 34822ca: Improve the mobile login and signup layout.
- 08b601f: Integration logos now use each brand's current official mark. Figma, GitLab, Cloudflare, PayPal, Supabase, Neon, Asana, Canva, Intercom, Netlify, Zapier, Notion, HubSpot, Stripe, Linear, Sentry, and GitHub replace single-color glyphs or retired versions; FullStory, PostHog, monday.com, and Grafana replace stand-in, outdated, or 16px favicon icons; and the Jira entry and Jira API key tile show Jira's mark instead of the Atlassian triangle. Intercom, Linear, Netlify, and Sentry now invert in dark mode like the other dark marks, and Notion no longer does because its official block carries its own white face.
- Updated dependencies
  - @agent-native/agentkit@0.2.11
  - @agent-native/recap-cli@0.5.41
  - @agent-native/toolkit@0.21.1

## 0.188.0

### Minor Changes

- 9b9c28d: Add LaunchDarkly flag support: `@agent-native/core/launchdarkly` for server code, `@agent-native/core/client/launchdarkly` for browser hooks (`useLaunchDarklyFlag`, `useLaunchDarklyFlags`), and the auto-mounted `get-launchdarkly-flags` action. Configure with the `LAUNCHDARKLY_SDK_KEY` environment variable; every read fails closed to its caller-supplied default when unconfigured, unreachable, or slow.
- 7045f6f: Use Builder-managed embeddings and video generation through an existing Builder connection.
- 556f777: Show Builder workspace credit balances and daily or monthly plan usage in Usage settings.
- 21fdd86: Add the shared serializable icon contract and reusable resource icon picker.
- 21fdd86: Add persistent workspace icons with organization-admin updates, optimistic client integration, switcher and settings rendering, and cross-app identity revision propagation.

### Patch Changes

- 1795ecc: Rotate sessions after two-factor changes, filter resolved action surfaces by `initialToolNames`, preserve rich MCP chat submits, and retain device-flow catalog scope.
- 7e1176b: Scope local visual-edit handoffs to the requested design.
- b839826: Expand human review inline with saved Design previews, full thread history, and quick feedback actions.
- f2bc8d1: Report exact Builder gateway credit usage in usage metrics and link credit-limit errors to Builder's subscription page.
- dbb860c: Backfill safely attributable observability runs and bound organization review reads.
- 3afa6be: Propagate canonical Better Auth IDs to authenticated tracking events.
- e645755: Fail release migrations when the database role cannot apply schema changes.
- 4917d34: Refresh the Builder model catalog and display current versions in the chat picker.
- 14124f8: Keep the DOCX parser dependency discoverable in serverless builds.
- dbb860c: Expose admin-scoped observability review actions
- 8fe9fc4: Stop writing the first-run onboarding eligibility marker for apps whose first-run onboarding is positively known to be off at build time (e.g. Plan), so "completed ÷ eligible" onboarding metrics no longer include rows that can never complete. Apps where the build couldn't resolve the mode keep writing the marker, matching today's behavior.
- 70e612f: Raise the default delegated agent-loop token budget (used by cross-app A2A calls and same-app `ask_app` MCP calls) from 750,000 to 5,000,000 input tokens. The old value was too low for tool-heavy apps and could trip `run-input-token-budget` on every multi-step turn regardless of task size.
- 3866afe: Restart supervised dev servers that remain alive while serving persistent server errors.
- 7e1176b: Preserve startup app state while first-run onboarding eligibility resolves and report unreadable onboarding cookies.
- 61a856b: Close three remaining gaps in the hosted-database guard (refuses to silently open ephemeral PGlite when `DATABASE_URL` is missing on a real deployment): Cloudflare Pages' generated worker entry now sets `globalThis.__env__` like the Module/Workers entry already did, a production Node/Docker server now refuses PGlite too, detected via a process-local marker set the first time the real Nitro app wires up its H3 routes rather than an env-var heuristic that would misfire during builds, and Better Auth's database adapter setup now calls the same guard, so signup/login fail with `HostedRuntimeLocalDatabaseError` instead of attempting PGlite. Also exempts migration-authorized runtimes (`withMigrationRuntime()`) from the guard, since a durable background worker can be a real hosted invocation and is allowed to touch PGlite there.
- bdd0a03: Fix the hosted tools-only harness being silently unavailable in production for apps that only set `harness` in `agent-native.config.ts` (Chat, Mail, Analytics, Calendar). `loadHostedHarnessConfig` read that file from disk at request time, but a deployed serverless function never ships `agent-native.config.ts`/`agent-native.json`, so the read resolved to "not configured" instead of the app's actual setting. The setting is now resolved once at build time from the same app config the client bundle uses and embedded into the server bundle; the disk read remains as a fallback for dev servers and `agent-native start`, where the config file is actually present.
- fe7e5d8: Hide empty human-review preview placeholders.
- 451cb34: Hide human-review thumbnails when the list has no renderable preview content.
- Release all public npm packages with a patch version bump.
- 83dffad: Keep deployment environment credentials out of API key settings and disable hosted model-provider key fallback.
- c2a760f: Emit `invite_sent` and `invite_accepted` tracking events for the org invite lifecycle, so referral/virality reporting can see team growth. Register the telemetry with the request's `waitUntil` (or a bounded wait when no request is reachable) so a serverless runtime can't freeze the function before the event ships.
- 67b921b: Show an organization loading placeholder in every app sidebar while organization data loads.
- 5cd90b0: Remove the close button from first-run onboarding.
- ac01083: Align PDF attachment limits with their serialized message budget.
- dbb4504: Stop connect flows from waiting after an OAuth popup is cancelled.
- 3afa6be: Keep tab-scoped agent chat state tied to its tab while identity resolves and let replay capture continue until explicitly stopped or capped by configuration.
- 7e1176b: Authenticate local visual-edit bridge registration and pending handoffs with a design-scoped capability.
- 3afa6be: Track replay upload quota pauses and oversized-event drops with bounded reason metadata so incomplete recordings can be diagnosed without capturing replay content.
- 3afa6be: Remove the default replay duration cap while preserving configured limits and safely stopping at Analytics' per-recording chunk ceiling.
- 3afa6be: Track first-run onboarding abandonment so setup drop-off is distinguishable from a completed or dismissed flow.
- a15d38f: Keep app-driven continuations in their original chat, reopening closed tabs and waiting for delivery confirmation. `useGuidedQuestionFlow` also exposes `refetchPendingQuestion` so a caller can force a fresh check instead of racing the reactive app-state read before dropping run correlation.
- 74fc788: Keep an explicit PGlite database URL in test processes ahead of inherited hosted database aliases for runtime, migration, and Drizzle configuration.
- 185e25d: Move the auth page Learn more link beside the marketing copy and show a GitHub icon on the open-source project link.
- b5efaf9: Show captured trace span details and open full conversations from observability.
- Updated dependencies [21fdd86]
- Updated dependencies [4917d34]
- Updated dependencies
- Updated dependencies [ac01083]
- Updated dependencies [21fdd86]
- Updated dependencies [185e25d]
  - @agent-native/toolkit@0.21.0
  - @agent-native/agentkit@0.2.10
  - @agent-native/recap-cli@0.5.40

## 0.187.0

### Minor Changes

- 48387db: Add `anonymousApplicationState` to `createCoreRoutesPlugin`. When enabled, `/_agent-native/application-state` scopes a request without a session to the `anonymousOwner` the app resolves, instead of answering 401, so a guest chat's navigation, URL and composer preference sync works for anonymous visitors. Off by default.
- 68a89eb: Route Jev requests through enabled Builder spaces and allow direct Jev keys, while keeping Jev-only Mail features hidden when unavailable.

### Patch Changes

- 07a6277: Record a tool call interrupted by a run abort as an interrupted (unknown) outcome instead of a failure, so a resumed chunk goes through the ledger recovery and interruption budget rather than re-dispatching a write that may already have happened.
- 97d8280: Make review comment and reply submissions safe to retry without duplicate comments or notifications.
- 212d1b3: Preserve temporary credential lookup failures when discovering embedding providers.
- 92d3374: Keep bring-your-own chat runtimes running past the periodic in-run save. The save no longer forces the live assistant message to complete, so external-runtime turns longer than five seconds stop reporting as stopped and their in-flight tool calls are no longer marked interrupted.
- 039d52c: Add an opt-in directory page for multi-app workspace deployments.
- 69fac98: Keep the core composer runtime adapters stable across re-renders, so composer effects keyed on them (such as the voice button's `voice-input-preference` read) no longer re-run and refetch on every render.
- ee516e2: First-run "Choose your setup" screen now shows separate "Create Builder.io account" and "Sign in with Builder.io account" buttons instead of a consent popover.
- a10ae73: Avoid showing the same failed-turn error in both chat text and its recovery notice.
- 15e304f: Flatten a tool input schema with a top-level `anyOf`/`oneOf`/`allOf` into one object schema before it reaches the provider. An action whose Zod schema is a union compiled to a root `anyOf`, which the AI SDK engines forwarded unchanged and Anthropic rejects for the whole request; the native Anthropic translator dropped the composition and left the model with no parameters. Both translators now merge every branch's properties at the root. The root and each composition are conjuncts: a property declared more than once across them, or across `allOf` branches, becomes an `allOf` of its variants, while `anyOf`/`oneOf` branches that declare a property differently give an `anyOf`. `required` is the intersection over `anyOf`/`oneOf` branches and the union over `allOf`; `additionalProperties: false` survives when every `anyOf`/`oneOf` branch or any `allOf` branch declares it, and `patternProperties`, `propertyNames`, `minProperties` and `maxProperties` carry over where they combine exactly. Branch keywords a flat root cannot express are dropped, so the flattened schema over-approximates the action's own schema, which still validates the call.
- a10ae73: Invalid user share recipients now return a client error instead of a server error.
- a10ae73: Keep Google sign-in timeout errors user-facing across all locales.
- 11208d2: Let Jev skip irrelevant tool and skill prefetch candidates, and expose the existing per-user Jev credential lookup to server actions.
- 30aa31d: Honor an explicit `AGENT_CHAT_DURABLE_BACKGROUND=true` (with `A2A_SECRET`) on long-lived Node servers that carry no hosted-platform marker, and add `AGENT_NATIVE_SELF_DISPATCH_URL` so a deployment can send its self-dispatches over loopback instead of through its public edge.
- ee70391: Resolve workspace databases from each app's isolated runtime URL.
- 9a22c5b: Abort action response parsing when the request is cancelled.
- Release all public npm packages with a patch version bump.
- 1b15104: Replace the free-text "Set domain" flow on the Team page with a single one-click "Enable for @domain" button, since the server only ever accepts the owner's own eligible domain.
- ddabced: Preserve in-flight integration campaigns and A2A continuation identities when durable dispatch is temporarily unavailable, while retaining explicit rollout cancellation.
- c3c47f1: Render saved app outputs inline in a simpler thumbs-first human review feed.
- eb6523c: Allow deployments to override the maximum connections in each framework database pool.
- eb6523c: Constrain AI SDK provider requests to their configured endpoint origins.
- fe9609c: Secure and document the tab-free visual-edit handoff for coding agents.
- 34ad348: `ShareDialog` no longer loads resource shares or the org member list while it is closed. Hosts that mount one closed dialog per list row (such as every Slides deck card) were firing one `/_agent-native/org/members` request per row on page load. `useShareQuery` accepts an optional `enabled` argument.
- 1b889ff: Add `withShareLinkAttribution` to `@agent-native/core/client/sharing` — a small shared helper for tagging a minted public share URL with `ref`/`via` viral-attribution params.
- 7e014ff: Carry `approvedToolCalls` through `agent-chat:submit` to the run config, so an app that resumes a paused `needsApproval` call from the browser has its grant consumed instead of the model asking for approval again. The resume is sent as a hidden protocol continuation. Inside a Builder frame or an MCP App embed the resume stays with the app's own chat, which owns the paused run; neither Builder's chat nor the MCP host's chat can carry the keys.
- 45ad5f3: Keep root-only workspace apps at their root after sign-in. The app runtime now reads its home path from the workspace manifest entry (the same `/` the launcher already links to), so the root auth handoff no longer redirects signed-in visitors to a `/home` route the app never defined.
- Updated dependencies
  - @agent-native/agentkit@0.2.9
  - @agent-native/recap-cli@0.5.39
  - @agent-native/toolkit@0.20.9

## 0.186.0

### Minor Changes

- 6ce7517: Let users choose an installer group, then install all or a selected subset.

### Patch Changes

- 69ecbfb: Derive Builder design-system readiness from the indexed document count instead of the drifting `builderStatus` field. `hydrateBuilderDesignSystemReference` now reads `docCount` from `/design-systems/v1/:id?includeDocumentCount=true`, and a count that cannot be read fails loudly instead of being reported as zero. Adds `fetchBuilderDesignSystemDocumentCount` and `isBuilderDesignSystemReadyByCount`.
- e383d8d: Fix user-controlled Labs toggles by exposing the mutation through the shared action HTTP surface and sharing registrations across development module instances.
- 67cf8bb: Expose lazy-chunk recovery helpers and the AgentSidebar entrypoint for deferred app surfaces.
- Release all public npm packages with a patch version bump.
- be380fa: Allow Ollama endpoints on the local network (not just localhost), fetch real installed models instead of a static suggestion list everywhere Ollama models are shown, and silently strip a copy-pasted `/v1` suffix from Ollama addresses.
- Updated dependencies
  - @agent-native/agentkit@0.2.8
  - @agent-native/recap-cli@0.5.38
  - @agent-native/toolkit@0.20.8

## 0.185.0

### Minor Changes

- c0d9e4b: Add `fetchBuilderDesignSystemTierLimit`, `designSystemTierUpgradeUrl`, `assertBuilderDesignSystemCodeIndexingAllowed`, and the `@agent-native/core/client/design-system-tier-limit` helpers so apps can show a design-system plan/tier cap and an upgrade link before create, surface the same information from a 402 on the create/index call, and enforce the Enterprise-only code/GitHub indexing entitlement server-side (not just in the UI).

### Patch Changes

- 5ffb783: Cut action latency and false failures across apps: batch per-user profile and
  feature-flag settings reads into one query; on production serverless runtimes,
  answer the app-origin SSE route with 204 for current clients (a held stream
  there forced a cold container per connection) and report a `poll-live`
  capability so sync consumers keep their normal cadence over `/poll`; stop
  `refetchInterval` polling after a 401; skip feature-flag and labs queries until
  the session is authenticated; attribute `http.response` telemetry to the app;
  and add cold-start, hidden-page, and timeout fields to `action.response`.
- d5f0a95: Start apps with an app-shaped skeleton while session data loads immediately.
- 2427195: Add Claude Opus 5.5 and GPT-6 Sol/Luna to direct API model selection.
- e7ccf40: Workspace agents now confirm a new app is actually served at `/<app-id>` before reporting it created, name the host's run/dev command when the preview isn't running the workspace gateway, and grant "admin" through app roles instead of hardcoding an email in an auth hook.
- e7ccf40: Fix sign-up/sign-in bouncing back to the sign-in page when an app is served behind an https proxy with no configured public URL (e.g. a Builder Code cloud dev container rendered in the Builder editor iframe): Better Auth's session cookie and its origin/CSRF allowlist are now evaluated per request instead of once at boot, so a proxied https request gets a cross-site-safe cookie and is trusted as same-origin.
- 0289143: Defer provider setup UI and load core locale messages on demand.
- 8f27701: Dev servers now watch files for apps checked out inside a `.claude/` (or other normally ignored) directory, such as `.claude/worktrees/*`. The default watch ignores are matched below the app root instead of against its ancestors, which previously disabled HMR entirely for those checkouts.
- 8f27701: Map Figma's LINEAR_BURN blend mode to `multiply` instead of `plus-darker`, which Chromium does not support and silently drew as normal blending.
- f6e9555: Fix direct Jev tool prefetch requests and add a repeatable live selection eval.
- 3c865d5: Lazy-load the agent sidebar and changelog command-menu surfaces so app layouts can hydrate before chat UI.
- Release all public npm packages with a patch version bump.
- 8c954cd: Route mounted workspace root data requests through app paths on Netlify and Vercel.
- 3d5741f: Single-key `getSetting` reads throw again on a corrupt stored value instead of reporting it as missing; batched `getSettings` reads still isolate a corrupt key.
- 86e35d8: Share first-run onboarding completion across configured sibling app domains.
- 70f20c0: Fix mounted React Router root data requests.
- 6806425: Tighten the first-run setup cards: both columns now list only required, recommended, and Builder-only capabilities, and each manual row is a single-line name instead of a wrapped key description.
- ae65b08: Preserve mounted React Router root data redirects.
- Updated dependencies [2427195]
- Updated dependencies [d43305d]
- Updated dependencies
  - @agent-native/toolkit@0.20.7
  - @agent-native/agentkit@0.2.7
  - @agent-native/recap-cli@0.5.37

## 0.184.0

### Minor Changes

- 113944d: Add a `reasoningEffort` field to job/automation frontmatter, the background automation runner, `automations/service.ts`, `list-automations`, and the `manage-jobs` tool, so a scheduled automation can request an explicit reasoning effort instead of always inheriting the model's default.
- 71f6bbd: Add an opt-in ChatGPT subscription lab for experimental Codex engine access.
- 113944d: Stop forcing `reasoning_effort: "none"` for GPT reasoning models (Luna/Terra/Sol) with tools on the Builder gateway. That guard was based on a Chat Completions rejection actually observed on a different engine/proxy; the Builder gateway has always routed these models through OpenAI's Responses API, which accepts reasoning effort alongside tools — confirmed via a live gateway request. The requested effort is now forwarded unconditionally.
- 7e74d2a: Add a human review loop for inspecting agent asks and answers, recording feedback, and drafting instruction updates for review.

### Patch Changes

- 3f2a2fb: Allow users to enter a custom role when selecting Other during onboarding.
- 00d6183: Keep local-development sign-in options collapsed until a user expands them.
- f447d33: Keep externally hosted React Router and TanStack Query runtimes in prebuilt serverless SSR bundles.
- 2055930: Keep hosted Google sign-in popups navigable across the provider redirect.
- aaf9958: Preserve Google Analytics custom browser events when Google Tag Manager is configured.
- 97385a2: Keep production SSR builds on one Core/React singleton graph and make serverless size checks ignore platform-selected Resvg binaries.
- 6595223: Keep public framework route context out of application server bundles.
- Release all public npm packages with a patch version bump.
- e973e00: Move the auth form to the top of the page on small screens and hide the learn-more link there.
- facaeaa: Reconnect expired Streamable HTTP MCP sessions and replay the failed request once.
- 45c137b: Ship the external React runtime required by serverless SSR chunks.
- 865cac6: Ship react-dom, react-router, and @tanstack/react-query alongside the external React runtime required by serverless SSR chunks, so the deployed function and the prebuilt route chunks resolve one shared instance of each instead of two.
- 1cab0d0: Keep production SSR React Router imports external and resolve them from the consuming app so serverless route hooks share the ServerRouter context.
- Updated dependencies
- Updated dependencies [e973e00]
  - @agent-native/agentkit@0.2.6
  - @agent-native/recap-cli@0.5.36
  - @agent-native/toolkit@0.20.6

## 0.183.0

### Minor Changes

- 1aaaa25: Add `runtime.frameworkRoutePrefix` (`AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX`) so a deployment can serve framework routes under a public namespace other than `/_agent-native`. Route registration keeps the internal name; the public prefix is translated once at the request boundary, and every URL the framework hands out (client requests, sign-in and OAuth callbacks, magic links, self-dispatch, deploy adapter routing) is built with the configured prefix. Unset, nothing changes.
- 01f4ecb: Add optional Jev-powered tool and skill prefetching, Builder proxy support, and TypeSafe API-key setup.
- a1e550b: Add UI-only GDPR and CCPA privacy request controls and hide account-level destructive actions from agents.
- 1f4c3eb: Unify branded sign-in and sign-up pages around a shared two-panel layout with the existing WebGL visual on the left.

### Patch Changes

- 8896610: Add sampling metadata to browser action response telemetry.
- 7123aff: Document single-app and workspace output-audit flows and reject stale prototype/canvas plan writes before persistence.
- 93d3a58: Keep AgentKit chat streams causally ordered across refreshes and settle streamed work when runs complete, fail, or cancel.
- 5773315: Let non-Builder visitors open template alpha badges to share feedback about active development.
- d956241: Use the compact Connect action and brighter primary badge for the featured Builder.io integration row.
- 3aff346: Preserve the Builder existing-account login fallback across server runtime boundaries.
- e89db81: Keep Builder.io in the integrations grid and remove its connection-readiness label.
- 58ab3d6: Emit canonical lowercase `snake_case` aliases for legacy tracking event names while retaining the original events for dashboard migration.
- 03a95c4: Keep embedded URL-backed Design previews available under COEP and carry auto-layout structure moves through the guarded source handoff.
- 183547e: Allow canvas consumers to paint pinch-zoom frames imperatively and commit the final zoom after the gesture settles.
- 1c19d3b: Keep direct shared-resource access working in embedded deployments without org membership tables.
- 3e27c13: Keep Design URL preview connections reliable through focused React edits and hot reload.
- 8057255: Isolate Dispatch "All apps" workspace resources per organization so one organization's edits no longer overwrite what another organization's agents read.
- 6fbbdc3: Enable Builder-managed Jev in production behind an Agent-Native rollout flag and rename its onboarding capability to Decision model.
- 8b48456: Preserve first-run onboarding after a new-user magic-link redirect.
- 2655b30: Treat the mounted deployment root marker as the app root so auth handoff works on unified Vercel deployments, keep trusted server asset references paired with preview client artifacts, and add opt-in TOTP authentication with QR setup and backup codes.
- 6c59bb1: Fix Slack integration runs so deployment bot credentials are selected safely, verified Slack identities retain their user context, local app delegation reaches sibling apps, structured Content intake cannot silently drop supplied fields, and progress streams complete without leaving threads stuck as working.
- aae373c: Keep the Node package entry server-safe while preserving root server exports, so headless CLI apps load without a React installation while auth pages still render when used.
- 4167cef: Keep OAuth waiting popups navigable until the provider sign-in page opens.
- 49172c7: Expose pending visual edits through the paired local Design bridge so a coding agent can retrieve the handoff without the Design tab.
- Release all public npm packages with a patch version bump.
- 2655b30: Brand MCP OAuth client registration with app identity and support authorization-server metadata hints.
- 694d6b4: Add session-linked onboarding role outcomes and bounded action failure telemetry.
- 5adca82: Align the featured integration recommendation badge beside the provider name and tighten its size.
- 301be50: Route Google OAuth completion back to the correct Agent-Native desktop release channel.
- 85c432a: fix organization member search by display name
- f8969ca: Keep chat attachment chips readable and removable when filenames or MIME types are long.
- 9aa4fec: Show share-dialog titles when link tabs are present and avoid a redundant single Link tab.
- 15ec2fb: Keep chat lifecycle state and queue rows clear of stale UI overlap, and reserve space for the share dialog close control.
- 49172c7: Keep the local Design visual-edit bridge paired with its connection across daemon restarts.
- a40f522: Add weighted server action telemetry and mirror timing events into OpenTelemetry.
- 93d3a58: Settle AgentKit assistant messages at terminal boundaries and preserve queue mutation intent across overlapping requests.
- f1de62e: Show expired or invalid email verification links on the sign-in recovery state.
- 8d2276f: Keep the remaining chat tab visible after another tab is closed.
- 22b54e6: Allow signed-out visual-edit embeds to reach capability-scoped frontend actions so URL-backed source reads and writes can verify their embed token.
- e0745b9: Read new user emails on Better Auth's active transaction during sign-up, and let users expand notification details in the bell menu.
- 62816b1: Keep WebMCP registration working in browsers without `Object.hasOwn`.
- 80429c7: Let apps translate chat tool row labels. Rows previously derived their label from the action name itself (`get-case` read "get case"), which no catalog could reach, so every non-English app showed English action names. Rows now read `agentChat.toolLabels.<action>` when the app defines it, and the derived name stays the fallback. The same lookup covers the shared conversation renderer and the live activity status line, which previously showed the stored English "Running <action>" regardless of locale. Core's own catalogs gain `activity.reasoning` and `status.runningTool` in every built-in locale.
- 412dbf5: Make hosted visual editing open from a signed-out browser with a reliable local bridge handoff.
- Updated dependencies [93d3a58]
- Updated dependencies [93d3a58]
- Updated dependencies [93d3a58]
- Updated dependencies [58b0779]
- Updated dependencies [3ecc476]
- Updated dependencies
- Updated dependencies [15ec2fb]
- Updated dependencies [93d3a58]
  - @agent-native/agentkit@0.2.5
  - @agent-native/toolkit@0.20.5
  - @agent-native/recap-cli@0.5.35

## 0.182.1

### Patch Changes

- ffafd84: Add `compileUserRegex`, `testUserRegex`, and `analyzeRegexSource` to
  `@agent-native/core/shared` for evaluating regular expressions that come from an
  agent or an end user rather than from source.

  `new RegExp(source).test(value)` is not a bounded operation, and JavaScript has
  no way to time a match out once V8 is inside it. A pattern an LLM routinely
  writes to mean "at least two words" — `^([A-Za-z]+\s?)+$` — is 17 characters,
  compiles cleanly, and backtracks exponentially: a 26-character non-matching
  value already costs ~750 ms and the cost doubles with every further character.
  Stored on a form field it froze the respondent's tab and, because the same
  pattern was re-checked on submit, the request handler's event loop with it.
  Capping the input length does not help, because the blowup is reached well
  inside any sane cap.

  `analyzeRegexSource` recognises the ambiguity signatures that cause
  super-linear backtracking (nested and adjacent overlapping repetition, nullable
  parts under an unbounded repeat, overlapping single-atom alternatives) and
  refuses those patterns instead of running them. Patterns it clears are still
  evaluated against a capped input. `testUserRegex` returns a tri-state result so
  "did not match" and "was not evaluated" stay distinguishable — collapsing the
  second into the first is how an unenforceable rule silently becomes an
  enforced-looking one.

- c40c9e0: Prevent Builder connect popups from racing their refreshed signed URL navigation.
- 4dcc031: Let the agent render the Builder connect card on the first request in local
  dev. `connect-builder` is registered in every registry that receives the
  browser tools, but its name reached the first-request tool list only through
  the hosted-only handoff, so a local `npx` app answered "connect Builder for me"
  with no tool and no chip while the composer and setup card still offered
  "Connect Builder.io".
- 5ede9f7: Keep editor recovery bases stable and combine non-overlapping concurrent edits before asking the user to recover a draft.
  Keep optional Node SQLite cache code from breaking Cloudflare Pages bundles.
- b6857ea: Improve Design review comments with Figma-style reactions, filtering, reopen and undo controls, image attachments, mentions, and movable canvas pins.
- d157801: `pnpm action db-query` now forwards to the running local dev server instead
  of failing when PGlite's single-process lock is already held by `pnpm dev`.
  The forwarded query runs through the same validation and row scoping as the
  in-process path, using the caller's resolved identity, and falls back to
  opening the database directly when no dev server is running or a custom
  `--db` directory is given.
- 88b143c: Fix chat stream replay, stop-state, and historical tool activity status.
- 07ff903: Prevent duplicate workspace user group names, keep failed group deletions visible until they can be retried, and keep headless scaffolds installable against the published Amplitude dependency set.
- 166b6cd: Use generated LLM titles for chat tabs instead of displaying the full prompt.
- 34054a0: Lazy-seed collaborative documents on first access instead of scanning source tables during every serverless cold start.
- Release all public npm packages with a patch version bump.
- c884b5c: Align first-run onboarding capability requirements and recommendations across apps.
- d3a010a: Limit Sentry source-map cleanup to files emitted by the current Vite build, preserve maps shipped with bundled dependencies, and bind uploads to the build ID embedded in the resolved client bundle.
- 092e16a: Make image upload actions retryable and clean up provider objects after interrupted browser imports.
- 75b8639: Prevent aborted WebMCP mutations from running after approval is shown.
- 7587d7e: Remove the chat streaming cursor and prevent completed responses from replaying
  their reveal animation when a new message is submitted.
- f463754: Keep keyboard @ mentions in the comment composer and preserve selected mentions through Design draft and reply submissions.
- 29f4316: Keep fresh multi-app workspace scaffolds on the verified Sentry bundler plugin version and supported pnpm release so installs do not resolve unavailable registry tarballs or ignore workspace policy. Keep generated shadcn guidance honest about which lint configuration is present.
- 2b387a1: Serialize same-database boot migrations so authentication cannot race schema setup.
- c503f47: Keep concurrent chat submissions on one durable thread head and retry transient thread saves so newer user turns remain visible and ordered.
- Updated dependencies [5ede9f7]
- Updated dependencies
- Updated dependencies [ffafd84]
- Updated dependencies [424d0cd]
  - @agent-native/toolkit@0.20.4
  - @agent-native/agentkit@0.2.4
  - @agent-native/recap-cli@0.5.34

## 0.182.0

### Minor Changes

- 0b6c132: Add an Agent directory for connecting hosted and A2A agent backends.

### Patch Changes

- 9e54751: Add a shared per-app status map (`getAppStatus`) and drive the sidebar header
  badge from it, so an app moves from Alpha to Beta by flipping one entry.
- 04d0b20: Add the `alg` and `crv` columns Better Auth 1.7 writes on every minted JWKS key, to both the Drizzle auth schema and the framework release migrations. Without them the Drizzle adapter rejected the key mint that runs on the first `/get-session`, so an app on core 0.180.0 with no signing key yet failed every session check. The framework health report now checks the two columns as well.
- 421910f: Return deterministic client errors for disabled Creative Context and preserve the singular app-role setter for existing integrations.
- 116c315: Keep embedded Design editor agent chat aligned with the shared sidebar and use concise OpenAI model labels.
- Release all public npm packages with a patch version bump.
- edd959b: Open OAuth popups on an inert same-origin HTTP page so embedded browsers can apply their normal popup security policy before the provider redirect.
- 280a620: Persist the auto-generated local development auth secret in `<app>/.agent-native/dev-auth-secret` (mode 0600, created exclusively, reused across restarts, never written into env files) so local sign-in sessions and the auto-created dev account survive dev-server restarts, and make the workspace dev gateway print its root directory, the real per-app URLs, and an explicit notice when its requested port is already in use.
- 8f24597: Keep review comment actions and attachments in one compact composer row.
- Updated dependencies [901376b]
- Updated dependencies [b35949b]
- Updated dependencies [116c315]
- Updated dependencies
  - @agent-native/agentkit@0.2.3
  - @agent-native/toolkit@0.20.3
  - @agent-native/recap-cli@0.5.33

## 0.181.0

### Minor Changes

- d9a1665: Add an A2A handler adapter for Anthropic Managed Agents sessions, streaming, and tool approval events.
- 99e1584: Add admin-managed app roles, permission overrides, explainable action access, member offboarding, workspace application access controls, and the labs Connect Apps foundation.

  The migration replaces the single-role `app_member_roles` unique index with an
  additive role-aware index; the old index is dropped only so one member can hold
  multiple declared roles, and no assignment data is removed.

- b6f79af: Expand the shared review surface with parity for threaded commenting, filtering, reactions, editing, unread state, and stable links.
- f33e146: Add isolated background agent sessions with stable thread identity, durable status and cancellation, and an explicit open-and-prefill handoff into full chat.
- e4188ac: Add status filtering and client-only thread links to review panels.
- 99e1584: Expose the opt-in labs flag for the Connect Apps surface.
- 99e1584: Save custom provider credentials at organization scope, preserve explicit BYOK model IDs, and polish the Team page role and permission controls.

### Patch Changes

- f47c171: Treat a reasonless Anthropic 403 as provider load-shedding instead of a rejected
  credential. The Anthropic engine tagged every HTTP status `http_<status>`, so an
  empty-body `403 status code (no body)` ended the turn on its first occurrence,
  discarded the partial answer, and told the reader to reconnect a provider key
  that was working. The Builder gateway engine and the AI SDK lane already
  classified that exact wording as transient; the Anthropic engine now shares the
  same predicate, so the run retries with backoff and a turn that stays refused
  reports a retryable sentence rather than a bare HTTP status echo. A 403 that
  carries a real reason still keeps `http_403` and the credential lane.
- 7d1d04b: Verify an attachment's bytes against its declared media type before building a
  provider image or document block. A browser labels a file from its extension,
  so a screenshot saved as `.jpg` holding PNG bytes, an SVG exported as `.png`, a
  cut-short upload, or a DOCX named `.pdf` are all ordinary user files — and each
  one made the gateway reject the entire request with `code: invalid_request` and
  an opaque error ID, killing every sibling attachment and the user's prompt with
  it. An image whose bytes are a different supported format is now relabelled so
  it works, and an attachment that decodes to nothing usable degrades to a text
  note naming the real problem instead of ending the turn.

  Validation asks each file about itself rather than trusting a magic number:
  base64 must be canonical (a spliced space or a line break decodes fine in
  Node but is rejected by the provider), a PNG must carry its IHDR chunk, and
  JPEG, WebP, GIF, PNG, and PDF payloads must reach their own declared end.

- f433634: Translate a password-protected PDF attachment rejection from the model provider into a clear, actionable chat message instead of the raw provider error envelope.
- 3ad9d88: Fix cross-app delegation reporting an unresolvable target as remote downtime.
  `findAgent` matched a handle exactly, so `agent="plans"` missed the `plan` app
  even though the Plan app labels itself "Plans" in its own sidebar, nav state,
  and skills — twelve of thirteen first-party apps had the same latent miss in one
  grammatical number or the other. `findAgent` now also resolves the singular or
  plural variant, and refuses to guess when two agents differ only by a trailing
  "s". When a target still cannot be resolved, `call-agent` now throws a typed
  `agent_not_found` failure, logs it, and emits `$a2a_invocation` telemetry
  instead of returning an `Error: ...` string that the agent loop scored as a
  successful tool call and the model retold as "The Plans app is temporarily
  unavailable."
- 326d4cf: Correct the `renderEmail` `paragraphs` doc comment: the strings are injected verbatim, not escaped, so callers must wrap user-supplied values in `emailStrong`/`emailQuote`.
- 737735c: Fix the shared agent-chat error card (`RunErrorRecoveryCard`) letting long,
  unbroken error text (such as raw provider JSON payloads) overflow past the
  card's bounds in the side-panel chat. The message paragraph now wraps with
  `break-words`/`whitespace-pre-wrap` and the card allows itself to shrink with
  `min-w-0`, matching the wrapping already used by the inline turn-marker error
  detail. This is the one shared component every template's AI side panel
  (Mail, Calendar, and others) renders run errors through.
- bd9b451: Infer a root home route for workspace apps that do not define a `/home` route, and keep local and autonomous app discovery aligned with the deployed registry.
- 329857e: Keep a newly created chat tab mounted and selected immediately across shared chat surfaces.
- 097ff5c: Start approved Plan implementations as fresh Act-mode turns while preserving scoped action permissions.
- c4e6de8: Fix Google sign-in inside an embedded iframe (e.g. the Design app's local visual-edit canvas): when the popup flow fails to open, the redirect fallback now checks for any iframe embedding instead of only Builder's own preview iframe, avoiding the same-frame redirect that Google always rejects with a 403 for framed requests.
- a1c5cbf: Prevent route loading indicators from staying visible indefinitely when a client-side navigation stalls.
- Release all public npm packages with a patch version bump.
- 9c18df9: Stop offering a Connect button for MCP servers whose authorization server
  cannot register a client, and stop rendering the failure as raw JSON. GitHub's
  authorization server (`https://github.com/login/oauth`) advertises no
  `registration_endpoint` and no Client ID Metadata Documents, so every
  `Connect GitHub` click ran dynamic client registration that could not succeed
  and painted `{"error":"This MCP server could not start OAuth..."}` across the
  OAuth popup.

  The GitHub catalog entry now uses a personal access token on the
  `Authorization` header, which is the connection its remote endpoint actually
  accepts. Independently of GitHub, an OAuth start that dies for want of a
  registerable client is now a distinct, non-retryable failure that names the
  authorization server and the token alternative, and every refusal in the MCP
  OAuth start and callback routes renders as a page for the browser that opened
  it instead of a JSON body.

- 9b3b448: Add `sseMaxDurationMs` to cap how long the SSE endpoint holds a stream open, so a serverless deployment can close cleanly before its platform's function ceiling. Unset by default; existing behavior is unchanged. A zero, negative, or non-finite value throws when the plugin is created instead of silently disabling the cap.
- 2663b3f: Track onboarding integration intent and connection outcome events.
- 273ea7c: Pair trusted PR preview Functions with the exact client asset artifact and React Router server manifest used by the preview.
- c238a61: Limit Sentry source-map cleanup to files emitted by the current Vite build so source maps shipped with bundled dependencies remain intact.
- d5687c6: Derive the dev action discovery origin from the URL Vite actually prints instead of
  hardcoding `127.0.0.1`, so the printed URL, `dev-server.json`, and every CLI/agent
  open path share one canonical dev origin (localhost on the default all-interfaces
  bind). Unauthenticated loopback `/_agent-native/*` requests in dev now get a
  one-line response hint naming the canonical origin versus the label being visited,
  instead of a silent 401 storm followed by a redirect to sign-in. Production and
  non-loopback requests keep the bare 401.
- c7c31f0: Stop the session replay recorder from retry-storming an over-quota analytics
  ingest key. A 429 now parks uploads for the window the server names in
  `Retry-After` and ends the recording when that window outlasts the session,
  instead of re-sending the rejected batch on every flush tick while the live
  event queue grows unbounded.
- b278bc7: Fix agent runs that ended as "Interrupted before this finished reporting" plus
  "The agent stopped without sending a final message" when nothing had actually
  gone wrong. Both are what the client renders when a run's SSE stream closes
  with no terminal frame, and two paths could do that. The SQL (cross-isolate)
  subscription treated any non-`running` run it did not have a branch for as a
  finished turn: a missing `agent_runs` row — pruned by retention, not yet
  committed, or read from a lagging replica — and any unrecognized `status` value
  both fell through to a silent `controller.close()`. The in-memory subscription
  closed the same way on reconnect during the window where `run.status` has
  flipped to `completed` but the completion callback has not yet emitted the
  terminal event.

  A subscriber now always leaves with a terminal frame. A missing row is retried
  for a grace period before being reported, so an ordinary startup race no longer
  ends the turn; after that it reports the typed, recoverable
  `run_record_missing`, and an unrecognized status reports `unknown_run_status`.
  A terminal-event lookup that fails to read reports `run_terminal_lookup_failed`
  rather than either of those, so "we looked and there is nothing" stays separable
  from "we could not look". All three prefer the run's real persisted terminal
  event when one exists and are captured for triage, and none auto-continues: the
  outcome is unknown, so an automatic re-POST could replay side effects that
  already landed. They surface with a manual Retry instead. The in-memory path
  waits briefly for the producer's real terminal event instead of closing, replays
  a buffered terminal event when the subscriber's cursor is already past it, and
  fails loudly if the event never arrives.

- 473ba31: Shorten shared account menus by keeping workspace apps and agent management in Settings.
- f644ac1: Forward `showModelSelector` through `AgentSidebar` so apps can hide the composer's model and effort picker in the sidebar, as they already can in `AgentChatSurface`.
- 02608a4: Make generated Chat scaffolds use a consistent package manager and expose the
  default hello action through external MCP.
- d8cf2ae: Make visual-edit source handoffs report forwarded action results reliably, preserve pending-edit visibility across editor sessions, and support direct inspection of each onboarding preview step.
- 7e34269: Fix WhatsApp webhook verification for h3 v2 and shared GET challenge requests.
- Updated dependencies
- Updated dependencies [c9cb7de]
  - @agent-native/agentkit@0.2.2
  - @agent-native/recap-cli@0.5.32
  - @agent-native/toolkit@0.20.2

## 0.180.0

### Minor Changes

- 0d80d8d: Support multiple app roles per organization member, invitation role pre-assignment, and organization-admin-editable app permission mappings.

  The additive migration drops only the prior unique index on `(org_id, app_id, LOWER(email))` and replaces it with one including `role`; it does not change or delete assignment rows.

  The new array-based client fields are additive for this minor release: `role`, `myRole`, and the deprecated `useSetAppMemberRole` adapter remain available while callers migrate to `roles`, `myRoles`, and `useSetAppMemberRoles`.

- 24ed917: Add a default-off Creative Context lab and keep What's new in its own settings group.
- 629b2cb: Document hosted A2A peer connection metadata and provider-specific authentication guidance for Foundry and Gemini Enterprise.
- 0d80d8d: Add a transactional per-app email identity rekey CLI with collision checks, session revocation, and an append-only audit event.
- ebc94a0: Use AI SDK Harness native host subscription authentication for built-in harness adapters and remove the local Codex auth-file copy path. This intentional breaking 0.x release requires removing existing `codexCliAuth` configuration and the `CodexCliAuthConfig` import; supported native subscription credentials are resolved on the host by the upstream harness adapter.
- 0d80d8d: Support administered workspaces with invite-only signup, bootstrap administrators,
  organization-scoped provider keys, optional SSO and SCIM provisioning, and
  admin-managed access policy configuration.

  The access policy is configured through `AUTH_SIGNUP`, `ORG_CREATION`,
  `AUTO_CREATE_DEFAULT_ORG`, and the comma-separated `AUTH_BOOTSTRAP_ADMINS`
  environment variables. These values are now schema-validated at startup;
  unrecognized boolean values fail fast instead of being treated as `true`.
  `AUTH_SSO` and `AUTH_SCIM` opt into the Better Auth 1.7.4 SSO/SCIM adapters.
  The optional adapter graph is excluded from builds when those flags are off;
  the serverless baselines record only the measured residual of up to 0.4 MiB
  from the Better Auth 1.6.28 to 1.7.4 core upgrade.
  The per-app `agent-native identity rekey --from --to` command provides the
  supported email migration path and revokes active sessions after a successful
  transaction.

- 8115012: Carry bounded, server-resolved action scope through agent chat runs and durable continuations.

### Patch Changes

- 25dc407: Show CLI action help before loading application data or running an action.
- 993c0ec: Restore Google sign-in compatibility with Better Auth 1.7's internal account-key adapter.
- 9f08f5d: Fix "Connect Builder.io" doing nothing when it is clicked before the first Builder status read lands. `BuilderConnectPopover` rendered an ordinary enabled-looking trigger for the whole duration of that read, then discarded any click that arrived during it — on a cold serverless instance that window is seconds long, which is exactly when a brand-new signup reaches the Connect AI step. The trigger now holds the intent, marks itself `aria-busy`, and opens the provisioning consent choice as soon as the capability resolves. It never replays the intent into `flow.start()`, because that reaches `window.open` and browsers only permit it inside the click that asked for it; when the resolved capability has no consent choice to show, the intent is released and the now-resolved trigger answers the next click synchronously.

  `useBuilderConnectFlow` also exposes `statusReadSettledCount`, which increments whenever a status read settles regardless of outcome. `statusResolved` alone cannot bound a caller waiting on a read: a second failure leaves it `false` with no observable change, so a queued click keyed on it would wait forever. `retry()` now returns whether a read actually started, so a caller cannot wait on a disabled flow that will never read. The composer runtime adapter contract (`ComposerBuilderConnectFlow`) declares `retry` alongside it, so a non-core runtime can supply it and get the same behavior in `TiptapComposer`.

- d837fda: Fix "Create and activate" in the Builder.io free-credits onboarding step showing a Cloudflare "Bad gateway" page instead of the real failure. When Builder account provisioning failed, `/_agent-native/builder/connect` answered with its rendered error page under HTTP 502. Cloudflare replaces an origin 502/504 body with its own branded gateway page, so neither the human-readable reason nor the `builder-connect-error` BroadcastChannel handoff ever reached the browser — the popup showed a bare gateway error and the opener's polling loop kept spinning with no retry path.

  Upstream Builder failures in this flow now report `BUILDER_UPSTREAM_FAILURE_STATUS` (503), which CDNs pass through intact. `sendBuilderPopupErrorPage` is now the one way to emit a connect/callback popup error page and clamps 502/504 via `cdnSafeOriginStatus`, so a future call site cannot reintroduce a status the CDN swallows. The preview-relay callback and the Builder waitlist route carried the same defect and are fixed with it.

- f25256e: Keep Builder design-system indexing working for workspaces connected through Builder OAuth. Builder's `/design-systems/v1` routes still reject OAuth bearer tokens with `403 route_not_enabled`, so those calls now retry once with the workspace's Builder private key, and report an actionable failure naming the local `create-design-system` fallback when no key exists.
- e315691: Add `callActionWithRetry` for imperative client reads whose failure the UI has
  to render as a state. It applies the same transient-failure budget
  `useActionQuery` already uses, so a gateway blip against a cold backend no
  longer settles a page on an error over data that is about to arrive, while a
  deterministic refusal (400/403/404/409/500) and a timeout still surface on the
  first attempt.
- 7823ad0: Let nested command-menu dialogs dismiss before their parent dialog.
- 7823ad0: Allow command menus to label their input and compose custom content around the shared listbox with `renderContent` and `renderList`.
- b11c437: Show a calm credits limit message with a direct upgrade link.
- 1a6739c: Fix the Chat message feedback (upvote/downvote) icons only looking "selected"
  after a click instead of confirming the vote was applied. The vote was already
  submitted to the backend, but the buttons had no `aria-pressed`, no distinct
  post-submit confirmation state, and no accessible announcement. `ThumbsFeedback`
  now sets `aria-pressed` on both buttons, briefly pops the icon and announces
  "Feedback submitted" through a polite live region once the request succeeds,
  and ignores a stale response from an earlier vote if the user already switched
  directions before it resolved.
- 1bcd993: Tie the agent chat streaming caret to whether the run is actually live, so it no longer keeps blinking after a turn finishes or disappears while the agent is still working.
- 8ff0e18: `ORG_CREATION=closed` no longer falls back to letting the first authenticated user create the canonical organization when `AUTH_BOOTSTRAP_ADMINS` is unset or empty. Organization creation is now refused with a 403 until at least one verified bootstrap admin is configured and signs in.
- 25dc407: Make collaborative text and JSON seeding conditional on the state row still being absent, so a concurrent first writer is preserved.
- 8115012: Allow app routing for safe inline Markdown links so comment suggestion receipts preserve the active workspace.
- 8115012: Keep suggestion validation and feature flag reads on the active database transaction to avoid stalled local suggestion creation.
- 5b75762: Condense the turn-into-app skill guidance while preserving its scaffold failure safeguards.
- 09bcc96: Give a tool that stops on a missing integration something to click. `connectRequiredResult()` from `@agent-native/core/shared` is the shared shape a gated tool spreads into its own result, and chat renders a Connect control by matching that shape rather than by knowing the tool's name, so a newly gated tool gets the affordance without an allow-list entry.

  Dispatch app creation was the reported case: every Builder authorization failure collapsed into the transient `builder-error` reason ("try again in a moment") even when the real cause was a disconnected Builder account, so the agent narrated a dead end and the `builder-not-connected` Connect control that the create-app popover and `NewWorkspaceAppFlow` already implement could never render. `startWorkspaceAppCreation` (and `remix-workspace-template` through it) now classifies a missing Builder connection as `builder-not-connected` with a connect action attached, and keeps an unreadable credential store as its own retryable `credential-store-unavailable` reason.

  Because the renderer matches by shape, a card can arrive from an MCP server or a remote A2A agent, so the contract only accepts a root-relative path or an absolute http(s) URL as a connect target and drops anything else before it reaches an `href`.

  A Builder API call that comes back 401 now raises a `builder_not_connected` contract error instead of a plain one, so a credential revoked upstream also reaches the Connect action rather than retry prose. A 403 stays an ordinary error, since Builder also returns it for a Space membership problem where reconnecting is the wrong advice.

  The blocker card asks for a reconnect rather than showing a Connected badge, because Builder can revoke a credential upstream without that landing in the local connection status.

- 08324bc: Rework Content's overview docs page into the same format used by the Calendar and Chat docs rework: a "Try it out now" card linking to the live content.agent-native.com app, a "What it replaces" Comparison with explicit Before/After columns instead of a plain bullet list, and a Get started section that points to the Developer Guide's quick start. Also anchors the Developer Guide's Quick start heading so the overview page can deep-link to it, and retitles template-content-local-files.mdx to "Content: Local Folder Sources" to match the "<App>: <Page>" naming every other Content/Calendar/Chat sub-page uses. English source only — the locale translations for template-content.mdx and template-content-local-files.mdx still need a matching follow-up pass.
- 0932c87: Let command-menu consumers yield editable Cmd+K collisions to the focused editor.
- 54fcc27: Make sign-out discoverable from account settings and the command menu.
- e32e1d5: Show on filter and sort triggers when the list they control is narrowed, via the new `FilterTriggerIndicator` primitive.
- e16d172: Fix the "Share" item in the agent chat sidebar overflow menu silently doing
  nothing. It used the `requestAnimationFrame` overlay-open handoff by default,
  which races with the dropdown menu's own close/focus-restore cycle for a
  freshly-mounted popover — the same failure mode fixed for "All chats" in
  #4644. Share now uses the `"timeout"` handoff timing so the share popover
  reliably opens.
- cd5cc80: Claim ownerless organization-visible workspace apps for the first active organization.
- 0e42cd0: Allow Content's ProseMirror clipboard serializer import in SSR-stubbed builds.
- 0ab0047: Harden hosted A2A probing and workspace-origin credential requests.
- a57a72b: Bound Neon Drizzle transaction acquisition and keep hosted workspace registry authorization failures visible instead of silently falling back to an incomplete local app list.
- d7881ca: Prefill the Settings → Integrations search from the `q` URL parameter, so deep links can land with the relevant integration already filtered into view.
- 533fa38: Keep Google Calendar OAuth consent isolated from previously granted scopes for other Google services.
- acd9245: Fix the sign-in entry subtitle promising a create-account control that the view
  never renders. The magic-link entry view, the desktop identity gate, and the
  mobile sign-in sheet all hide the Create account / Sign in tabs because one
  email field both registers and signs in, so the subtitle now attaches both
  outcomes to the visible continue action instead of advertising a separate step.
- a5beff9: Command menus can clear their query before closing and customize focus restoration when Escape dismisses the menu.
- 3ae3a81: Fix the shared settings sidebar rendering the "automation" tab group in
  lowercase instead of "Automation", matching the Title Case convention used by
  the other group labels (Personal, Integrations, Workspace, Agent).
- Release all public npm packages with a patch version bump.
- ebb9680: Route path-inserted OAuth discovery to the matching workspace app.
- a228418: Replace the raw gateway apology and bare `invalid_request` code in chat errors with actionable copy. The gateway's internal-error envelope is now recognized by its own shape on every stop lane, and a malformed-request rejection caused by an attachment says which formats the model reads instead of quoting a provider wire field. The raw sentence and its error id stay in the error details.
- 14372c1: Rework the Apps → Plans docs (Visual Plans, Reviewing and Commenting on Plans, Events and Automations, Local-Files Mode and Desktop Sync, Extending Plan, Plan plugin and marketplace, PR Visual Recap) into the same focused format used by the Calendar and Content docs reworks: a What it replaces Comparison with explicit Before/After columns, a Steps walkthrough for Get started and Quick start, Callouts for warnings and gotchas instead of buried prose, and "&" replaced with "and" in titles and link text per Google's style guidance. Also retranslates the ar-SA, de-DE, es-ES, fr-FR, hi-IN, ja-JP, ko-KR, pt-BR, zh-CN, and zh-TW locale versions of template-plan.mdx, plan-plugin.mdx, and pr-visual-recap.mdx to match, and records the intentionally-untranslated wireframe mockup and code-comment strings in the i18n localized-docs baseline. template-plan-review-workflow.mdx, template-plan-automations.mdx, template-plan-local-and-desktop.mdx, and template-plan-developers.mdx have no locale mirrors at all — that gap is pre-existing, consistent with the same note made for other developer-guide pages during the Calendar and Chat docs reworks.
- 25dc407: Keep modified K shortcuts available to app commands instead of opening the command palette.
- aa7d7cb: Improve organization switching and member-group creation controls.
- 25dc407: Allow org queries to stay disabled for anonymous surfaces.
- 25dc407: Restore unsent chat drafts without fetching nonexistent server threads or losing composer text. Resume normal hydration after the server confirms the conversation.
- 25dc407: Retry unacknowledged collaboration updates without dropping concurrent edits or duplicating content, and resume failed teardown updates when the same editor reconnects.
- 6ba23d3: Show a tooltip on every icon in the collapsed app sidebar rail. Sidebar link components now forward refs and unknown props, so the tooltip triggers around nav links, nav groups, and the brand mark actually attach, and the compact org switcher uses the shared tooltip instead of a native `title`.
- 1233458: Use beta Dispatch SSO for Google sign-in from immutable Netlify deploy previews.
- 15cfe9d: Fix automations getting permanently stuck in the "Running" state and blocking
  every future run with "The automation is already running. No delivery was
  confirmed." The shared `lastStatus: running` lock is used by scheduled,
  event-triggered, and manual-only automations alike, but the periodic sweep
  that resets a stuck lock past the shared timeout only ever ran for
  cron-scheduled automations. Event-triggered and manual-only automations (for
  example a Slack automation with no cron schedule) fell through that
  schedule-only skip and never got the automatic reset, so a crashed or
  recycled worker left them locked indefinitely unless a matching event
  happened to arrive or someone retried manually after the timeout window.

  The sweep now runs for every automation resource on every scheduler tick,
  regardless of trigger type, and no longer touches the automation's run
  history when its own reset write loses a race to a concurrently-started run.

- 883a8b0: Stop a turn that ends on a failed tool call from reporting itself as a finished
  answer. The run manager treated only a _successful_ trailing tool result as an
  unfinished turn, so whether a run continued depended on whether some earlier
  call in the same turn happened to succeed. A turn whose tail was a failure
  terminated as a plain `done`, and the client could render only "The agent
  stopped after these actions ... without sending a final message" — the tool's
  real error, an expired handoff URL or a missing provider credential, never
  reached the user, and asking the agent to continue by hand was the only way to
  see it.

  A failed tool result now counts as an unfinished turn, so the run continues and
  the model reads and reports the error the way it does for any mid-turn failure.
  When a turn still ends there, the chat names the action that failed and quotes
  its error instead of pointing at the tool card.

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
  - @agent-native/agentkit@0.2.1
  - @agent-native/recap-cli@0.5.31

## 0.179.0

### Minor Changes

- d3df729: Allow scoped page WebMCP capabilities to survive action discovery for signed-out visual-edit sessions.
- bd3e96e: Allow apps to choose the default state for user labs.

### Patch Changes

- 210c7d0: **Breaking (pre-1.0):** AgentKit protocol v2 intentionally rejects v1-only
  peers because the AG-UI envelope is not wire-compatible with the original
  Builder envelope. Upgrade the AgentKit client and server together, then rerun
  transport conformance before deploying a custom adapter. The deprecated
  `resolveApproval` API remains only as a source-compatibility bridge after both
  peers are on v2.

  Carry AgentKit runs over the AG-UI wire format instead of a Builder-only
  envelope. Overlapping events map onto native AG-UI event types, and the
  Builder-specific events travel as a versioned typed extension profile over
  `CUSTOM`, so a stock AG-UI client can read the stream while AgentKit consumers
  still receive fully typed domain events. Sequencing, replay cursors, and profile
  version negotiation are defined as explicit extensions because AG-UI specifies
  none of them. Approvals now use AG-UI's interrupt model: the Core transport
  exposes `resumeRun` with `resume` entries in place of `resolveApproval`. An
  approval interrupt terminally closes its protocol run, and `resumeRun` returns
  the distinct replacement run that carries the resolution and continued work.

- 210c7d0: Integrate AgentKit with Core through a formal adapter and
  first-party Agent-Native transport. Preserve replayable rich runtime events,
  action, context, access, audit, and trace metadata; expose truthful capability
  states and explicit failures; and support durable history, approvals, queue
  persistence, follow-up promotion, and streaming without a second runtime or
  thread store. Connect blocked runs to Core's trusted MCP catalog through typed
  connection requests and OAuth-safe continuation targets. Make generated Chat
  the production reference surface with a
  persistent composer, agent-authored suggestions, compact activity disclosures,
  workspace controls, stable follow-up streaming, and scaffolded local package
  resolution. Preoptimize compiled AgentKit Chat dependencies while preserving
  source-linked workspace HMR so generated apps remain responsive on cold,
  resource-constrained development hosts.
- 210c7d0: Introduce AgentKit as one public package with subpath exports for the protocol,
  headless client, HTTP transport, transport conformance, and React runtime
  (`@agent-native/agentkit`, `/protocol`, `/http`, `/conformance`, `/react`, and
  `/react/*`), where the root and `/http` entries stay React-free; a
  versioned, provider-neutral protocol; validated messages, runs, capabilities,
  approvals, activities, smart objects, uploads, actions, participants, tasks,
  custom content, and durable thread snapshots; and typed compatibility,
  cancellation, and error semantics. Add the headless client, resumable HTTP and
  SSE adapters, executable transport conformance, and composable React provider,
  hooks, slots, registries, semantic UI, safe streamed Markdown, run recovery,
  host-aware copy confirmation, capability-gated feedback and forking with
  visible mutation state, and durable queued-message promotion.
  Add typed, replay-safe contextual connection requests with host-controlled
  setup, retry, decline, and resumable-run handling.
  Choice prompts now offer a focused custom response by default, preserve that
  answer separately from predefined option ids across transports, and let hosts
  disable the affordance for deliberately constrained workflows.
  Completed activity groups now collapse to a duration-aware “Worked for…” row
  while preserving their expandable action history.
  Execution segments now settle at the first visible assistant output rather than
  the terminal run event, so response streaming time is not counted as working
  time and hidden reasoning does not prematurely end the work phase.
  Active execution segments now expose a duration-aware “Working for…” spine and
  cluster consecutive equivalent default tool activity without discarding trace
  detail or overriding host renderers.
  The entire chat frame now owns transcript scrolling while the inner transcript
  retains its constrained reading measure, so wheel input works from either gutter.
  Activity traces now share a protocol-level semantic taxonomy, render distinct
  icons for searches, reads, edits, commands, checks, MCP calls, connections,
  navigation, delegation, and approvals, and give the run-level work spine its own
  identity instead of presenting every operation as a generic tool.
  Run startup now becomes active before the first streamed event arrives, keeping
  rapid follow-ups in the durable queue instead of launching overlapping runs.
  Transcript following ignores queue-only state churn, follows queue-driven
  viewport resizing, distinguishes programmatic scrolls from deliberate history
  navigation, and avoids redundant scroll writes during sustained streamed
  output.
  Chat shells can now preserve accepted AgentKit runs across thread navigation,
  observe typed per-thread lifecycle state in surrounding chrome, show background
  activity in rails, and surface a newly submitted conversation before durable
  history catches up.
  Host chrome now distinguishes active execution from the pre-response working
  phase, so progress indicators settle when visible assistant output begins while
  queueing and cancellation remain active through the terminal event.
  Core and AgentKit now share one animation-frame-paced streaming primitive with
  adaptive backlog draining, incremental grapheme segmentation, reduced-motion
  support, background-tab catch-up, and stable memoized Markdown blocks, avoiding
  chunk dumps and whole-response reparsing during long answers.
- 210c7d0: Ship AgentKit as one package with subpath exports for the protocol, headless
  client, HTTP transport, conformance harness, and React runtime. The root and
  `/http` entries stay React-free, and an import-graph test fails with the
  offending file and specifier if that regresses.

  Gate capability-dependent UI on descriptors instead of the boolean projection.
  A capability the backend never reported is now `unknown` rather than
  indistinguishable from one it denied, `degraded` renders and surfaces its
  reason, and `unavailable` renders disabled, so a control is never offered that
  the client will reject or hidden when it would have worked.

  Report the four stream integrity failures a host cannot otherwise see —
  sequence gaps, duplicate events, runs that end without a terminal event, and
  queued follow-ups that are never promoted — through `onIntegrityReport`, which
  Agent-Native surfaces wire with `createAgentKitIntegrityReporter(surface)`.

  Remove the aliases that shipped a second way to do the same thing: `resumeRun`,
  `AgentThreadState.activeRunId`, `AgentTransport.getCapabilities`, the `error`
  render slot, and the thread scope's `resume`. Use `resubscribeRun`,
  `activeRunIds`, `discoverCapabilities`, `connectionError`, and `resubscribe`.

  Report `resumableRuns` as unsupported rather than degraded on the Agent-Native
  adapter. Replay is process-local and bounded by `x-run-replay-retention`;
  restart-safe resumption needs a durable event transport the adapter does not
  own.

- 32e7cf9: Keep branded sign-in cards clear of product screenshots on wide screens.
- 00c536f: Label the signed-out beta environment switcher as Beta.
- 8d144b8: Stop the automatic beta lane redirect from stranding a visitor on beta's sign-in page. Sessions are per-host, so signing in on a production host and being moved to beta produced a sign-in dead end; the automatic redirect is now marked as such, and beta undoes it once per tab when no beta session exists. Also corrects the Factory template's declared production URL, which pointed at a Netlify alias instead of its real production host.
- 8f4591e: The Design localhost bridge now proxies a live frame's navigation to the app's root path instead of answering it with the bridge's own control-plane manifest, so a router redirect or home link inside a visual-edit screen no longer replaces the app with JSON.
- 62b3489: The Design localhost bridge no longer exits when a proxied WebSocket connection is reset by the browser or the dev server; the daemon used to die with `read ECONNRESET` minutes after a visual-edit frame reloaded.
- 32e7cf9: Make the LLM connection step easier to find in the Getting Started guide.
- 32e7cf9: Limit queued chat image previews to four so large reference sets do not overwhelm the chat window.
- ecffde0: Make provider authorization failures actionable in chat.
- 06b904e: Reset the Connect Builder.io button after the auth popup is closed or cancelled without confirming credentials, instead of leaving it spinning until the 5-minute timeout. A short grace window still lets a slow-but-real confirmation land, and the button is retryable (or Custom keys is usable) without a page reload.
- bd3e96e: Return Builder design-system name conflicts as actionable 409 action errors.
- 64e6346: Add a reusable, action-backed executable suggestion lifecycle for reviewable resources.
- 8d657e0: Prevent duplicate completed-turn execution, keep dev checkpoints scoped to agent-edited paths, and harden eval and workspace runtime defaults.
- 29e7423: Center branded sign-in cards and match the homepage wave contrast.
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

- 50c4f9e: Agent chat reliability: a bare HTTP 403 from the model gateway ("403 status code (no body)" / "Forbidden" with no structured code) is now classified as a transient provider rejection that is retried with backoff and never shown as a rejected credential; a turn takes at most one rate-limit-driven continuation and then ends with a clear `provider_rate_limited` error instead of chaining identical requests for minutes; sustained 429/529/transient-403 on the primary model falls back once to a sibling model; a continuation chunk re-fetching a read-only tool whose result was trimmed from context no longer counts toward the identical-call breaker; stale-run recovery is capped at three successors per turn and preserves the successor worker's last diagnostic stage.
- 5c40943: Clarify that Slack Event API webhook integrations require Socket Mode to be off.
- 333f6db: Clear stale Builder connect states when a callback attempt fails, so restarting the connection recovers instead of staying ambiguous forever.
- bd3e96e: Show a connection label instead of an unavailable model in the composer.
- b83d472: Clarify the difference between live voice chat and message dictation.
- 74ed644: Fix collapsed sidebar alpha badges overflowing their compact rail.
- 875f793: Fix three reported Content defects at their shared boundaries.

  `findConnectedMcpServersForProvider()` (new, from `@agent-native/core/mcp-client`)
  resolves the remote MCP servers a user or org has saved for one catalog
  provider, so an app-level status action can stop answering "not connected" for a
  provider that Settings shows connected. Any app that keeps its own provider
  credential registry alongside the MCP catalog had the same latent conflation.
  The provider host table moved to `@agent-native/core/shared/mcp-provider-hosts`
  so a server path can match provider URLs without importing the inlined logo data
  from the client catalog.

  `TaskListPasteNormalization` (new, from `@agent-native/toolkit/editor`) rewrites
  foreign checkbox-list HTML into the canonical `data-type="taskList"` shape
  before the schema parses it, so pasting a checklist from Notion or GitHub keeps
  its checkboxes instead of degrading to plain bullets. It is registered
  automatically whenever the shared editor factory's `tasks` feature is on.

  The shared block drag handle no longer opens its menu in the top-left corner of
  the window. `getBoundingClientRect()` answers an all-zero rect rather than null
  for a hidden, detached, or unlaid-out element, so the previous null-check never
  fired for the case that actually happens and the zero rect clamped the menu to
  the viewport padding. The menu now walks grip, block, and editor candidates and
  declines to open when none of them is laid out.

- 876ff38: Defer non-visible startup reads past first paint and gate pre-auth localization calls. Adds an opt-in `useAfterPaint`/`scheduleAfterPaint` client primitive and adopts it at the agent-engine status, MCP servers, Builder status, onboarding, and slot-install mount points. The onboarding dialog's three mount reads (`steps`, `dismissed`, `profile`) compose into one `/_agent-native/onboarding/summary` request, and the localization preference read plus the localization app-state write no longer fire without a session, which removes the signed-out 401 console errors on first visits.
- 97564cd: Add reusable AppSidebar in toolkit and core, support top-left configurable alpha badges, and update app layouts to match the new sidebar design.
- 71e22e1: Add canonical cross-app and lifecycle tracking signals across templates.
- 5a4f3e2: Limit database pressure health checks to the current database.
- e55a78b: `pnpm action <name>` now forwards to an already-running local dev server over loopback instead of opening the (single-process) local database itself, so it no longer fails with a PGlite process-lock error while `pnpm dev` is running.
- 022289f: Stop the fixed local `dev` environment badge from intercepting clicks on app chrome beneath it.
- d8bc438: Make the sign-in marketing panel readable in the light color scheme. The app name, tagline, description and feature list kept their dark-body colors, so apps that show the text panel rendered the copy at 1.09:1 contrast and looked empty.
- 53c4bf9: Keep standalone prompt composers full-width inside centered flex layouts.
- 316c901: Avoid grouping database pressure queries by a truncated prefix.
- a7a45a8: Fix Google sign-in being permanently blocked for cross-app SSO users with "This email has an unverified password account." JIT provisioning creates an unusable password credential plus an inert `agent-native` identity link, and the account-claim guard counted its own link as a competing third-party claim. The promote-to-Google path now accepts it (real third-party accounts are still refused), and an authority-verified federated identity is recorded as verified so pending invitations and domain auto-join are no longer withheld.
- c5a90f2: Preserve ordered and unordered lists in Markdown comment renders.
- 210c7d0: Use the fetchable SSR wrapper for Nitro's Vite development service.
- 4515fe2: Ensure generated workspaces can install node-pty on Linux by supplying its node-gyp build dependency.
- 64e6346: Keep transaction-scoped framework and app database reads on the active local PGlite transaction so review actions cannot stall the database.
- 048bbe1: Stop the usage dashboard from reporting zero spend for the signed-in user when usage rows carry no organization id. `token_usage.org_id` is filled from the request context, so recurring jobs, automations, and every row written before that column was populated are NULL, and the org-equality read filter hid them from a query already narrowed to that user. Unattributed rows are admitted only for the viewer's own usage; workspace roll-ups and admin-selected members keep strict organization equality, so unattributed spend is never claimed for an organization that cannot be shown to own it.
- 64e6346: Expose explicit collaborative document sync receipts for fresh server catch-up requests.
- b9bda76: Prevent repeated transient inline submissions, allow inline frames to shrink to content, route workspace apps to their authenticated homes, preserve sibling-app navigation from chat handoffs, and coalesce active-run cursor updates.
- 458f2c3: Let an attached photo work as chat context with no file storage configured,
  and stop reporting an unconfigured-storage condition as a size problem.

  The inline attachment cap was a single 1,048,576-char budget derived from
  OpenAI's `file_url` limit, but it was applied to image parts too. Images ride
  `image_url` / `image.source.base64`, where the ceiling is 5 MB (Anthropic) to
  20 MB (OpenAI), so any ordinary phone photo blew a limit that did not apply to
  it, was dropped before reaching the model, and came back as "too large to send
  inline for vision analysis". At the same time the pre-upload step told the
  agent to open the storage setup card, so one attached photo produced two
  unrelated and contradictory explanations, neither of which was true.

  The image and file budgets are now separate and live in one module, the
  model-visible placeholders quote the actual limit instead of leaving the model
  to invent one, and a missing storage provider is reported as a missing durable
  URL rather than an unreadable or oversized attachment. Attachments that are
  readable inline this turn now say so explicitly, and the storage card is only
  requested when an attachment genuinely could not be read.

- 587297c: Use GPT-Live as the default realtime voice transport with delegated app tools.
- f17362f: Clear framework auth cookies from the CHIPS partition they were set in, so logout cannot leave a live session cookie behind, and re-resolve the client session when a request comes back 401 instead of painting a generic load error.
- Release all public npm packages with a patch version bump.
- 27c0d16: Show an agent integration as connected as soon as the user returns from its
  OAuth authorization. The callback redirects the popup rather than the window
  that opened it, and the shared QueryClient deliberately disables
  `refetchOnWindowFocus`, so the integrations list kept rendering "Connect" for
  an integration that was already connected until the page was reloaded. The
  `["mcp-servers"]` query now revalidates on focus, visibility, and connection
  completion for as long as the server will still accept that authorization,
  which covers every OAuth connector in the catalog rather than one provider.

  Rename the Builder Publish connector to "Builder.io Publish". Onboarding
  connects a Builder.io _account_ for model credits one screen before the
  integrations picker, and a row labelled plain "Builder.io" with a "Connect"
  button read as that account having failed to connect.

- 4b12f1c: Explain the real constraint when an MCP OAuth connection uses the wrong scope, and stop offering a personal connection for workspace-only integrations like Builder.io.
- 4515fe2: Settings gets a top-level API keys tab for every app, with a provider-tile empty state and a "+ New" menu that searches the keys the app declares or adds a custom one; the Integrations tab becomes one alphabetical provider list (MCP, messaging platforms, and Email together) with Builder.io featured at the top, and the two tabs link to each other. The Dispatch Vault uses the same "+ New" key picker. OpenRouter, Google Gemini, Groq, Mistral, and Cohere keys are registered so they appear wherever keys are added.
- c45df09: Fix `open_app` embeds so a bare `view` resolves through the app's own open-route resolver instead of a synthesized `/<view>` path, which 404'd both the embed iframe and the host's "open outside the frame" fallback link.
- 64e6346: Allow authors to amend pending suggestions while preserving discussion and durable revision history, with revision checks protecting concurrent review decisions.
- 94e99a0: Polish spacing and alignment on the local development sign-in screen.
- b4cc6fe: Agent chat: a `permanent_precondition` stop now leads with the concrete reason from the tool error ("mutate-dashboard can't run yet: Requires editor role on dashboard … (have viewer)") instead of a generic "needs a setup step" sentence, for both the user-facing headline and the tool result the model sees.
- bd3e96e: Use the shared serverless Chromium runtime for Design exports and copy it for apps that declare Playwright directly.
- 210c7d0: Keep Vite development recovery scoped to optimizer failures so React Router route-module errors recover through the shared Agent-Native route boundary without reloading durable Chat URLs in a loop.
- 210c7d0: Exclude local runtime database files from the development watcher to prevent repeated page reloads from interrupting Chat navigation and streaming.
- 7a9238c: Support `.eml` chat attachments and present upload errors in a compact, dismissible banner.
- 32e7cf9: Continue incomplete streamed action calls when the provider ends with assistant prose instead of a completed tool call.
- 8e38a3a: Load app and workspace environment files before release migrations choose their database.
- 9c01acd: Recover unclaimed background chats from the durable scheduler, including when recurring jobs are disabled. Preserve retryable dispatch payload reads and ordered run event persistence so missing events cannot become a successful completion.

  Report guardrail stops and exhausted empty responses as failures, stop workers when required prompt preparation times out, and preserve provider-requested retry delays from Builder HTTP responses.

- c124091: Rename the user opt-in feature preview surface from Experiments to Labs.
- 64e6346: Expose review reactions and personal thread preferences through the shared read/action hooks, preserve independently updated preferences, and honor muted threads when delivering reply notifications.
- 1f2682d: Keep the client session gate retrying for a 30s wall-clock budget instead of four attempts, so an instantly-failing session endpoint no longer shows "We couldn't reach the server to confirm your session" about six seconds into a cold start. A read superseded by a cache invalidation is now tracked separately from an unreadable one and no longer spends the budget.
- 26d7ae8: Register Drizzle-opened PGlite transactions with the shared exec so queries made through getDbExec() inside a getDb().transaction() callback no longer deadlock against the main PGlite connection.
- 64e6346: Make suggestion creation and decision retries converge safely, and batch suggestion history reads.
- 64e6346: Stop retired development server instances from retaining agent sweep timers and MCP settings listeners after hot reloads.
- 5c40943: Stop the full workspace app process tree before retrying a failed local server.
- 2f1c3f6: Export `getSuggestionByCreationKey` so app-owned suggestion wrappers can resolve an existing idempotency receipt before rebuilding a proposal.
- 64e6346: Include editor transform and schema exports in browser-only SSR stubs so serverless Content builds succeed.
- 210c7d0: Resolve transitive local workspace dependencies through the same Vite source aliases as their consumers, preventing Chat SSR failures during local development.
- Updated dependencies [210c7d0]
- Updated dependencies [210c7d0]
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
  - @agent-native/agentkit@0.2.0
  - @agent-native/toolkit@0.20.0
  - @agent-native/recap-cli@0.5.30

## 0.178.1

### Patch Changes

- 35eb1e6: Preserve the Design "Make this a real app" waitlist use case for Forms routing.
- 1f6d412: Propagate request continuations to actions so background cache writes can finish reliably.
- 2a2f929: Make the Builder.io free credits card header in first-run setup start the
  activation flow. The header arrow looked like the card's affordance but was
  decorative, so clicking it did nothing while the neighboring "Use my own keys"
  card was clickable end to end.
- 2b9e4aa: Keep the All chats history popover open when launched from the agent panel menu.
- e5364ac: Keep request-independent login pages on the local auth surface for PR preview hosts.
- 4676e71: Show popular OpenRouter models in the chat picker and preserve custom selections.
- b7c56a1: Settings → Integrations → Keys now reports the value each app actually uses and where it comes from (personal, workspace, Vault, or environment) instead of only the row it wrote itself, so keys synced from the Dispatch Vault no longer look unset. The "+ New" menu keeps a custom-key row visible and turns typed text into a custom key. The Dispatch Vault add/edit dialogs are key-first, and its access card explains how apps see Vault keys.
- Release all public npm packages with a patch version bump.
- 7eebc21: Open MCP OAuth setup in a new tab so the current app stays available.
- 6a0f973: Preserve exact pending action inputs when resuming an approved tool call.
- facb1ed: Preserve the prerendered Netlify root shell for explicitly public apps.
- 63f77f0: Prevent Cmd/Ctrl+K from reaching an outer host while a command menu input is focused.
- 0fcdb36: Keep the command picker above navigation drawers by using the shared dialog stacking order.
- 63bc52e: Keep the Builder connect OAuth callback on the preview origin the popup was opened on. In a workspace deploy behind a Builder-hosted preview, the callback origin resolved to the loopback workspace gateway, so Builder returned the authorization code to the visitor's own machine instead of the preview server holding the pending flow, and the connect popup failed with "No active Builder connect flow found. Restart the connection from Settings."
- b3262c3: Remove Sentry source maps from production build artifacts without blocking deploys when their upload fails.
- b7c56a1: Harden security across CLI action runners and scheduling actions: safely tokenize and quote CLI arguments in fallback action routes to prevent shell command injection, require viewer access on routing form responses, and enforce access checks on event type ID queries.
- 0dc7290: Simplify device authorization screen by removing the redundant accordion heading and toggle, and using Tabler terminal icon.
- d986fe3: Add Turn Into App as a built-in exported skill, installable through `agent-native skills add turn-into-app` and shown in the interactive skill picker, alongside `an`, `visual-plan`, and the other framework skills.
- facb1ed: Warm the grouped and per-client-loader `.data` URLs React Router requests during navigation.
- 35eb1e6: Shine the running "Working" chat status label so long turns still look active.
- Updated dependencies [35eb1e6]
- Updated dependencies [4676e71]
- Updated dependencies
  - @agent-native/toolkit@0.19.7
  - @agent-native/recap-cli@0.5.29

## 0.178.0

### Minor Changes

- 8acd379: Add user-controlled experiments to shared settings, search, and action surfaces.
- 46391ca: Store the rendered HTML/text body of every transactional email send alongside the existing send-log record, and show it in the Dispatch send log detail dialog so an org admin can see exactly what was sent, not just the redacted provider request. Magic links, password-reset/verification links, JWT-shaped tokens, and OTP/verification codes are redacted from the body before it is persisted, since `email_log` is org-admin readable. The list query never returns bodies (fetched lazily per row via a new `get-email-log-body` action once a row is opened), and the sandboxed HTML preview now carries a restrictive CSP so a body can't load remote tracking images/styles.

### Patch Changes

- e8b291e: Use the shared mouse-reactive wave animation as the branded auth background across all templates.
- 632665b: Allow apps to register custom BCP-47 locales with catalog metadata and English framework fallback.
- b21d29c: Clarify first-run capability requirements, make the Builder services popover a bulleted list, and let users skip manual key setup.
- 92297ec: Show the Builder reconnect path when an OAuth-backed gateway request returns a bare 403.
- e57a58a: Let app history restores prepare pending edits and apply the committed result before chat reports success.
- 0a64d41: Remove unused `p-limit` dependency and dead unexported `usePausingInterval` hook.
- 09ec5c0: Keep docs links on client-side navigation without intercepting non-app same-origin paths.
- 094cc5b: Set a fast interaction-feedback standard across generated Agent-Native app instructions and shared frontend guidance.
- b6bd189: Suppress telemetry for `+autoz` QA identities across the shared tracking paths.
- 840cb6c: Add recipient, sender, and template inclusion and exclusion filters to the transactional email send log action and Dispatch controls.
- 8fafe18: Keep the email verification resend countdown visible and current until it expires.
- 804113d: Enforce the package's Node.js 22.22.0 minimum in the CLI before scaffolding.
- d7408c3: Fix trigger error caching and webhook retries, fail closed on unreadable turn budgets, verify process run failure terminal status, optimize extension list queries, and validate Google service account token_uri against SSRF.
- 4822dad: Keep workspace app discovery and A2A calls working on protected Vercel previews.
- 554c771: Keep share dialogs readable while additive migrations are pending, and let
  ordinary iframe pages load cross-origin subresources. Improve new-project setup
  and Slack identity recovery guidance. Keep Cloudflare Workers builds below the
  static-header rule limit, allow local Ollama endpoints on local non-production
  servers, surface provider-setting errors, keep one PGlite client across dev
  reload realms, permit the optional terminal build in fresh scaffolds, and
  clarify standalone deployment.
- 4822dad: Keep standalone usage metrics visible when token usage has no configured app identity.
- 4822dad: Preserve Vite assets for colliding workspace app ids and reconcile deployed app registry records.
- 5c1b5e0: Fix the default social/OG image's advertised MIME type to match the actual asset (JPEG, not PNG) via a new `AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE_TYPE` export, and add the guard's documented opt-out pragma to the fixed brand-palette color literals in the OG image generators.
- d26705c: Use Google’s canonical identity scopes for browser sign-in.
- 74c9585: Restore organization scope for legacy connect tokens that predate the JWT org claim.
- Release all public npm packages with a patch version bump.
- 999dc70: Keep application-owned job YAML when updating an existing automation. Status, enable/disable, and schedule writes patch named keys instead of rebuilding the markdown from known fields.
- 6e02aa4: Reject failed or incomplete provider-save responses, display the confirmed saved model, keep fallback provider/model pairs consistent, and keep provider controls reachable in narrow viewports.
- 8f0c972: Record when a share notification was actually emailed (`notified_at` on share
  tables) so follow-up email can tell a deliberate share from a silent access
  grant.
- e57a58a: Keep Cloudflare SSR builds compatible with current Yjs editor imports.
- bc67356: Fix a crash on the auth/signup page (`NotFoundError: removeChild`) caused by the ocean background's dynamically-loaded renderer chunk sharing tuning/color modules with the auth entry chunk, which made the browser re-import and re-execute the entry chunk's hydration a second time. The shared values now live in their own module, and hydration is guarded to run only once as a backstop.
- 9b801b6: Preserve organization scope when HTTP actions authenticate with an MCP token.
- dffb4b8: Refresh page-local WebMCP clients when an in-app browser reconnect replaces the model context.
- de384ae: Preserve complete structured MCP action results for clients without inline apps, so mutation receipts remain available when display text is shortened.
- 4822dad: Restore Dispatch access for all authenticated organization members.
- d1d8495: Preserve mounted app routes across settings navigation and surface failed Builder connection authorization immediately.
- e89b114: Keep Google and email authentication as the only visible sign-in choices while optionally bootstrapping a Dispatch session and local cross-app session after sign-in. The handoff uses a short-lived, one-time server-side handle and preserves existing local accounts and cookies.
- de384ae: Include core actions in the agent tool catalog when an app supplies a static action registry, so audit history remains discoverable while respecting disabled framework tool groups.
- 6b397ca: Create Builder projects from the `agent-native-starter` template by default while preserving the deprecated repository-backed project helpers.
- be49675: Ignore malformed runtime database URL aliases and fall back to a usable database URL.
- d3386d0: WebMCP no longer excludes an action just because it declares `needsApproval`. The action stays discoverable, and a call is refused with an `approval_required` error telling the caller to ask the user to confirm in chat only when that call's actual arguments trip the predicate.
- Updated dependencies [e8b291e]
- Updated dependencies [4915b82]
- Updated dependencies
- Updated dependencies [3bde94f]
  - @agent-native/toolkit@0.19.6
  - @agent-native/recap-cli@0.5.28

## 0.177.1

### Patch Changes

- 48a4eca: Add a durable audit trail for every transactional email send attempt. The shared `sendEmail()` transport now records the outbound request payload (with auth links and message bodies redacted) and the raw provider response/status for both successes and failures, so Dispatch can show exactly what was sent, to whom, and why a send failed. The `list-email-log` action gained filters for recipient, sender, status, provider, and date range with stable pagination, and a new searchable "Send log" section was added to `/admin/transactional-email`. Magic-link sign-in emails are now tagged with a `core.magic-link` template id so they show up alongside other auth emails in the catalog and send log.
- 48a4eca: Record request payload, response status, and response body on every email send log entry, and support filtering the send log by recipient, sender, status, provider, and time range.
- 5c0e4c7: Fix duplicate clear ("x") icons in the Settings and Agent page search bars by hiding the browser's native WebKit search-cancel button on inputs that render their own custom clear button.
- Release all public npm packages with a patch version bump.
- 7a24645: Let multi-organization users choose which organization an MCP OAuth connection is authorized for.
- 050fad2: Keep mobile OAuth session cookies on the callback response and detect completed magic-link sessions in the auth page.
- a6fb3c6: Remove the "Sign in with Agent-Native" browser login option and automatic SSO handoff from auth pages.
- d891beb: Add server-backed search to the organization member list and hide role editing
  from admins to match the owner-only role policy.

  Show an error with a retry action when members cannot be loaded, instead of
  presenting failed searches as empty results.

  Keep a debounced member search on its first page when pagination is used while
  the new query is pending.

- c050912: Search fields that draw their own clear button no longer also show WebKit's native cancel widget, so only one clear control renders.
- e5e6962: Request Builder OAuth scopes covering agent execution, browser connections, assets, projects, and design systems; use OAuth-first authorization (with legacy private-key fallback) across the Builder browser, design-system, asset-deletion, and Fusion APIs; and surface actionable reconnect errors instead of generic failures when a Builder grant needs re-authorizing.
- Updated dependencies
- Updated dependencies [58d9dc3]
  - @agent-native/recap-cli@0.5.27
  - @agent-native/toolkit@0.19.5

## 0.177.0

### Minor Changes

- cc2a915: Standardize framework persistence on PostgreSQL. Local development uses PGlite,
  hosted deployments use PostgreSQL, and the database client, schema, migrations,
  templates, docs, and tooling now target PostgreSQL directly.

### Patch Changes

- 92c5992: Add Sigma's remote MCP server to the integration catalog with OAuth setup guidance and branded logo support.
- b804f4a: MCP/WebMCP instructions now advertise the app's key tools from
  `initialToolNames` (override with `mcp.keyToolNames`) and name `view-screen`
  literally. MCP tool results keep the deep link and surface
  `nextRequiredAction` as "Next: …".
- 6c84a09: Automatically register template WebMCP actions on public and private app
  surfaces, with an explicit opt-out for exceptional shells.
- 464c3fc: Expose linked design-system context consistently to external MCP and WebMCP agents.
- cef8c06: Group organization switcher actions into clearly labeled workspace, account, organization, and tools sections.
- 52944fb: Load the tracking registry lazily from the action lifecycle wrapper so `@agent-native/core`'s browser entry no longer pulls `server/deploy-environment` and the database client into client bundles, which crashed the Slides deck editor at load. A test now walks the browser entry's static import graph and fails on any server-only module.
- cef8c06: Add opt-in persistent agent sidebar toggles, customizable toggle icons, and hideable inline collapse controls.
- 4ca5522: Expose the current sync-event batch to action invalidation predicates so apps can keep cache refreshes narrowly scoped.
- cef8c06: Route Clips' shadcn UI primitives through the shared Toolkit while preserving its intentional line-tab variant.
- 71ebb30: `loadAgentDesignSystemContext` returns a bounded summary on reads and the full design-system context only when asked (`{ full: true }`); an unreadable link now says whether retrying can help.
- 2ab0a5e: Fix extension/slide content patches ending the agent's turn on the first text
  mismatch instead of letting the model retarget. Extension and slide literal
  find/replace edits now fall back to whitespace-flexible matching (tolerating
  re-indentation and CRLF/LF differences), report the closest-matching lines
  when nothing is found, and flag more than one match as ambiguous instead of
  silently patching the first one.
- 98a61a0: External MCP/WebMCP surfaces now hide turn-ending in-app question actions (`endsTurn: true`) by default and accept tool inputs/results up to 500,000 characters, so external agents author and save whole screens, decks, and documents directly instead of stalling on an in-app answer or hitting the old 20k/50k character caps.

  The page-local WebMCP action bridge now sends the calling browser tab id (`X-Agent-Native-Browser-Tab`, the header the action routes resolve into `getRequestRunContext()?.browserTabId`), so `readAppStateForCurrentTab` scopes navigation and selection reads for a WebMCP call to the tab that made it instead of whichever tab last wrote the global key.

- cb3a95f: Add opt-in canonical organization federation across Agent-Native app deployments.
- 8199216: Add an optional `exhaustedDraftPrefix` to `AgentLoopFinalResponseGuardResult`. When the final-response guard's retries are exhausted, an app that sets this field keeps the model's non-empty draft and prepends the prefix instead of replacing it with `fallbackMessage`; an empty draft still falls back to `fallbackMessage`. Apps that don't set the field keep the existing replace behavior.
- 2815f2a: Make the Builder free-credits service list open when users click "+8 more" during onboarding.
- 324b27e: Fix org creation and SSO login failing with `value "<epoch ms>" is out of range for type integer` by widening `organizations`, `org_members`, `org_invitations`, `app_member_roles`, `workspace_apps`, `identity_sso_flow_state`, and `identity_sso_jti` millisecond-timestamp columns from `INTEGER` to `BIGINT`. Also corrects the Drizzle schema for these tables plus `chat_threads`, `email_log`, and `app_secrets`, which declared their (already- or now-)BIGINT timestamp columns as `integer(...)` — silently mistyping them as `number` when node-postgres actually decodes `BIGINT` as a string.
- 9e6f642: Pass the input shape expected by the active WebMCP host adapter, including the
  Codex page adapter.
- aa4f7b6: Steer WebMCP clients toward direct mutations when current selection or item
  context already identifies a focused edit target.
- bea5bbd: Update the package README with the current Agent-Native positioning, quick start, architecture, and app examples.
- 7b19c49: Add an authenticated compare-and-set application-state route for race-safe browser acknowledgements.
- a22a313: `/_agent-native/health` reports `database.runningApp` and only claims
  `identityMismatch` when the runtime can derive its own app identity; a hosted
  bundle that resolves no slug/id reports the gap instead of blocking every
  production cutover. The deploy smoke check warns on identity mismatch for this
  rollout rather than failing.
- 30b1941: Add `summarizeHtmlStyles` and `formatHtmlStyleSummary` to `@agent-native/core/shared` so a current-screen read can print the style vocabulary shared by sibling HTML fragments (backgrounds, text and accent colors, fonts, heading sizes) and an agent editing one item matches the others instead of inventing values.
- cef8c06: Allow apps to place the shared environment badge in an inline brand slot and opt out of the provider-level badge.
- f11c6be: Keep the cached app shell loader from flashing during client hydration.
- 42f5fc3: Job and automation status writes keep application-owned frontmatter (such as a Factory Slack channel) instead of dropping those YAML extras when a run completes.
- 85582cb: Make Agent-Native OpenTelemetry spans parent correctly under each agent run and
  export bracketed model calls as live per-call spans.
- Release all public npm packages with a patch version bump.
- bb13ba4: Use the shared branded background for generated Agent-Native OG images.
- cef8c06: Keep organization switching and management actions together, ordered with member invitations before settings and organization creation.
- a7634e2: Use the docs homepage WebGL halftone field for shared public-page backgrounds.
- 434fbb2: Add flag-gated silent browser identity handoff across canonical hosted apps.
- 1852196: Skip unchanged dashboard writes and history snapshots so autosave stays frequent without creating duplicate revisions.
- 0d68c54: Allow long-lived operation groups to coalesce remote undo entries.
- 4c25e85: Fix desktop terminal colors and app surface loading behavior.
- df9cfb2: Prevent Workspace settings from flashing Builder connection actions while status loads.
- 2ab0a5e: Stop a tool call on the first failure, instead of retrying it three times, when its error text embeds a nested A2A/ask_app delegation's own permanent-precondition marker ("needs a setup step outside this turn" or "code: permanent_precondition").
- 056e5f2: Remove obsolete built-in template Wrangler deployment artifacts and guidance now that first-party sites use Netlify.
- 58d613a: Revalidate the current session before automatic beta redirects.
- 859a891: Inject the session-replay iframe bootstrap at the first `</head>` that is real
  markup rather than the first one anywhere in the string. A preview document
  that inlines a script whose source mentions `</head>` had the bootstrap spliced
  into that script's body, which unterminated a string literal and let the
  bootstrap's own `</script>` close the host script early — the whole inlined
  bundle then failed to parse and the preview silently lost every interaction.
- b542ff2: Allow explicitly authenticated custom routes to reuse connect-minted MCP bearer sessions.
- 9e54b12: Add canonical lifecycle and action-level analytics tracking across framework apps.
- 96cb0c5: Scope agent context, navigation, WebMCP actions, and sidebar chat state to the active browser tab.
- 801aedd: Preserve composed object input schemas while adding the explicit root object type required by MCP tool discovery.
- cef8c06: Allow apps to add low-frequency utility links to the shared organization switcher menu.
- 29bfdbc: Surface a failed Builder connection-status read instead of leaving the
  first-run "Activate Builder.io free credits" CTA silently inert. `statusResolved`
  only flips on a successful status response, so a 404, a 500, or the 10s abort
  left the button fully styled and dead for the rest of the session with nothing
  rendered and nothing logged.
- 4c0dd7a: Warm the root route data endpoint when it enters the viewport.
- c5b58a7: Make focused WebMCP edits self-correcting by advertising required fields and preserving safe action contract errors.
- 947a973: Remove the `window.__agentNativeWebMcp` page helper when the last WebMCP registration stops, report an honest failed status from `ready()` when no registration exists, and keep same-origin `{ origin }` calls on the normal page listing so the polyfill does not reject them.
- 47ceaf2: Publish a `window.__agentNativeWebMcp` page helper for browser agents that wraps readiness, discovery, the host input contract, stale-descriptor retries, and pending handles for short evaluators; register WebMCP tools concurrently so a hidden browser pane no longer pays one throttled timer wake-up per tool; and re-poll the sync transport after WebMCP writes so the UI repaints without a reload.
- Updated dependencies [e29fee8]
- Updated dependencies [cef8c06]
- Updated dependencies
- Updated dependencies [73c36ce]
  - @agent-native/toolkit@0.19.4
  - @agent-native/recap-cli@0.5.26

## 0.176.5

### Patch Changes

- 345fcd7: Allow signed Creative Context background processors to bypass session auth and
  cover both processor HMAC routes.
- 1670de6: Fix a cold-start latency bug where `/_agent-native/auth/session` (and the
  other early auth/sign-in routes) waited for the entire default-plugin
  bootstrap chain — agent-chat, org, integrations, and every other unrelated
  default plugin — before Better Auth even mounted. The default (non-BYOA)
  branch of `createAuthPlugin` now marks its own routes ready and mounts
  Better Auth the same way the BYOA branch already did: without serializing
  behind `awaitBootstrap`. Better Auth and the DB client are lazy singletons
  that only need the database reachable when a request actually runs, not
  anything the rest of bootstrap sets up.
- d729669: Auth marketing pages always place the "New to {app}? Learn more" link in the bottom-right corner. Removed the `learnMorePlacement` opt-in that only `slides` and `calendar` set — every app now shares the same layout.
- 938400f: Initialize the page-local WebMCP polyfill when native WebMCP is unavailable.
- f082ec8: Expose default MCP guidance and human-readable action titles across WebMCP and MCP metadata.
- 3e53f82: Clear stale browser-session WebMCP tools when live discovery fails.
- 7dccc22: Make external AI hosts discoverable from Integrations and route familiar Claude, OpenAI, Codex, Cursor, and Grok names into one shared MCP setup flow.
- 345dc58: Export `deleteAutomationRuns` so apps can clear reusable automation history when deleting scoped jobs.
- 8d2e8d8: Allow review composers to hide the human comment action when a host provides a dedicated agent workflow while keeping implicit submission aligned with the visible action.
- 2b25c01: Keep desktop UI and terminal chats in the same sidebar surface with scoped terminal workspaces and friendlier Claude errors.
- 1670de6: `/_agent-native/health/google` now probes the actual configured redirect URI
  against Google, not just the client id/secret. `redirect_uri_mismatch` — the
  most common real-world Google OAuth failure — used to be invisible to this
  health check; it now shows up as `redirectUriStatus: "mismatched"` and pages
  (503) alongside the existing `status: "invalid"` case, gated so a managed pair
  intentionally left unregistered (declared `managedConnection` other than
  `"required"`) doesn't false-page.

  `/_agent-native/identity` and `/_agent-native/embed/start` (the workspace-app
  SSO and MCP App embed handshake routes) are now registered synchronously
  before the DB-dependent bootstrap chain, alongside `/ping` and `/health` —
  previously a cold function made the desktop/mobile shell's embed handshake
  wait 4-5s for unrelated init before first paint. Security response headers
  and the framework CORS middleware moved earlier with them so both routes
  still get baseline protection.

  `/_agent-native/health` also reports an additive
  `alerts.chatHealthSlackWebhookConfigured` boolean so an unconfigured
  `NOTIFICATIONS_SLACK_WEBHOOK_URL` — which silently no-ops the chat-health
  outage alert — is visible instead of only discoverable by nobody getting
  paged during an outage.

- 1027d81: Re-registering an agent engine no longer keeps its previous priority slot.
  `Map.set` on an existing key preserves the original insertion position, so an
  engine re-registered over an earlier one silently stayed wherever it first
  landed. Engine detection walks that map in order, which left a stale entry
  ahead of Builder and read a provider key on the path that is supposed to
  resolve without touching one.
- 1466345: Nudge users toward their host agent chat from prompt popovers and shared
  sidebar surfaces.
- acf64f9: Keep auth marketing previews flush to the viewport, add a softer preview shadow, and show verification copy in light mode and local development flows.
- 9528d62: Fix the auth marketing screenshot blur, which was set to 0.3px instead of the
  intended 3px.
- ea85886: Fix Builder personal access token uploads by including their target space.
- 9c3eded: Allow Builder resumable upload retries to cancel stale GCS sessions.
- 765f263: Fix an infinite redirect loop when an app sets `homePath: "/"`. The auth guard
  served the framework login document at `/` whenever marketing content was
  configured, but for a root-home app `/` is the authenticated app shell — so a
  signed-in visitor was bounced from `/` to `/` forever. The guard now serves the
  app shell at `/` (letting the client session gate own sign-in) when the app home
  is the root, and only serves the login document there for apps whose home is a
  separate path.
- 0a1317c: Keep Core and Creative Context in one Node-style Nitro server chunk to prevent standalone cold-start failures.
- f44279a: Fix WebMCP action execution when hosts omit an abort signal.
- 3d73d24: Focus the agent sidebar composer when a user opens it.
- 1670de6: `/_agent-native/health?strict=1&schema=1` no longer reports a deploy healthy
  when it silently fell back to a local database, and its schema probe now
  covers Better Auth's own tables. `runDatabaseSchemaHealthCheck` requires
  `user`, `session`, `account`, `verification`, and `jwks` whenever auth is
  enabled (skipped only when `AUTH_DISABLED` is set), so a missing `jwks` table
  now shows up as `schema.ok: false` instead of only surfacing as a 500 on the
  Better Auth route. The response also carries an additive `auth` object
  (`baseUrlHost`, `requestHost`, `hostMismatch`) so a probe can tell a
  configured production host apart from the host actually being served.

  `getDbExec()` now throws a typed `HostedRuntimeLocalDatabaseError` instead of
  silently opening a local PGlite data directory when a hosted function invocation (not
  a Netlify build step, which also sets `NETLIFY=true`) resolves no database
  URL — a serverless instance's local filesystem is ephemeral and per-instance,
  so this was a deploy that looked green while quietly running on throwaway
  data.

  Adds `scripts/smoke-check-health.ts`, used by the prebuilt Netlify deploy
  workflow's smoke-test step to assert the health body (readiness, dialect,
  schema, and — for production — the host match) instead of only the HTTP
  status code, and to check the Better Auth `jwks` route returns real keys.

- 1670de6: The LLM-completion retry loop now honors a provider's `Retry-After` header
  (seconds or HTTP-date, capped at 60s) instead of always sleeping a fixed
  exponential backoff. `classifyProviderError` parses the header (reusing the
  provider-api quota governor's parser via a new shared
  `packages/core/src/shared/retry-after.ts` helper) and the engine error/stop
  event shape carries the result as `retryAfterMs`. The retry loop's sleep and
  its run-budget estimate now use the same number, so a 429 with a longer
  provider-requested wait either waits that long or — if it would not fit the
  remaining run budget — surfaces the error instead of silently truncating the
  wait.
- 4fa738a: Improve local authentication and Builder connection onboarding.
- 1670de6: Log the real Better Auth error code/message and report it to Sentry before
  sanitizing the direct Better Auth handler's error responses, so a
  misconfiguration like `INVALID_ORIGIN` is visible in logs/Sentry instead of
  only showing the generic public error message.
- d5506c1: Include Google Contacts scopes in the reusable Gmail workspace connection so Mail contact autocomplete can read saved and other contacts.
- Release all public npm packages with a patch version bump.
- 1670de6: `decodeOAuthState` no longer returns a success-shaped object on a missing,
  tampered, or malformed OAuth `state` parameter — it now returns a
  discriminated `{ ok: true, ...payload } | { ok: false, reason, redirectUri }`
  result, so a bad-signature or corrupted state (e.g. a rotated
  `OAUTH_STATE_SECRET`/`BETTER_AUTH_SECRET`) can no longer be silently processed
  as an anonymous plain sign-in with owner/org/desktop context dropped. All 13
  callers now check `ok` and log a structured
  `[agent-native][oauth] state decode failed` warning (via the new
  `logOAuthStateDecodeFailure`) before falling back to their existing OAuth
  error page.

  `checkGoogleSignInCredential` and `checkGoogleManagedCredential` accept an
  optional `redirectUri` and, when supplied, also probe Google's authorize
  endpoint (`probeGoogleRedirectUri`) to classify it as `registered`,
  `mismatched`, or `unknown` — the credential-only token-exchange probe used a
  constant fake redirect URI and structurally could not detect
  `redirect_uri_mismatch`, the most common real Google OAuth failure.

  `describeGoogleSignInCredentialPairs` gained test coverage confirming
  `mismatched` is a plain fact about the two credential pairs, independent of
  credential mode.

- ba865ef: Keep scheduler status writes from dropping job frontmatter the editor owns. Let Factory claim and queue recovered folder jobs that lost domain or appId tags.
- 8ff5fe7: Expose safe public actions through page-local WebMCP and provide a reusable
  registration component for custom app roots.
- 41c7ebb: Restore the auth marketing link and refine its responsive, themed screenshot layout.
- eb59867: Update the default Agent-Native OG image template: new monochrome logo mark, solid `#0A0A0A` background (grid pattern removed), and updated title/accent text colors.
- d5506c1: Put recommended guided-question choices first and preselect them in question flows.
- 1670de6: Records which app first owns a shared database, and surfaces it on
  `/_agent-native/health`. `runFrameworkReleaseMigrations` now writes a
  `framework.database_identity` setting (`{ app, recordedAt }`, keyed by the
  app slug falling back to app id) right after the framework schema exists,
  using a write-once CAS so a second app booting against the same database can
  never repoint an existing record. The health probe reads it back through the
  same connection its `SELECT 1` already opened, bounded by the same deadline,
  and reports `database.identity` (`recorded` / `unrecorded` / `unreadable` /
  `timeout`), `database.identityMismatch`, and a pooler-agnostic
  `database.fingerprint` next to the existing `urlHash`. `identityMismatch` is
  only ever true when a recorded identity disagrees with the app actually
  running — nothing else on this axis existed before, which is how a
  copy-pasted repair once pointed several beta sites' database URL at another
  app's production database undetected. `scripts/smoke-check-health.ts` now
  fails a deploy on `identityMismatch: true` and warns (without failing) on the
  other three states.
- e3900a6: Retry managed messaging requests through a distinct usable model provider when the selected credential is rejected before agent output, and make terminal delivery retries idempotent.
- 9755eb0: Restore the Slides sign-in marketing composition with a blurred preview, an overlapping auth card, and a stable image layout.
- 341c6d5: Scope workspace-file persistence to the active organization instead of the global legacy shared owner.
- eb59867: Update `AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE` to the new marketing OG/social preview image.
- 647ebfb: Preserve Builder signup attribution through standard OAuth and track failed first-run completion requests.
- cc0a806: Make the `turn-into-app` skill stop and report when a scaffold fails, times out, or is denied instead of substituting another stack, post the source brief before scaffolding rather than at handoff, and read spreadsheet inputs from structure and the sheet's own instruction text rather than from an assumed colour convention.
- cf8a596: Let authenticated Builder consumers share one request-authorization resolver, including the org-scoped, read-only Publish MCP grant used by Content database sources, while preserving legacy key fallback.
- 4071795: Mark delegated app-agent responses as unverified until the caller reads back persisted state.
- f44279a: Publish WebMCP registration progress so a partial tool list is distinguishable
  from a complete one. Tools register one at a time, so a discovery caller that
  read `document.modelContext.getTools()` mid-flight saw a truncated list with no
  way to tell it was truncated, and reported live tools as missing. Read the new
  state with `getAgentNativeWebMcpStatus()`, or from the page world via
  `window.__agentNativeWebMcpStatus`, which reports `registering`, `ready`, or
  `failed` with registered/total counts. Concurrent starts share one in-flight
  registration, and failed passes preserve the number of tools accepted before
  the failure.
- Updated dependencies
- Updated dependencies [760d108]
  - @agent-native/recap-cli@0.5.25
  - @agent-native/toolkit@0.19.3

## 0.176.4

### Patch Changes

- 24c0a3e: Return HTTP 500 for unclassified signup failures instead of reporting them as account conflicts.
- afea78a: Re-check the stored `_collab_docs` version on every cached Y.Doc read, so a
  serverless instance no longer serves collaboration text that a peer instance
  moved past. `applyText` gains a `validateBase` hook for callers that need the
  converged pre-diff text checked inside the write lock.
- 56404c7: Restore Creative context as a Share tab and compact its submission controls.
- afea78a: Add an `emptyStateFooter` slot to the agent chat, rendered below the empty-state suggestions. Unlike `threadFooterSlot` it never survives the first message, so a first-run affordance can sit with the suggestions without following the user through the conversation. Also forwards `onMessageCountChange` through `AgentPanel`/`AgentChatSurface` so a host can tell an empty thread from a started one. Fixes `onMessageCountChange` being swallowed by the multi-tab chat's own tab counter instead of reaching the host.
- 3e4a129: Prefer direct WebMCP and cataloged app actions before delegated app-agent work.
- 9a1011e: Register direct WebMCP action tools on token-authenticated app surfaces.
- 9de6cb9: `createDrizzleConfig` accepts a `url` option that takes precedence over `DATABASE_URL` and `<APP_NAME>_DATABASE_URL`, so an app can point drizzle-kit at a direct database endpoint while the app itself keeps querying through a pooler. A Neon pooler is PgBouncer in transaction mode and cannot run migration DDL. A blank or unset `url` still falls back to the environment, so `url: process.env.DATABASE_URL_UNPOOLED` is correct on hosts that set only `DATABASE_URL`.
- 63dfbc8: Report effective deployment database configuration in env-status checks.
- c9ed8ff: Batch provider secret reads when agent engine detection has to check provider keys. `detectEngineFromUserSecrets` probed each engine's keys one at a time and `resolveSecret` walks four scopes per key, so `/_agent-native/agent-engine/status` cost roughly 50 serial reads per poll for accounts without a Builder connection — bring-your-own-key users, and anyone with no provider configured at all. It now warms the request memo with one batched read per scope. Builder-connected accounts already resolved without reading a provider key and are unaffected.
- 3275e6f: Make `detectEngineFromUserSecrets` batch-load candidate provider credentials
  in one read per identity scope instead of sweeping the whole engine registry
  one point read at a time. An unconfigured request (e.g. the polled
  `/_agent-native/agent-engine/status` gate in local dev) previously issued ~80
  sequential `app_secrets` reads per call; it now reuses the existing
  `prefetchSecrets` memo so the per-engine usability checks answer from the
  request cache. Same precedence, identity scoping, and unreadable-store
  propagation.
- 1cd665a: Redirect returning Builder employees from production to beta before the app bundle loads.
- 8b060aa: Bound database admin table catalog row-count queries.
- 6d5f99a: Avoid prefetching provider secrets before checking a connected Builder account.
- 79861ce: Expose fetchable WebMCP compatibility manifests and direct action endpoints alongside the existing browser, MCP, and A2A surfaces.
- ea7c5f3: Allow a usable Builder key pair to remain available when an unreadable OAuth row is present.
- 0566ce9: Make `/act` implement the latest plan when the plan-mode callout is available.
- 485642e: Keep hosted Dispatch app launches inline outside Builder editor sessions.
- Release all public npm packages with a patch version bump.
- 9c047e3: Batch provider credential reads while building the model catalog.
- ee3a826: Keep the global chat shortcut from intercepting editable content.
- 5404eca: Make MCP settings more scannable with a distinct app icon and click-to-reveal host instructions.
- a5686be: Refresh open app data after successful mutating actions run through direct MCP tools.
- 5eeee8d: Launch terminal providers with a reliable native PTY environment and lifecycle cleanup.
- 1aad450: Let apps outside the Builder hosting pipeline use the hosted Realtime Gateway.

  Set `AGENT_NATIVE_REALTIME_TRANSPORT=hosted` on a Postgres-backed production
  deploy that already has a `BUILDER_PRIVATE_KEY`, and the app registers its own
  database and origin with the gateway on demand, then mints subscribe tokens against the
  channel it gets back. The gateway URL is now derived from
  `BUILDER_GATEWAY_BASE_URL` when unset, so hosted realtime needs one env var
  instead of four. Pipeline-injected channels still win, and anything missing
  (no key, a deploy preview, the org not in the rollout)
  leaves the app on its own `/_agent-native/poll`.

  Registering an origin requires positive evidence that this process is the
  deployment serving it, so a production build run on a laptop cannot repoint
  production's channel at another database. A platform runtime marker counts
  (`NETLIFY`, `VERCEL`, `K_SERVICE`, `AWS_LAMBDA_FUNCTION_NAME` and the like, plus
  Netlify's per-deploy `DEPLOY_PRIME_URL` / `DEPLOY_URL`); `NODE_ENV` and the
  generic `URL` deliberately do not, because both travel with a copied `.env`.

  A self-hosted container or VM has no such marker and declares its origin
  instead, with `AGENT_NATIVE_REALTIME_APP_URL`. That value wins over the resolved
  self URL when set. Without either, registration declines and logs why.

- 8b393d4: Route chat health outage alerts to Slack instead of the in-app notification inbox.
- 08aa90d: Allow OAuth state to carry a signed provider-resource target for reconnect flows.
- d75ca12: Add `splitAgentChatContextFromMessage`, the inverse of `appendAgentChatContextToMessage`, so a consumer can tell the user's prompt apart from the context an app attached to it.
- c9aa273: Keep ambient composer context chips stable when their label changes.
- b9fd516: Sync generated action field guidance across workspace and template scaffolds.
- 65abfdd: Redirect Builder employees to beta instantly from the cached browser marker, without waiting on a session round trip.
- Updated dependencies
- Updated dependencies [0566ce9]
  - @agent-native/recap-cli@0.5.24
  - @agent-native/toolkit@0.19.2

## 0.176.3

### Patch Changes

- 453cb52: Accept Builder personal access tokens when saving credentials returned by account activation.
- b734fd1: Let actions declare `endsTurn`, and unwrap a JSON-encoded tool argument on its container type.

  `endsTurn` already stopped the agent loop for core's own `ask-question`, but
  `defineAction` never exposed it, so a template action that puts a question or
  form on screen could not say the turn was over. The loop asked the model for
  another step and a completion guard scored the paused turn as a failure.

  `coerceStringifiedJsonToolValues` also required a stringified argument's parsed
  contents to fully validate before unwrapping it. A model that JSON-encoded an
  array whose items were missing a property was told only "must be array" — never
  the per-item defect — so it re-encoded the same payload until its retry budget
  ran out.

- 4d86bff: Update shared auth pages with per-app product previews and learn-more links.
- aa826fc: Prevent optional Better Auth JWT response headers from breaking valid session checks.
- f83b944: Add the /an Agent-Native app skill with Dispatch MCP and inline app workflows.
- ab2d987: Offer the Builder.io models in the chat and prompt-box model pickers on the gateway lane, so an AI-enabled app in a Fusion preview or a Builder-credits deploy no longer needs a connect step before a model can be selected
- 17740f6: Allow apps to configure their authenticated home route while defaulting every app to `/home`; set `homePath: "/"` to keep an app at the root.
- e32b034: Allow workspace credential lookups to skip last-used recording for read-only readiness checks.
- 8a151f8: Keep the hydrated auth client aligned with the cacheable SSR auth shell.
- 2b38c4d: Fix Clips share loading and mobile viewport behavior.
- 1fc5184: Add friendly automation schedules and webhook triggers.
- ad860e5: Keep framework SSE connections alive through idle edge timeouts.
- bbbac69: Keep pending Builder app reservations visible for 30 days.
- dc10e35: Keep delegated objectives on their already-selected receiver's bounded local action surface without requiring an app-specific rollout flag.
- 4b83a0d: Fix magic-link sign-in dropping the session after verify. Better Auth's `set-auth-token` is a signed `token.signature`, which is not the session table row. `getSession` now tries the unsigned token, decodes percent-encoded cookies before asking Better Auth, and persists that unsigned token as the framework session cookie.
- Release all public npm packages with a patch version bump.
- b67ffff: Dont include the template migrate-production script as something that can be auto-discovered by the actions framework
- 2e531c9: Preserve verified artifact receipts across truncated tool results and interrupted-run recovery.
- aa826fc: Keep the first-run onboarding surface available until its explicit completion succeeds.
- b302bcf: Hold the root auth document until the auth routes finish mounting during a cold start.
- 4deb8a1: Suppress synthetic signup identities that were reaching production analytics.
  `isQaTestEmail` only matched plus-addressed `+qa-test-bot-…@`, so bare
  `qa-test-bot-…@`, `an-e2e-probe-…@e2e.agent-native.test` and `e2e-…@example.com`
  were tracked as real users. Matching now covers those shapes plus the RFC 2606
  reserved TLDs, and stays narrow enough that ordinary addresses — including bare
  `example.com` fixtures and plus-addresses — remain trackable.
- 067307e: Improve desktop chat surfaces, terminal failure reporting, and scrollbar contrast.
- 4deb8a1: Make hosted ask_app submissions retry-safe and return before the MCP transport deadline.
- d8cd1c4: Make macOS Electron PTY spawning resilient to packaged helper paths and reliably clean up terminal processes.
- 1355b35: Use direct Neon endpoints for serverless runtime database clients when the configured pooler stalls.
- Updated dependencies [e74593d]
- Updated dependencies
  - @agent-native/toolkit@0.19.1
  - @agent-native/recap-cli@0.5.23

## 0.176.2

### Patch Changes

- d7d12c0: Add owner-scoped app adoption metrics to the Dispatch admin.
- 84c74f9: Keep synthetic beta E2E traffic out of analytics, prevent provider-key fallback, and preserve authenticated failure semantics across background runs.
- ab839c1: Keep synthetic beta E2E credentials isolated to the test user's validated key.
- 657658c: keep synthetic beta E2E OpenAI turns on the validated direct endpoint
- 215308c: Enforce byte limits for response bodies without a readable stream.
- 3de12aa: Bound Builder design-system status polling to one lightweight docs page.
- 1350263: Use the canonical app URL for integration thread links.
- b7e1cc9: Add chat-side revert controls for supported app history.
- 443ce1a: Keep shared agent chat scrollers inside their flex boundaries.
- 46abef1: Declare managed Google OAuth capability in app health contracts so deploy verification checks only apps that own the managed connection.
- 790f15a: Keep side app surfaces from stealing the active chat while desktop terminal and app tabs are open.
- e2a65ed: Allow trusted desktop hosts to add CLI launch arguments to PTY sessions.
- d0d8721: fix: keep authentication email links on their canonical HTTPS origin
- 7c26a81: Resume agent runs that end while an action input is still being prepared instead of reporting a completed turn.
- 6be8173: Fix Nitro AWS Amplify SSR startup and preserve framework email runtime variables.
- 383e1f6: Fix Builder desktop OAuth handoff and mounted preview auth routes.
- 7836ff8: Keep recovery-card fork snapshots compact when chats contain uploaded attachments.
- 2e03d60: Fix provider-aware model selection, shared Builder reconnect access, and provider tool limits.
- d142c4f: Fix `mergeThreadDataForClientSave` pairing two structurally identical messages (same role/content/attachments, different ids) by whichever incoming entry a content fingerprint happened to hit first. A strong identity key (id/runId/turnId) now always wins over a fingerprint-only match, and a fingerprint tie is resolved deterministically by array position instead of silently keeping the first candidate — a wrong pairing could rewrite parent links onto the wrong message id.
- 43f0da1: Read agent engine status from the current request instead of sharing stale serverless lookups across credential writes.
- 1350263: Fix Google Drive Docs push authentication to use native channel tokens.
- 3de12aa: Keep active assistant work grouped behind the work disclosure while a response is running.
- 7d8e14d: Use build-time package evidence when detecting agent engines bundled into serverless functions.
- b0c24e4: Invalidate stale in-flight agent engine status lookups after provider credential writes.
- b0c24e4: Invalidate agent engine status lookups after every successful provider credential mutation.
- 77ab9e9: Self-heal Better Auth JWKS keys orphaned by a `BETTER_AUTH_SECRET` rotation. The JWT plugin decrypts the persisted signing key on every `get-session`, so a rotated secret used to 500 every session check and sign the whole deployment out. The key is now verified against the live secret when that failure appears, stale rows are expired so a fresh key is minted, and the optional `set-auth-jwt` header is skipped (loudly) rather than failing the session response if recovery cannot help.
- 28fd3ea: Keep a signed-in visitor from being stranded on the login form when the session
  endpoint is briefly unreachable. The login document's probe read any non-ok
  status, unparseable body, or failed fetch as "signed out" — the signed-out
  answer is a 200 carrying `{ error }`, so those all mean the question went
  unanswered — and nothing retried it.
- Release all public npm packages with a patch version bump.
- 9902c3b: Render the shared integrations catalog immediately while saved connections load.
- ae94b70: Treat Netlify function bundles as having their inlined agent-engine packages when resolving runtime availability.
- 786418b: Use Netlify's runtime site marker when detecting bundled agent-engine packages.
- 0b8d452: Persist onboarding roles through Better Auth's user adapter.
- 349ce5c: Persist Agent-Native prompt drafts synchronously and keep prompt surfaces isolated across refreshes.
- 01d2112: Preserve typed HTTP status codes when formatting MCP connection errors.
- 353f95a: Split template marketing home routes from authenticated app entries and add the shared browser auth handoff.
- 99609ee: Suppress synthetic signup identities that were reaching production analytics.
  `isQaTestEmail` only matched plus-addressed `+qa-test-bot-…@`, so bare
  `qa-test-bot-…@`, `an-e2e-probe-…@e2e.agent-native.test` and `e2e-…@example.com`
  were tracked as real users. Matching now covers those shapes plus the RFC 2606
  reserved TLDs, and stays narrow enough that ordinary addresses — including bare
  `example.com` fixtures and plus-addresses — remain trackable.
- b953ef6: Keep desktop chat tab creation aligned with the selected UI or CLI mode.
- a1869cc: Render the shared authentication surface with hydratable React and reuse its marketing composition for SSR app entry pages.
- 7c1565b: Register the workspace connection catalog action in Dispatch's server action surface.
- b7e1cc9: Fail a `CONTEXT=production` release migration whose database URL is local or
  unconnectable, instead of silently migrating a throwaway file. Netlify hands the
  CLI a masked secret outside its own build infra, so the prebuilt deploy lane
  applied the whole schema to a local database in the build container, logged
  `Applied migration ...`, exited 0, and published green while the deployed
  functions kept using a remote database that never received the schema. A masked
  value is neither empty nor a `file:` URL, so a local-database check alone does
  not see it — the guard now also requires a real URL scheme. Scoped to the
  production context so the beta lane, which builds under branch-deploy against
  masked secrets and is migrated by its production twin, is unaffected.
- ed97046: Retry transient Builder design-system indexing gateway failures.
- f0fb6c5: Use the cube spinner for shared loading indicators and the worded loader for full-page states across apps.
- 050fffb: Make the shared skeleton loading shine more subtle.
- 6d0d1d7: Soften the contrast of the shared skeleton loading shine.
- 03711a6: Keep app launch loaders animated across remounts, randomize their labels, and smoothly resize the centered label.
- 8c198b8: Add regression coverage for recovery card action spacing.
- 75253cc: Support AWS Amplify Hosting with Nitro's `aws_amplify` deployment preset.
- a120516: fix: suppress analytics for reserved signup canary addresses
- 07452a5: Allow synthetic browser checks to verify a user-scoped engine when the deploy-selected engine is intentionally unavailable to synthetic traffic.
- d0d8721: fix: use deployment email credentials for scheduled dashboard reports
- 56beef0: Use the registered root callback for managed Google OAuth and fail closed when template OAuth code has no redirect URI.
- ff39391: Prefetch internal route data and JavaScript for links entering the viewport by default.
- Updated dependencies
- Updated dependencies [349ce5c]
- Updated dependencies [353f95a]
- Updated dependencies [a1869cc]
- Updated dependencies [f0fb6c5]
- Updated dependencies [03711a6]
  - @agent-native/recap-cli@0.5.22
  - @agent-native/toolkit@0.19.0

## 0.176.1

### Patch Changes

- 6621544: Emit `$ai_http_status` on `$ai_generation` events. A model call that streamed to completion reports 200; the call a run died in reports the provider status the engine named. A failure that carried no status omits the field rather than defaulting it, so a transport drop is never reported as a healthy call or an invented rejection.
- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/recap-cli@0.5.20
  - @agent-native/toolkit@0.17.6

## 0.176.0

### Minor Changes

- f445b44: Make the read-only source/search convergence budget configurable as `agent.sourceSweepToolCallThreshold` (env `AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD`), and raise its default from 12 to 24 tool calls per turn. Research-shaped apps that legitimately inspect many records were hitting the guard mid-task; a deployment can now tune the budget instead of living with a hardcoded constant.
- f445b44: Add `agent.builtInEngines` so a deployment can choose which built-in agent engines are registered. Unset registers every built-in, as before; setting it (in `defineAppConfig()` or via `AGENT_BUILT_IN_ENGINES`) registers only the named ones, so the rest never appear in the model picker and never resolve by name. An unknown name is a configuration error rather than a silently ignored entry.

### Patch Changes

- 3d10cb0: Use Agent-Native branding in Drizzle migration docs and comments
- 2ee0e37: Preserve a trailing slash in advertised agent-web page URLs. `normalizePagePath` stripped it from every page path, so a site whose canonical URLs carry a trailing slash had every sitemap entry, `llms.txt` link, and JSON-LD `url` pointing at a redirect instead of the page. Bare page paths are unchanged, and Markdown twin paths still drop the route's trailing slash (`/about/` → `/about.md`). JSON-LD breadcrumb items now follow the page's own URL shape.

  Add an optional `localizeHref` to `BlockRenderContext`. Block fields such as a card `href` go straight to the router without passing through `renderMarkdown`, so a host that canonicalizes its URLs had no way to reach them.

- e37c195: Expose Builder gateway credential availability to server consumers.
- a29c7ef: Expose MCP connection setup in searchable standard Settings, with the canonical
  `/mcp` URL and host-specific guidance shared with the connect page.
- 55b7b6f: Ask for a user's role during shared first-run onboarding and persist the preference for personalization.
- 5203369: Publish restored composer drafts to host affordances.
- ca7360e: Clarify the email sign-in action and keep magic-link onboarding as the default entry view.
- 04b27f9: Use custom app names and optional logos in social OG images while preserving Agent-Native branding for first-party templates.
- 46e4ada: Refuse to save failed provider and web responses as durable workspace exports.
- 841c741: Fix two Figma auto-layout rules the REST importer could not express in CSS.

  Figma allows a negative `itemSpacing`, which overlaps auto-layout children. CSS
  rejects a negative `gap` outright, so the declaration was dropped and silently
  fell back to 0. On the Positivus landing page the contact block overlaps its
  children by -367px; losing that overflowed the row, and because CSS flex items
  shrink by default while Figma never shrinks a FIXED or HUG child, the overflow
  was redistributed and both children came out the wrong width (1240px rendered
  as 825px, 692px as 415px) with the illustration thrown outside its card.

  A negative `itemSpacing` is now reproduced as a negative margin on every child
  after the first, and children whose main-axis sizing is not FILL are pinned
  with `flex-shrink: 0`. Measured against Figma's own geometry for those nodes,
  every box now matches to within 0.1px.

- 841c741: Fix a set of Figma import defects that silently dropped or reshaped content,
  found by measuring 26 real designs against Figma's own render of each node.

  Across that corpus the import diff falls to 3.1% overall, 0.78% with text boxes
  excluded and 0.44% excluding image fills as well — what remains is Chromium and
  Figma hinting glyphs and scaling bitmaps differently, not the conversion. The
  export hop costs under 2.4% on every design. Per node, 23 of the 26 designs have
  nothing off by more than 1.5px, and every offender in the other three is one
  glyph: a hugging box holding a `%`, which Google Fonts' Inter draws wider than
  the Inter Figma bundles.

  A child set to FILL along an axis its auto-layout parent HUGS now keeps the
  size Figma resolved for it. Figma treats that pair by falling back to the
  child's own size, but `flex-grow: 1; flex-basis: 0%` in an auto-sized flex
  container resolves to zero — so the child disappeared and every later sibling
  slid up by its height. A 343x240 photo vanished from a real landing page this
  way.

  An auto-layout frame that HUGS an axis but has no children now keeps the size
  Figma resolved for it. Figma does not collapse an empty hug frame, so it still
  reports real dimensions; mapping that to `width: auto` collapsed it to nothing,
  which deleted a 685x456 image placeholder from a real hero section and let its
  FILL sibling take the whole row, so the heading stopped wrapping too.

  Mirrored nodes are no longer rendered as half turns. Figma's `rotation` field
  is a decomposition that cannot tell a flip from a 180-degree rotation — both
  report pi — so a horizontally mirrored group picked up a vertical flip it does
  not have, and everything inside it landed on the wrong side. The transform now
  comes from `relativeTransform`'s own 2x2 block as a CSS `matrix()`, which
  carries mirroring and skew as well as rotation.

  Three auto-layout rules now match Figma's own resolution rather than the raw
  field values. A row aligned SPACE_BETWEEN no longer also emits `itemSpacing` as
  a CSS gap — Figma ignores that field in this mode but still reports it, and CSS
  distributes space on top of a gap rather than instead of it. A negative
  `itemSpacing` is clamped so the children still fill their container, which is
  where Figma stops an overlap — the same rule the `.fig` walker already used,
  rather than a second one, and applied on a FILL axis as well as a FIXED one
  since a FILL axis takes its parent's definite size. And a rotated auto-layout
  child now occupies its rotated footprint: a CSS transform does not change
  layout size, so a vertical rule stored as a wide line turned 90 degrees was
  taking its full pre-rotation width out of the row.

  Three more sizing rules now follow Figma. A HUG container holding a cross-axis
  FILL child uses the size Figma resolved: a FILL child does not feed Figma's
  hug, while CSS still feeds its max-content into the container's shrink-to-fit
  width, so a card column came out 76px too wide and moved every sibling. A FILL
  child is allowed to shrink below its own content (`min-width: 0`), which is
  what Figma's FILL does. And a zero-thickness LINE is placed from its own size
  rather than the already-rotated bounding box — requiring both dimensions to be
  positive pushed every rotated rule onto the fallback and squared its rotation.

  Break characters Figma does not lay out as breaks no longer become lines.
  Figma's stored text can carry them: a real footer holds "Get started for
  free.\rAdd your whole team as your needs grow." and Figma draws it as ONE
  flowing paragraph, wrapping at the width, while a heading holding "Customise
  it\rto your needs" renders "Customise it to / your needs". Both formats say so
  and neither walker was reading it — REST `lineTypes` and kiwi `textData.lines`
  hold one entry per line Figma actually laid out. Measured across every
  break-bearing text node in the corpus that count is never wrong, while counting
  break characters overstates it on 8 of 20 REST nodes and 17 of 18 kiwi ones.
  Mapping one such CR to a newline made a footer a line taller and, because its
  column is vertically centred, moved all 61 nodes in it.

  Trailing whitespace goes for the same reason: Figma neither draws it nor lets
  it widen a hugging box, while `pre-wrap` does both. Of the 943 hugging text
  nodes in the corpus the only three wider than Figma's own box are the three
  whose text ends in a space — the other 940 average 0.02px of error.

  Angular (conic) gradients now sweep the way Figma sweeps them. Figma computes
  the sweep in the node's normalized space — the box treated as a unit square,
  then stretched — while CSS `conic-gradient()` sweeps at a true uniform angular
  rate in real pixels; the two agree only on the axes, so a non-square tile
  landed its mid-sweep colours visibly early. Drawing the gradient into a square
  and scaling that square to the box reproduces Figma's definition exactly.

  Zero-thickness vector geometry renders again. The SVG spec says a viewBox with
  a zero width or height DISABLES rendering of the element, so a stroked path
  whose own box is 20x0 — a horizontal rule, or the arrow inside a "Learn more"
  button — disappeared silently. A collapsed axis now takes the stroke's own
  width, with the geometry centred on it.

  Figma's image CROP is now honoured. `scaleMode: STRETCH` with an
  `imageTransform` is Figma's Crop mode: the matrix picks a sub-rectangle of the
  image and stretches that to fill the box. The transform was being discarded and
  the whole image drawn instead, which reads as the artwork zoomed out — every
  illustration on a real services page came out visibly smaller than Figma draws
  it, and it was the largest non-text difference left on that page (4.04% ->
  3.52%). A rotated or skewed crop still takes the raster fallback, which is
  exact where a stretch would be wrong.

  A hugging TEXT box now takes Figma's rounded width as a minimum. Figma rounds
  every hugging text box to a whole pixel and lays its siblings out against that;
  hugging to our own fractional width makes each label a fraction narrower, and
  in a row of them the fractions add up — a nav came out 5px short across six
  items, moving every one of them. As a minimum rather than a fixed width:
  pinning the width forces the text to wrap wherever our advances run a hair
  wider than Figma's, which is a different layout entirely.

  The height is a minimum only where the text can wrap. Figma lays a hugging box
  out at `round(lines * lineHeight)` — 206 of the 207 hug-both nodes in the
  corpus with a fractional line height — and it rounds DOWN as often as up, so a
  minimum could never reach it. Text hugging BOTH axes cannot wrap, so its line
  count is fixed by the break characters and always matches Figma's; there the
  rounded height is taken outright. Two Space Grotesk headings at 38.28px line
  height hugged to 38.28 each where Figma laid out 38, and the 0.56px each pushed
  their whole column down.

  Diamond gradients are now drawn as the four-pointed shape Figma draws, instead
  of being approximated by an ellipse. The falloff is an L1 distance, which is
  linear inside each quadrant, so four quadrant-tiled linear gradients reproduce
  it exactly rather than approximately.

  An image fallback's overflowing ink no longer takes layout space. The `<img>`
  is sized from render bounds so an OUTSIDE stroke or shadow is drawn at its
  natural size instead of squished into the smaller geometric box, but Figma
  stacks siblings against the geometric box and paints the ink outside it. A
  horizontal LINE is the extreme case — its box is zero-height and the stroke is
  entirely overflow, so every rule on a page pushed everything below it down a
  pixel.

  `downscaleImageToFit` is new in `ingestion`: it re-encodes an image to fit a
  byte budget, keeping the aspect ratio, for callers that must inline one. The
  Figma SVG export used it to stop dropping a page's 11.5MB hero shot, which had
  been leaving a hole in the exported file — over a budget is a reason to send
  fewer pixels, not to send nothing.

  Icon-font glyphs no longer import as `.notdef` boxes. A Private Use Area
  codepoint means nothing outside the font that assigned it, and fonts reach an
  imported screen by family name from Google Fonts, which serves none of these
  icon fonts — so Chromium drew a hollow box beside all 16 nav items of a real
  admin dashboard, where Figma draws an icon. Such a text node now takes the
  rendered-PNG fallback the walker already uses for anything it cannot express
  (0.97% -> 0.83% on that design). The `.fig` walker has no render to fall back
  on, so it drops the glyph and records the reason against the node instead.

- 841c741: Match Figma's nearest-neighbour sampling when a Figma image fill is magnified.

  Figma upscales an image fill with nearest-neighbour sampling; a browser upscales
  with bilinear smoothing. Measured across a checkerboard edge on a 16x16 fill
  blown up to 180x90, Figma steps from `rgb(119,73,132)` to `rgb(227,78,52)` in
  ONE pixel while the import ramped across twelve, so every low-resolution fill —
  a pattern, an icon, pixel art, a placeholder — imported blurred.

  `mapFigmaNodeToHtml` now takes `imageFillSizes` (imageRef -> the image's own
  pixel size) and asks for `image-rendering: pixelated` only when the box is
  meaningfully larger than the image. Only when magnified: `pixelated` is nearest
  in both directions and a photo scaled down that way aliases badly. Without a
  size the fill still renders, just smoothed.

  The Figma importer supplies it for free from the bytes it already downloads to
  mirror into storage. The `fills-effects` fidelity case went 14.33% -> 12.07%,
  and the scanline across that edge now matches Figma's within 1/255 per channel.

- 841c741: `fingerprintMedia` no longer imports `node:crypto`. It is re-exported from the
  `ingestion` barrel, so that one import made the whole barrel — the Figma
  converters included — fail to load in a browser. It now uses `@noble/hashes`,
  verified to produce the same SHA-256 digest.
- 841c741: Figma REST import fidelity: four measured corrections found by pixel-diffing
  the mapper's output against Figma's own renders.
  - Rotated nodes tilted the wrong way. `relativeTransform`'s 2x2 block is
    already CSS's own rotation matrix in the same y-down space, so the CSS angle
    is `rotation`, not `-rotation`; negating it doubled the error.
  - Children of a rotated node were positioned and sized from
    `absoluteBoundingBox`, which is measured in already-rotated absolute space
    and inflated to the rotated AABB. Geometry now comes from
    `relativeTransform` + `size` (the node's true pre-rotation box in its
    parent's own frame) whenever Figma returns them.
  - Linear gradients used the wrong angle on any non-square box. Figma evaluates
    the gradient in normalized space, so the CSS angle follows the iso-line
    normal `(du/w, dv/h)`, not the scaled handle vector `(du*w, dv*h)`.
  - Per-paint `opacity` on an IMAGE fill was dropped, because CSS background
    layers have no per-layer opacity. Such a paint (and anything Figma stacks
    above it) now renders as an absolutely-positioned overlay div.

  Also: layer/background blur radius is scaled by a fitted 0.45x instead of 1:1,
  and `textAutoResize: TRUNCATE` now renders its ellipsis instead of clipping
  silently.

- 841c741: Figma REST import now reconstructs real vector geometry. Vectors and boolean
  operations that carry `fillGeometry`/`strokeGeometry` are emitted as inline
  `<svg><path>` markup with their own solid and gradient paints, and reported as
  `exact` fidelity instead of `image-fallback`. Nodes without geometry keep the
  rendered-PNG fallback.
- 7379c91: Export the fitted Figma blur-radius constant so the REST and `.fig` import
  walkers share one value, and stop the fidelity report from describing a text
  layer's drop shadow as a `text-shadow` when it is emitted as a `box-shadow`.
- 0705e7f: fix Builder OAuth callbacks for apps hosted on Builder Cloud origins
- 9f31e60: fix password actions for framework sessions without a Better Auth session
- 5f9ca21: Keep completed chat responses static when a new run starts and keep stopped-response actions available.
- 0d69102: Fix Google Drive Docs push authentication to use native channel tokens.
- 7abab10: Create or reuse a verified Builder account during first-run onboarding.
- 6e59cdd: Keep Builder editing detection active after SPA navigation removes preview URL markers.
- 313909c: Keep managed Drizzle app migrations separate from framework release migrations in generated and hosted projects.
- 56f7bab: Wait for lazy MCP initialization before app-visible MCP actions read the shared manager.
- Release all public npm packages with a patch version bump.
- b8bc6bf: Show a readable error page when a workspace OAuth connection cannot start, instead of replacing the page with a raw JSON body
- 5c66e51: Keep password authentication available when deployed apps do not configure an email provider, and document email delivery as optional but recommended.
- 292a1ac: Preserve exact visible prompt text when hidden agent context is attached.
- 387de2d: Stop telling readers their own provider key was rejected when it was not theirs

  A 401 proves the credential a request carried was refused. It does not prove
  whose credential it was, and the reader is often someone with no saved key to
  fix — the rejected credential can be a workspace or deployment one they cannot
  see. The copy named "the saved provider key" as the cause and sent everyone to
  Settings, which is why one shared credential cost two days of chasing key
  configuration.

  The message now says only what the 401 proves, and the rejected-credential card
  offers a retry alongside the setup flow. That retry used to be withheld because
  it would "replay the same rejected credential and loop"; that stopped being true
  once a 401 began fingerprinting the credential and skipping it for a backing-off
  window, so the next attempt reaches for a different one or fails closed as
  missing credentials. Previously this rendered a setup panel for a connection
  already marked good, with no action available at all.

- 4776e61: Reduce CI lint warnings with safer type narrowing, callback binding, and explicit async intent.
- d2b314b: Keep uploaded files and pasted text visible in chat history without importing new-deck references.
- a3d0e47: Expose atomic user-scoped settings mutation alongside the existing read and write helpers.
- 2dc4b25: Fix magic-link startup and Builder credit signup handoff.
- d5ddd8c: Use connected Google profile names and avatars across shared identity surfaces.
- 4f7f661: Export scope-aware Builder upload authorization checks from `@agent-native/core/server`.
- 510eb32: Keep Slides agent generation context and chat history reliable across attachments, follow-ups, and queued sends.
- 7d89861: Smooth out the skeleton loading animation. Tailwind's stock `animate-pulse`
  swings opacity 1 → 0.5 and eases hard into both ends, and skeletons that mount
  at different moments never line up — at that amplitude a screen of placeholders
  strobes. The shared stylesheet now defines `--animate-pulse` as a calmer
  1 → 0.72 breathe, honours `prefers-reduced-motion` globally, and the two
  hand-rolled skeleton keyframes reuse it.
- 0a0956d: Keep intentionally stopped chat runs from reappearing as missing final responses.
- 709f807: Track Agent-Native auth, onboarding, activation, and sharing funnel events.
- e714047: Keep chat response streams available during JSON checks and reject unexpected successful JSON responses explicitly.
- Updated dependencies [ac1ecfc]
- Updated dependencies [4776e61]
- Updated dependencies
- Updated dependencies [5a12f71]
- Updated dependencies [d2b314b]
- Updated dependencies [5c96078]
  - @agent-native/toolkit@0.17.5
  - @agent-native/recap-cli@0.5.19

## 0.175.5

### Patch Changes

- 330eedf: restore markdown list markers and open durable chat streams while workers finish setup
- c4f89b2: Handle coded Builder gateway internal errors consistently across streamed and HTTP responses.
- 37d360e: Standardize Agent-Native branding in the migration runner documentation.
- 3b19335: Use custom app names and optional logos in transactional emails while preserving Agent-Native branding for first-party templates.
- Release all public npm packages with a patch version bump.
- 24348cb: Prevent auth and password-reset fields from auto-focusing on initial load, avoiding an unexpected mobile keyboard.
- bda7ef3: Improve shared-resource notification emails with sender context, a resource-name block, and a focused call to action.
- Updated dependencies
  - @agent-native/recap-cli@0.5.18
  - @agent-native/toolkit@0.17.4

## 0.175.4

### Patch Changes

- 20be465: Keep ordinary cross-app todo requests in chat and make oversized provider tool names safe for A2A handoffs.
- 9426034: Stop a rejected provider credential from re-breaking the first prompt on a fixed cadence

  A 401 pins the rejected credential so the next lane serves everyone after it, but
  two things kept unpinning it and making the next person's first prompt pay to
  rediscover the same rejection:
  - `ai-sdk-engine` cleared the auth-failure marker after every stream, error or
    not, so one unrelated failure (a 500, an overload) re-admitted a credential a
    401 had just pinned. Clearing asserts the credential works, so only a turn
    that actually completed does it now.
  - Both auth-failure markers released on a flat 15-minute TTL. The marker is
    fingerprinted on the credential value, so a rotated credential never matched
    the old marker anyway — the TTL only ever re-tested a credential that was
    still wrong. Repeat failures on the same fingerprint now back off
    exponentially from that base up to 24h, while a first, genuinely transient
    401 still releases on the original TTL.

- Release all public npm packages with a patch version bump.
- db91905: Allow hosted deployments to resolve their Notion OAuth client credentials for signed-in users.
- 5ef18e1: Let agents inspect successful public image responses from web-request as vision context.
- 557e694: Polish the agent recovery card action spacing.
- 318819b: Give the Dispatch workspace embed handshake a cold-boot connect budget so opening an app whose server is still starting no longer fails as unreachable. `McpClientManager` now accepts a `connectTimeoutMs` option, and the embed session mint spends up to 90s per attempt within a 95s total budget instead of the 5s interactive default, matching the dev gateway's own readiness wait.
- Updated dependencies [db91905]
- Updated dependencies
  - @agent-native/toolkit@0.17.3
  - @agent-native/recap-cli@0.5.17

## 0.175.3

### Patch Changes

- c30393d: Rework Chat's docs (Overview, Your First Feature, Developer Guide) into the same focused format used by the Calendar docs rework: a "Try it out now" card linking to the live chat.agent-native.com app, a What ships Comparison with explicit accent colors, and a Developer Guide quick start plus action inventory and customizing section. Also updates the ar-SA, de-DE, es-ES, fr-FR, hi-IN, ja-JP, ko-KR, pt-BR, zh-CN, and zh-TW locale translations of template-chat.mdx and template-chat-first-edits.mdx to match. template-chat-developers.mdx still has no locale mirrors at all — that gap is pre-existing and already tracked in the i18n coverage baseline.

## 0.175.2

### Patch Changes

- 96d0181: Keep a same-origin Referer on validated embed responses so an embedded Dispatch can open workspace apps. Embed responses previously used `Referrer-Policy: no-referrer`, which stripped the Referer from every same-origin request the page made for the life of the document, so `create-workspace-app-embed-session` rejected Dispatch itself with "Workspace app sessions must be requested by Dispatch." Cross-origin referrers stay fully suppressed.
- 462f53c: Preserve Builder OAuth state when Builder omits it from the callback query.
- Release all public npm packages with a patch version bump.
- 84ab540: Fix mouse-wheel zoom running at trackpad-pinch sensitivity in `usePinchZoom`.

  A single wheel notch saturated the hook's ±50px delta clamp and landed on
  `exp(0.5)`, so every detent multiplied zoom by ~1.65× regardless of how far the
  wheel actually turned. Wheel and pinch now run through separate curves — a
  notch is a Figma-sized 1.1× step, finger separation keeps the exponential — and
  the device is latched per gesture rather than guessed per event, because macOS
  ramps an accelerated wheel up from pinch-sized deltas.

  Adds `@agent-native/core/client/zoom-gesture` exporting the shared
  classification and curves (`resolveZoomGestureDevice`, `zoomFactorForWheelDelta`,
  `clampZoomFactor`, `accumulateZoomFactor`) so canvases stop re-deriving them.

  `preventDefault` on wheel and touch-pinch is now guarded by `event.cancelable`,
  which stops the browser Intervention warning Chrome logs per event during a
  fling.

  Line- and page-mode wheel deltas are converted to pixels before the curve is
  applied. The curve is calibrated in pixels, so a Firefox line-mode notch
  (`deltaY: 3`) was being read as three pixels of travel and moved zoom by well
  under a percent. Classification still reads the raw delta and its real mode —
  normalising first would push a line tick into the trackpad band.

- Updated dependencies [65a3b88]
- Updated dependencies
  - @agent-native/toolkit@0.17.2
  - @agent-native/recap-cli@0.5.16

## 0.175.1

### Patch Changes

- 5a045bf: Fix file uploads for Builder connections made through OAuth. New connections
  store only an OAuth grant, but the upload provider and the storage capability
  gates still looked for a legacy `bpk-` private key, so uploads failed for every
  newly connected user.

  Builder OAuth now also requests `builder:assets:write`, the scope its
  `/api/v1/upload/*` endpoints enforce, and the upload provider sends the OAuth
  token when the request's owner has a grant — falling back to a private key only
  when there is no grant at all.

  Already-connected users must authorize Builder once more to pick up the new
  scope.

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/recap-cli@0.5.15
  - @agent-native/toolkit@0.17.1

## 0.175.0

### Minor Changes

- da836e2: Use the hardened Run QuickJS evaluator for production sandboxed code execution.
- cf473dc: Allow mention providers to show custom text or images with optional background
  colors, or to omit leading media, while preserving the existing icon fallback.
- 6c71a21: Add opt-in WebMCP producer and browser-session consumer support.

### Patch Changes

- 73ff8c5: Allow apps to configure approval requirements for individual MCP tools and require a fresh approval on every call when persistent approval is disabled.
- Release all public npm packages with a patch version bump.
- de5ba2d: Keep shared managed MCP OAuth clients from being overridden by stale personal secrets.
- Updated dependencies
- Updated dependencies [cf473dc]
  - @agent-native/recap-cli@0.5.14
  - @agent-native/toolkit@0.17.0

## 0.174.2

### Patch Changes

- bb282b1: Removed the FAQ docs page and folded its content into What Is Agent-Native and the docs pages each answer actually belonged to (deployment, environment variables, writing agent instructions, templates, key concepts, syncing template changes).
- a9aa623: Reset Google sign-in state when an Electron OAuth popup closes and keep Nitro dev startup errors behind the recovery page until the server is ready.
- Release all public npm packages with a patch version bump.
- 615c5d5: Skip `git init` when `create` scaffolds into a directory that is already inside a git repository, instead of only when the target directory itself is one. Discovery is delegated to git, so symlinked paths, filesystem boundaries, and `GIT_CEILING_DIRECTORIES` behave exactly as they do everywhere else.
- Updated dependencies
  - @agent-native/recap-cli@0.5.13
  - @agent-native/toolkit@0.16.16

## 0.174.1

### Patch Changes

- 5e57bc6: fix fresh chats to use a configured provider instead of an unavailable deployment default
- 7d90274: Preserve shared OAuth flow cookies across redirects.
- 7d5cce0: Use the configured Google OAuth client for official Google Workspace MCP servers.
- a63c4b3: Support Google Workspace MCP OAuth clients that use Google's fixed OAuth endpoints instead of MCP discovery.
- Release all public npm packages with a patch version bump.
- a026821: keep provider-auth recovery visible while an agent run is still active
- Updated dependencies
  - @agent-native/recap-cli@0.5.12
  - @agent-native/toolkit@0.16.15

## 0.174.0

### Minor Changes

- b4c3864: Collapse the core-routes `mcpConnect*` options into one `mcp` object, and fix the MCP server name on multi-label hosts.

  `createCoreRoutesPlugin({ mcp: { connect, serverName } })` replaces the four flat keys `disableMcpConnect`, `mcpConnectServerName`, `mcpConnectAppId`, and `mcpConnectAppName` — the same shape `AgentChatMcpOptions` already uses for the protocol mount. All four stay accepted for one minor; setting both forms to disagreeing values throws at plugin init rather than booting with a connect surface nobody chose.

  The two identity keys are deprecated outright rather than carried over: `app.id` and `app.name` are declared config fields, so a per-surface option for them is a third spelling of one thing. Unset, they now resolve from config — the same value the runtime config report already read.

  An explicit `serverName` is returned verbatim, prefix and all — it pins an id clients already hold in their config, which is why Plan publishes the bare `plan` rather than the derived `agent-native-plan`.

  Fixes the server name on hosts with more than one leading label. `serverName` fell back to the first hostname label, and every beta deployment is `beta.<app>.agent-native.com`, so all of them advertised themselves as `agent-native-beta`. Clients key their MCP config by that name, so connecting a second beta app replaced the first. Identity now resolves from `app.id` / `app.template` / `app.slug` before the hostname, which covers every first-party template with no configuration.

- b4c3864: Resolve the app's name, slug, and description once, through app config.

  `server/app-name.ts` is removed. `getAppName()`, `getAppSlug()`, and `getAppDescription()` become `getAppConfig().app.name` / `.slug` / `.description`, and the first-party-template lookup they performed now runs over the resolved config, keyed on `app.packageName` (`npm_package_name`). It fills only what is still unset, so `APP_NAME` or a `defineAppConfig()` value always wins.

  **`getAppConfig()` no longer touches the filesystem.** `getAppName()` read package.json from `process.cwd()` on every resolution path; the repo already treats that as a development-only fallback (`server/cookie-namespace.ts` uses one solely in its non-production branch). A deployment where `npm_package_name` does not reach the runtime should set `app.name` in `server/plugins/config.ts` or `APP_NAME`.

  This removes a second resolver for a declared field: `getAppName()` read `process.env.APP_NAME` directly while `app.name` already declared that alias, so the two disagreed. `core-routes-plugin.ts` resolved the same app name both ways, thirty lines apart — the runtime config report got `undefined` for every first-party template while the MCP connect page got "Mail". Both now read one value.

  `app.slug` and `app.description` are new fields with no env alias: the slug selects the per-app transactional email sender on agent-native.com, so a name the first-party template table already contains is its only source. `app.packageName` and `app.template` are deliberately still env-only — both are read as app-id fallbacks when matching stored workspace connection grants, and filling them from package.json would repoint those lookups.

  A package.json that exists but cannot be read or parsed now throws and names the file, instead of being silently indistinguishable from having none — which previously branded the app "Agent-Native" and sent from the generic mailbox with nothing in the log.

- b4c3864: Deprecate `createAgentChatPlugin({ model })` and `({ durableBackgroundRuns })` in favour of the declared `agent.*` config surface.

  `agent.model` (`AGENT_MODEL`) was declared but no agent-chat path read it — every model resolution site read the plugin option directly, so the field was inert. It is now the layer beneath the option, resolved through one helper instead of eight raw reads.

  Fixes two delegated-run gates (A2A and MCP) that tested `durableBackgroundRuns === true` on the raw option instead of calling `isAgentChatDurableBackgroundEnabled`. On Netlify, where durable background is default-on, a mount that did not pass the option was capping delegated turns at the 40s foreground chunk budget while running inside the 13-minute background function.

- b4c3864: Move observability settings out of the settings table and into `defineAppConfig()`.

  `observability` is now a declared config domain. The `observability-config` settings row is no longer read: nothing in core ever wrote it, so its only "UI" was a documented `putSetting(...)` snippet an app author pasted into their own code — which makes it deployment configuration, not a runtime preference. Deployments that wrote that row must move those values into `defineAppConfig({ observability: { … } })`; every field also has a deployment environment variable alias.

  This also takes a database round-trip off the agent hot path. `getObservabilityConfig()` read the settings row on every instrumented run inside a bare `catch {}`, so a database outage was indistinguishable from "never configured" and silently served defaults.

  `defineAppConfig()` now returns a Nitro plugin, so its canonical home is `server/plugins/config.ts` with `export default defineAppConfig({ … })` — the same shape as every other framework plugin. The config layer is still applied at module load, before any plugin reads it. Existing callers that ignore the return value are unaffected.

  **Removed:** `ObservabilityConfig.exporters` and `ObservabilityExporterConfig`. Nothing ever read them — `observability/tracing.ts` states that core deliberately registers no OpenTelemetry provider or exporter — so the documented OTLP export never sent anything, and the docs recommended putting a backend bearer token into the settings table to configure it. Export now happens by registering a `TracerProvider` in the app, which keeps the credential in the app's own wiring and the vault.

  **Removed:** `DEFAULT_OBSERVABILITY_CONFIG`. The schema's declared defaults are the single source now.

### Patch Changes

- d9e978f: Expose model-produced tool inputs to eval scorers so argument-level agent behavior can be verified.
- 536e193: Compile oversized PostHog transcript bounding against ES2022 by walking the last user message instead of using `Array.findLast`.
- Release all public npm packages with a patch version bump.
- f22b29b: Validate OpenRouter keys before saving them and preserve actionable provider setup errors.
- eae6742: Stop SQL-replayed provider authentication failures from self-continuing.
- Updated dependencies
  - @agent-native/recap-cli@0.5.11
  - @agent-native/toolkit@0.16.14

## 0.173.1

### Patch Changes

- 1417ba5: Give UI and agents the parts of a `fail()` failure they were missing.

  Action errors now carry `actionMessage`, the text the action wrote with no
  `Action <name> failed:` framing, plus an `actionErrorMessage()` helper exported
  from `@agent-native/core/client/hooks`. Templates render `error.message`
  directly, so a refusal surfaced as "Action update-brand-kit failed: That name
  is taken." The helper returns `undefined` when nothing authored a message (a
  network drop, a proxy's HTML error page, a bare status line), so a UI cannot
  mistake transport noise for copy.

  Tool results now include the `errorCode` an action chose, as
  `Error running get-meeting: No such meeting (errorCode: not_found)`, on both
  the in-app agent loop and MCP. The model can branch on the code without parsing
  prose. `fail()`'s default `action_failed` is omitted, since it says only "it
  failed", which the word "Error" already said.

- 191f4d3: Keep the Google account chooser when connecting a managed workspace connection and preselect the signed-in identity.
- Release all public npm packages with a patch version bump.
- a4b36e0: Stop billing cached prompt tokens twice, and normalize what `inputTokens` means
  across every engine.

  Providers disagree: OpenAI's `prompt_tokens` includes cached tokens, Anthropic's
  `input_tokens` excludes them. The `usage` event never said which it carried, so
  both conventions reached `calculateCost`, which charged `inputTokens` at the
  full input rate and then added `cacheReadTokens` / `cacheWriteTokens` on top.
  On a long cached conversation the cache is nearly the whole prompt, so a turn
  that cost $0.0054 was reported as $0.0478 — and every `token_usage` row for an
  OpenAI-family model was inflated the same way.
  - The `usage` event now documents one convention: `inputTokens` is the whole
    prompt and INCLUDES both cache counts, which are a slice of it rather than an
    addition. This matches the AI SDK's own `inputTokens.total` / `noCache` /
    `cacheRead` / `cacheWrite` normalization, and the Builder gateway.
  - `anthropic-engine` was the only ENGINE reporting the exclusive form. It now
    adds the cache counts back, which also fixes its prompt size: a fully cached
    turn used to report ~3 input tokens instead of the real 42,438.
  - `calculateCost` treats the three counts as a partition and prices each token
    exactly once. Callers with no prompt caching pass zeroes and are unaffected.

  The recap CLI carried all three conventions at once and now shares this one:
  `parseClaudeUsage` adds Anthropic's cache counts back into the prompt,
  `parseCodexUsage` no longer strips OpenAI's cached tokens out of it (it did that
  to compensate for the old pricing formula, so keeping both would have swung the
  error the other way), and `parseOpenAiCompatibleUsage` was already correct.

- a4b36e0: Correct the GPT-5.6 pricing rates, which matched no published tier.

  The `sol` / `terra` / `luna` entries carried input and output rates that appear
  in neither column of OpenAI's table (luna was $1.00/$6.00 per MTok against a
  real $0.20/$1.20), and set `cacheWrite: 0` on the belief that OpenAI does not
  bill cache writes — it does, at above the full input rate. All three now track
  the published short-context rates:

  |       | input | cached | cache write | output |
  | ----- | ----- | ------ | ----------- | ------ |
  | sol   | $4.00 | $0.40  | $5.00       | $20.00 |
  | terra | $2.00 | $0.20  | $2.50       | $12.00 |
  | luna  | $0.20 | $0.02  | $0.25       | $1.20  |

  Short context on purpose: each model has a long-context tier at roughly 2x, and
  a usage row does not preserve the request's context size, so the tier cannot be
  recovered at pricing time.

  Together with the cached-token double-billing fix, a real 11-call run drops from
  a reported $0.8524 to $0.0358 — 24x. Pricing that run's cache writes at the
  input rate instead reproduces PostHog's independently derived $0.0328 to the
  cent, which is what confirms the rates.

- a4b36e0: Fix tool calls rendering without their output in PostHog LLM analytics.

  Engine messages shipped verbatim as `$ai_input`, in a shape PostHog does not
  read: `tool-call` / `tool-result` parts with camelCase ids, and tool results
  carried inside a `user` message because `EngineMessage` has no `tool` role.
  PostHog dumps raw JSON for shapes it does not recognize, so a tool call rendered
  as an escaped blob with its result nowhere in sight. Messages now normalize to
  the OpenAI/Anthropic conventions PostHog reads, and attachment bodies become a
  marker naming the media type and size instead of inlining base64.
  - `tool_calls[].id` now carries the id the model issued rather than our span id,
    so a call and its result actually pair. Span id remains the fallback for
    emitters that report no call id.
  - The byte-ceiling rescue in `boundAiContent` keeps "the last user message",
    which in engine shape was the last tool result — so the user's question was
    dropped from every oversized generation. Normalizing first fixes it.
  - A tool span with `captureToolResults` off now carries an explicit "withheld"
    marker in `$ai_output_state` instead of omitting it, matching what the error
    path already did. An absent output state reads as a tool that returned
    nothing, and the tool did answer.

- 7265794: Prevent background chat recovery from reporting completed runs as lost.
- 1417ba5: Make `fail()` reach the caller, and stop retrying deterministic action failures.

  `fail()` threw a bare `Error`, which the action HTTP route cannot distinguish
  from a driver or upstream blowup. Every refusal written for a person became a
  500 `"Internal server error"` with the real message dropped and an
  error-tracking report filed. It now raises an `ActionContractError` with a
  default 400, so the message, `errorCode`, and `details` survive the transport,
  and it accepts an explicit `statusCode` for causes like 404 or 409. `fail()`
  now lives beside that error in `action.ts` and is exported from
  `@agent-native/core/action` as well as the package root.

  `defaultActionQueryRetry` retried by exclusion, so every status nobody had
  added to its deny list was retried three times. A `useActionQuery()` read
  refused with 400, 404, or 409 cost four executions, and a 500 cost four
  duplicate error reports. It now retries by exception: `429`, `502`, `503`, and
  `504`, plus one retry for status-less network failures. A 500 is an action's
  own unhandled throw, so it is treated as deterministic and surfaces on the
  first response.

- Updated dependencies
- Updated dependencies [a4b36e0]
  - @agent-native/recap-cli@0.5.10
  - @agent-native/toolkit@0.16.13

## 0.173.0

### Minor Changes

- 460080b: Give chat readers control over how much model reasoning is shown, and make
  reasoning collapsible everywhere it appears.

  Reasoning inside the "Worked for…" summary used to render as flat prose with no
  disclosure of its own, so opening that summary dumped the full chain of thought
  between the tool calls with no way to fold it back. It now keeps its own
  "Thought for Xs" row, collapsible exactly like the tool calls it sits between,
  and renders its markdown instead of showing `**source characters**` — OpenAI
  reasoning summaries arrive pre-formatted.

  A new browser-local preference picks between three modes, reachable from the
  chat panel's ⋮ menu:
  - **Expanded** — the previous behaviour: the live cell opens itself.
  - **Collapsed** — the new default. The label and its timing stay visible, the
    text is one click away, and a live turn no longer pushes the answer out of
    the viewport.
  - **Hidden** — no reasoning cells at all.

  Hosts can pin the mode with the `thinkingDisplay` prop on `AgentSidebar`,
  `AgentPanel`, `AgentChatSurface`, and `AssistantChat`; when pinned, the in-chat
  control is not offered rather than left as a dead menu item. The preference is
  presentation only — it never changes what the engine requests or what is
  persisted, so switching back reveals the same text on the same turns.

### Patch Changes

- Release all public npm packages with a patch version bump.
- 460080b: Send `$ai_generation` and `$ai_span` to PostHog stamped at the moment the operation ended, which is the convention it reads them by: its timeline derives an operation's start as `timestamp - $ai_latency`, so stamping the start drew every bar one full latency too early — model calls overlapped each other by a growing margin, a call's tool spans appeared underneath the _next_ call, and a 35s run rendered as 31.2s. The shift is applied inside the PostHog provider, so the shared event keeps the operation's start for Mixpanel, Amplitude, webhooks, and Agent-Native Analytics, which read the timestamp verbatim. Events with no `$ai_latency` — a trace, an exception — are unshifted.
- Updated dependencies
  - @agent-native/recap-cli@0.5.9
  - @agent-native/toolkit@0.16.12

## 0.172.10

### Patch Changes

- 200e63b: Make the harness-session generation migration idempotent on Postgres.

## 0.172.9

### Patch Changes

- 36c79f9: Use the authenticated workspace app registry for hosted Dispatch app lists so inaccessible apps do not get an Open app action.

## 0.172.8

### Patch Changes

- e248449: Emit the `signup` event once per real account creation, and stop emitting it for user rows that are not signups.

  Better Auth runs its `user.create.after` hook on every `user` row insert, and the hook treated all of them as a person signing up. Two production paths create rows through `internalAdapter` outside any endpoint, where Better Auth's context — and therefore the request, the browser, and its `an_aid` / `an_ft` cookies — is `null`: `ensureCanonicalUserForLegacySession` (backfilling a canonical row for someone who signed up months ago) and `ensureGoogleAuthIdentity` (provisioning the canonical row during the Google callback). Both emitted an unattributable `signup` recorded as `referral_source: "direct"`, which is why ~94% of `better-auth` signups carried no `anonymous_id` and one person provisioned across sibling apps counted as a dozen acquisitions.

  Google sign-in was also losing its real event: because `ensureGoogleAuthIdentity` writes the canonical row _before_ `createOAuthSession` runs, the `hasBetterAuthUserEmail` probe there concluded the person was an existing user and skipped the one emitter that carries the browser's anonymous id. Callers now pass the `isNewUser` answer they already hold, and the event carries the canonical Better Auth user id rather than the Google profile id, so it still joins to `referrer_user` in the virality panels.
  - A row insert with no request behind it emits nothing at all.
  - Emitted events carry `signup_origin` (`browser_signup` / `google_oauth` / `sso_jit`) so acquisitions are selectable from sibling-app provisioning.
  - `referral_source: "direct"` is no longer fabricated when no browser context was present — "we never saw a visitor" and "a visitor arrived with no campaign" are now different values.
  - The internal `x-agent-native-signup-attribution` handoff header is stripped from every inbound request instead of only being overwritten on email signup. It is unsigned and outranks the request cookie, so an inbound copy let any client write the `anonymous_id` and campaign onto someone else's signup row.
  - The `webhook` tracking provider now sends `anonymousId`, which it silently dropped.

  Signup counts will fall to the real number. The removed rows were duplicate and backfilled events, not lost users.

## 0.172.7

### Patch Changes

- be8c373: Fix Analytics chat composer drafts to prefer the stable tab identity over a late-arriving thread identity, preventing typed text from disappearing when the draft scope changes.

## 0.172.6

### Patch Changes

- 415a6d8: Transform virtual runtime modules before serving them to embed sessions. The
  dev middleware loaded `/@id/__x00__virtual:*` modules through
  `pluginContainer.load`, which returns plugin source with bare specifiers
  intact, so react-router's `inject-hmr-runtime` reached the browser still
  importing `virtual:react-router/hmr-runtime`. Any page loaded on an origin
  that had an `an_embed_session` cookie failed to hydrate and hung on a spinner.
- 3fa1b09: Allow organization members to queue Run now for Factory-domain jobs they can already load, without widening Mail or CRM automation edit rights.
- 6f0392b: Prevent unconfigured LLM engine tests from reporting a false pass.

## 0.172.5

### Patch Changes

- 5a6204c: Rework Calendar's docs into the new per-app format (Overview, Features, Talk to the Agent, Multi-App Workspace, Developer Guide), add a Comparison per-side accent color and a Cards calendar icon, and translate all five Calendar doc pages into every supported locale.

## 0.172.4

### Patch Changes

- 680268e: Send PostHog AI feedback in the shape its LLM analytics feedback view actually reads. A thumbs vote now answers the survey's first question with PostHog's choice index (`1` up, `2` down) instead of the string `"thumbs_up"`, and the free text after a thumbs-down answers the follow-up question (`$survey_response_1`) rather than overwriting the rating. A vote and the text it opens share one submission id per rated message, so PostHog joins them into a single response, and the vote stays marked incomplete until the follow-up arrives. `POSTHOG_AI_FEEDBACK_SURVEY_ID` is the whole configuration; `POSTHOG_AI_FEEDBACK_SURVEY_QUESTION_ID` is no longer read.
- 680268e: Fix PostHog LLM analytics showing the assistant's reply as part of the prompt. The agent loop appends its own turns to the message array it is handed, and the trace read that array after the run, so `$ai_input` / `$ai_input_state` carried the run's final transcript instead of its request — PostHog rendered the same assistant message in both Input and Output. The request is now snapshotted before the loop can grow it.
- 680268e: Stop sending the app's tool definitions to PostHog. `$ai_tools` shipped the whole catalogue — for a large app, dozens of tools with full descriptions — on every generation, and it is identical on every call. The calls that actually happened are already named in `$ai_output_choices` and carry their own spans.
- 680268e: Report failures at the layer that failed, and never as a bare flag. `$ai_is_error` could travel without any `$ai_error` — every failed tool span did exactly that with the default `captureToolResults: false`, so PostHog showed "error" and nothing else. All three emitters now fall back to a stated reason, add PostHog's `$ai_error_type`, and say when a tool's error text was withheld rather than never reported. The levels mean distinct things: a generation is failed only when the model call itself failed (a provider error or a stream dropped mid-call), a span when the tool crashed or returned an error, and the trace for everything else — step budgets, timeouts, no-progress cut-offs. A tool that stopped the run no longer marks the model call that preceded it as failed, and a run's terminal outcome rides only the layer that actually failed.
- 680268e: Send each PostHog event's own time at the payload root instead of inside `properties`, where PostHog treated it as an ordinary custom property and stamped the event with its ingestion time. An agent run emits its trace, generation, and every tool span in one burst when the run ends, so a five-minute run rendered as a 100ms waterfall with its steps in flush order rather than the order they ran.
- 680268e: Emit one `$ai_generation` per model round-trip instead of one per run, and parent each tool span under the generation that requested it. A multi-step agent run rendered in PostHog as a single generation spanning the whole run — a 15-call, 5-minute run drew one 5-minute "model call" — because the run's aggregate usage was reported as if it were one request. Each generation now carries its own prompt, answer, tools, latency, tokens and cost, and `$ai_request_count` counts that call rather than the run, so per-request pricing is right. Run totals (`llm_calls`, `tool_calls`, `successful_tools`, `failed_tools`, `time_to_first_token_ms`, `latency_source`) moved to `$ai_trace`. An engine that never brackets its calls with `model_stream` still falls back to a single aggregate generation. The trace no longer carries `$ai_input_state` / `$ai_output_state`: with every round-trip carrying its own prompt and answer, those repeated the first call's prompt and the last call's answer on a second event. A generation is also no longer marked failed when the run failed after the model answered — a tool that aborted the run, a step budget, or a cut-off now shows on the tool span and the trace, not on a model call that succeeded.
- 680268e: Three fixes to per-round-trip generations. A tool the run's death interrupts is now associated with the call that requested it — the association is recorded when the tool starts, since an interrupted tool never reaches the completion path and used to hang under the trace root, missing from its generation's counts. A model call the provider failed is marked failed even though its stream bracket closes on the way out, so a provider error is no longer reported as a healthy call and a retry no longer leaves the failed attempt green. And a call that reported its tokens keeps them when a later call throws: usage was gated on the loop's aggregate return value, which never arrives on a throw, so every call that had succeeded lost its tokens and cost.
- 680268e: Report `$ai_stop_reason` on each generation, and stop discarding an oversized trace payload wholesale. The engine already knew why every model call ended (`end_turn`, `tool_use`, `max_tokens`, …) and never passed it on, so a truncated answer was indistinguishable from a finished one; the `model_stream` close event now carries it. Content over the 128KB ceiling used to be replaced entirely by a placeholder — a 244KB conversation left nothing at all in the trace. An oversized message list now keeps the last user message behind a marker naming how much was dropped — what was asked is what a trace is opened for, and it stays small. `input_truncated` / `output_truncated` still mark anything cut, so a partial payload can never read as a complete one.

## 0.172.3

### Patch Changes

- 0fedac0: Prebundle `diff-match-patch` so the collab text-to-Yjs path loads in the browser.

  `diff-match-patch@1.0.5` ships one CJS file with no ESM entry. It is reached from
  `collab/text-to-yjs.ts`, which in monorepo dev mode is a source-aliased core
  module excluded from dep prebundling, so Vite never scanned the import and served
  the dependency verbatim — its trailing `module.exports` lines threw in the
  browser. It now has a default `optimizeDeps.include` entry like the other CJS
  dependencies core reaches from client code.

## 0.172.2

### Patch Changes

- f208c0e: Stop later tool calls in the same assistant message from running while an action
  waits for human approval.

  The approval gate told the model "the turn is paused" and set
  `requestedActionStop`, but that flag is only read after the tool loop finishes.
  The flag that actually suppresses the remaining calls is `turnYieldedToUser`,
  which the approval path never set — so on `[write(needs approval),
delete(no approval)]` in one message, the human saw an approval card for the
  first while the second had already executed. The approval branch now yields the
  turn like any other action that hands control to the user, and the message shown
  for a suppressed call names the approval case as well as the ends-turn case.

  A gated call is also no longer eligible for parallel batching. `flushParallelBatch`
  dispatches a batch through `Promise.all`, so a gated call and its siblings all
  start before the gate is reached and the suppression lands too late to stop a
  sibling that already ran. Any action declaring `needsApproval` or `endsTurn` is
  now serialized, which is what makes the suppression meaningful for the calls
  after it.

## 0.172.1

### Patch Changes

- bad078e: Expose developer resources, explicit when-to-use guidance, and complete Markdown cache headers in generated agent-web surfaces.

## 0.172.0

### Minor Changes

- 5da9484: Add durable action-level approval preferences and recoverable harness checkpoints.

### Patch Changes

- bd7384b: Scope sidebar toggle events to the matching app chat surface.
- 4fa0d0c: Harden the shell command policy and the untrusted-text prompt boundaries.
  - `classifyCodeAgentCommandPermission` now matches its blocked and
    approval-required rules against the quote-stripped form of the command as well
    as the raw text. The shell removes quoting before the command word exists, so
    `git 'checkout' main`, `gi''t checkout main`, `drizzle-kit "push"` and
    `rm -'r'f /` previously ran as unclassified writes. A command using `$'…'`
    escaping, which this pass cannot decode, now asks for approval instead of
    falling through.
  - `runCodingCommand` settles on `exit` with a short grace for `close` instead of
    waiting on `close` alone, and spawns detached so a timeout signals the whole
    process group. A command that backgrounds anything (`npm run dev &`) left a
    grandchild holding the output pipe and the call never returned — past its
    timeout too, whose `SIGTERM` went to an `sh -c` wrapper that had already
    exited. When output is cut short this way the result says so rather than
    reading as a clean finish.
  - Automation trigger payloads are capped, wrapped in `<event_payload>` tags with
    an explicit untrusted-data instruction, and no longer sit ahead of the
    automation's own body — the same defense `condition-evaluator.ts` already
    applied before this data reached a tool-less classifier, now applied on the
    path that reaches an agent with the full tool surface.
  - Prompt `<resource>` blocks escape both halves of the fence in the body, so
    shared `AGENTS.md`/`LEARNINGS.md` content cannot forge a block header and pass
    itself off as framework instructions.

## 0.171.3

### Patch Changes

- 2292fac: Allow shared loading spinners to provide localized accessible labels.

## 0.171.2

### Patch Changes

- 3afcb54: Add pin, reorder, and reload actions to workspace app rail context menus.

## 0.171.1

### Patch Changes

- c56a23e: Preserve explicitly safe stopped-action error codes and details across browser action transport.

## 0.171.0

### Minor Changes

- f60345d: Add `auth.requireEmailVerification` to the app config schema, aliased to
  `AUTH_REQUIRE_EMAIL_VERIFICATION`, so a deployment can state its password-signup
  verification policy instead of inheriting the environment-derived one.
  `AUTH_SKIP_EMAIL_VERIFICATION` stays a local/QA-only convenience that hosted
  deployments ignore; a declared value outranks it. Setting the field to `false`
  accepts an unverified address as a login credential and therefore also lifts the
  hosted no-email-provider signup lock, which exists to prevent exactly that;
  setting it to `true` where no email provider is configured disables password
  signup rather than stranding accounts on a verification that cannot be delivered.

### Patch Changes

- f60345d: Stop the dev server from warning that the `agent-native-config` plugin set both `rollupOptions` and `rolldownOptions`. Vite 8 exposes `rollupOptions` as a getter alias of `rolldownOptions`, and spreading the incoming `build` / `optimizeDeps` sections copied that alias back out alongside our own `rolldownOptions`.

## 0.170.0

### Minor Changes

- 185cd15: Add managed, service-specific Google OAuth connections with personal or workspace sharing.
- ac1b0df: Let a deployment refuse framework default plugins and narrow which integration
  platforms mount, without writing a stub plugin file.

  `plugins.disabled` (env `AGENT_NATIVE_DISABLED_PLUGINS`) names default plugin
  slots the framework should not auto-mount — the same list that shows up as
  `[agent-native] Auto-mounting N default plugin(s)` under `DEBUG`. It is honored
  by the runtime bootstrap and by the generated edge worker entry, so a slot is
  withheld on every host. An app that ships its own `server/plugins/<slot>.ts` is
  unaffected.

  `integrations.platforms` (env `AGENT_NATIVE_INTEGRATION_PLATFORMS`) is an
  allow-list of platforms for the integrations plugin, matched against each
  adapter's `platform` id. Unset mounts every adapter, as before; a name no
  adapter provides throws at plugin init rather than silently mounting a set
  nobody asked for.

  Both switches withhold registration rather than reject at request time: a
  refused slot never runs its plugin, so its routes are absent from the
  middleware chain and its background jobs and pollers never start. The
  allow-list now also gates the routes mounted under a platform's literal name —
  `/slack/interactions`, `/slack/manifest`, and the two Slack OAuth endpoints
  previously stayed mounted whatever the adapter set was. They are gated only
  when `integrations.platforms` is declared, so a deployment that does not set it
  keeps today's behavior.

  A misconfigured value in either switch is reported, not absorbed. An unknown
  slot name in `plugins.disabled` fails at `getH3App()` rather than inside the
  best-effort auto-mount catch, and the allow-list mismatch throws a typed
  `AppConfigurationError` that the auto-mount catch rethrows — otherwise a typo
  left the deployment reporting success with whole route trees missing.

### Patch Changes

- 0dc3cdd: Add `mcpTool` and `important` to `defineAction`, so an action declares its external-agent exposure and its first-request tool slot beside itself instead of in a plugin-level name list. `mcpTool` defaults to `agentTool`, so hiding an action from the agent hides it from outside agents too; declaring it overrides that inheritance in both directions. `mcpTool: false` hides an action from every MCP tier and the direct A2A surface (including the `--full-catalog` opt-in) while the in-app agent keeps calling it, `mcpTool: true` is the action-owned form of `mcp.connectorCatalog` membership, and `agentTool: false` with `mcpTool: true` makes an action MCP-only — external agents get it, the app's own agent does not. `deferLoading: false` keeps an action in the agent's first tool list and narrows the derived default to the actions that opted out of deferral, the action-owned form of `initialToolNames`; `deferLoading: true` pushes one behind `tool-search`. Both name lists keep working, so an app can migrate one action at a time.
- c595519: Fix the chat-first workspace apps rail's active app having no visible selection indicator in both the collapsed and expanded rail layouts.
- af1b3bb: Stop a transient boot failure from permanently breaking sign-in. `getBetterAuth()` cached its init promise before that promise settled, so one failed
  initialization — a busy database connection or a momentary pool error — was replayed as a rejection to every later caller for the life of the process, and the only
  recovery was a restart. The failed attempt is now cleared so the next request re-initializes.

  The local database boot path now uses the same URL and file-resolution helpers as the app, and transient initialization failures are retried consistently.

  Separately, the injected beta environment switcher opened its stylesheet with a bare `color-scheme: dark;` declaration. A declaration at stylesheet top level
  is not a parse error that ends at its semicolon — the next qualified rule's prelude absorbs it, so `.environment-switcher` was dropped entirely and the badge
  lost `position: fixed`, rendering in normal flow at the bottom-left of the page instead of pinned to the viewport corner.

- c595519: Fix `get-auth-methods` returning a 401 for callers the framework authenticated without a Better Auth session cookie (e.g. AUTH_DISABLED dev sessions), which made the Account settings password row always show the no-password state.
- 163d02c: Center the beta badge hide control and balance its surrounding spacing.
- 1253471: Route new-user magic-link callbacks before the generic handler so signup links with nested query parameters do not receive a 405.
- 9735e4d: Add localized fallback labels for the desktop agent picker mode options.
- c595519: Fix the Builder connection-status route's OAuth-custody branch silently reporting a failed key-pair lookup the same way as confirmed-absent keys, by resolving the detailed credential lookup and surfacing a distinct `keyLookupFailed` flag.
- da0e7b8: Builder OAuth now relies on the shared credential lifecycle for refresh single-flight and reconnect state instead of duplicating them in `settings` rows. The `builder-oauth-refresh:*` lease and `builder-oauth-reconnect:*` flag are gone; a failed refresh latches `reconnect_required` on the credential itself. Adds `markOAuthReconnectRequired` (and the `markMcpOAuthReconnectRequired` MCP wrapper) so a server-side 401/403 rejection can force reconnect through the credential rather than a side channel.

  Builder OAuth is scoped to the caller's organization: every member of an org shares one Builder connection and token, resolved from the authenticated user's own org membership. Every user belongs to an org, so there is no per-user fallback — a missing org is a broken invariant that fails loudly rather than silently creating a personal connection. Previously every user shared one `account_id`, so under the `(provider, account_id)` primary key only the first person to connect could hold a grant and everyone else was refused.

  Because the grant is shared, connecting (which overwrites it) and disconnecting (which revokes it for everyone) require org owner/admin authority.

- 6c2e431: Show a terminal raw-source error when a persisted registry block cannot hydrate instead of leaving it indefinitely loading.
- baedb60: Fetch the headless browser at launch instead of embedding it in every serverless function. `@agent-native/creative-context` now depends on `@sparticuz/chromium-min` (46KB) rather than `@sparticuz/chromium` (66.4MB), and passes a version-pinned pack URL to `executablePath()`. The hosted Builder Browser path is unchanged and still preferred; this only affects the local-launch fallback, which now downloads the pack once per container. Set `AGENT_NATIVE_CHROMIUM_PACK_URL` to serve the pack from your own mirror. Measured on slides: server function 126.0MB → 59.6MB, total upload 243.8MB → 111.0MB.
- c595519: Fix the shared `code` and `code-tabs` block specs so inserting one from a slash menu seeds real content instead of an empty `__raw` string — previously the freshly inserted block got permanently stuck on "Loading code block…" (or a terminal load error) because neither spec had an `empty()` factory.
- aba438a: docs: correct the Clips Rewind documentation. Rewind is Clips' own local rolling recording, not a rewind.ai integration, and the pre-roll section is renamed to the product's "Add what happened before" and nested under Rewind.
- baedb60: Stop shipping the unused database fallback in serverless function bundles. Every consumer is gated on `DATABASE_URL`, and a serverless function cannot safely persist database files because its filesystem is ephemeral and each container gets its own copy. Denying the fallback turns that misconfiguration into a loud failure instead of silently empty data. The denylist applies to the netlify, vercel and aws-lambda presets only, so local development is unaffected. ~1.9MB per emitted function dir.
- c595519: Fix the dev-server speculation-rules endpoint 404ing on the browser's real `Sec-Fetch-Dest: speculationrules` auto-fetch, logging a console error on every page load in `pnpm dev`.
- 43c4adb: Allow transactional email definitions to re-register after a development hot reload while still rejecting conflicting catalog metadata for the same id. Add atomic, app-owned snapshot registration so conflicting or deleted catalog entries cannot leave partial or stale definitions behind while owned metadata changes refresh safely.
- c595519: Fix EnvironmentBadge causing a React hydration mismatch on public SSR pages by deferring its content to a post-mount effect instead of branching on `typeof window` during render.
- 8f6fd63: Shorten production lane opt-out to eight hours, add a per-page badge hide control, and support `?force=true` for a browser-session production override.
- cdd69e8: Stop background polling and event streams in app surfaces an embedding host has hidden. An Electron `<webview>` guest keeps reporting `document.visibilityState === "visible"` while its element is `display: none`, so every visibility-based pause in the client was inert inside the desktop shell and each backgrounded app tab kept polling at its foreground cadence and holding its event stream open. Hosts can now declare visibility explicitly with `buildSurfaceVisibilityScript`, and `useDbSync` treats a host-hidden surface as paused regardless of `pauseWhenHidden`.
- 1390bed: Use production agent URLs for stale localhost peer manifests on every hosted runtime, including beta Netlify functions.
- 49a2ab5: Honor explicit sidebar-open deep links and ignore stale loopback remote agents in hosted runtimes.
- c759425: Restore the loud failure when an unresolved `getDb()` query chain is embedded as a raw value instead of being awaited. drizzle duck-types SQL entities by reading `getSQL`/`shouldOmitSQLParens` synchronously, so the lazy cold-start proxy answering that probe with another proxy produced `RangeError: Maximum call stack size exceeded` deep inside drizzle instead of naming the misuse. The guard was lost as collateral in a wholesale revert of `packages/core/src/db`.
- 8be5618: Cut seconds off chat list reads and serverless cold starts.
  - `listThreads`/`searchThreads` no longer filter on `thread_data`. Matching that
    blob detoasted the entire message history for every scanned row before `LIMIT`
    applied; measured on production beta, the same 20-row response went 2207ms →
    222ms with the predicate removed. Schema migration 3 backfills
    `source_platform` for the legacy integration rows the predicate used to catch.
  - Added expression indexes for the access-scoping predicates that wrap columns in
    `LOWER()` — `chat_threads`, `chat_thread_shares`, and `token_usage`. A plain
    btree cannot serve a function-wrapped comparison, so these lists were scanning
    whole shared tables.
  - Moved `clientAbortReason` into a leaf module so the agent chat server plugin no
    longer pulls the agent run loop into its static import graph. That graph costs
    ~1.2s to evaluate and every cold serverless start paid it, including requests
    that only render a page.

- 7a87f76: Build the `LOWER(...)` expression indexes without `CONCURRENTLY`.

  The release schema step runs over the pooled Neon endpoint, and a
  transaction-pooled connection cannot carry `CREATE INDEX CONCURRENTLY` to
  completion. The statement returned without creating the index, the verifying
  probe then failed the whole release, and every docs production deploy was
  blocked. Plain `CREATE INDEX` is the form that actually lands here.

- ee03f3c: Fix PostHog LLM analytics events so trace, span, and generation metrics match PostHog's schema and aggregation.
  - `$ai_time_to_first_token` is now sent in seconds. It was being handed the millisecond value verbatim, inflating every time-to-first-token in LLM analytics 1000x.
  - The `$ai_trace` event no longer carries `$ai_latency`, `$ai_input_tokens`, `$ai_output_tokens`, or `$ai_total_cost_usd`. PostHog derives all four from a trace's children, and summed the trace's own `$ai_latency` alongside them — reporting roughly twice the real run duration. The run totals now ride along as `duration_ms`, `input_tokens`, `output_tokens`, and `cost_usd` for backends that do no such aggregation.
  - The generation's `$ai_latency` is measured model time rather than the whole run, so tool duration is no longer counted both in the generation and in its sibling tool spans. It is read from the `model_stream` start/end brackets the agent loop already emits once per LLM round-trip, which close before any tool of that turn starts. Engines that do not bracket their model calls fall back to backing tool time out of the run duration — counting overlapping tools once, and leaving in the time of tools that `captureLlmSpans` or the per-run span cap keeps out of PostHog, since no sibling span would carry it. The new `latency_source` property records which of the two produced a given `$ai_latency`.
  - A tool `$ai_span` is timestamped at the tool's start rather than its completion. PostHog draws a span forward from its event timestamp by `$ai_latency`, so a completion-stamped span rendered the tool beginning where it ended and running past the end of its own trace.
  - `$ai_request_count` reports the run's real LLM round-trip count instead of a hardcoded `1`, which undercharged multi-step runs on request-priced models.
  - `$ai_trace` now carries `$ai_input_state` / `$ai_output_state` when `capturePrompts` is on. PostHog reads a trace's input and output only from that event, so the trace detail view was empty.
  - Successful tool calls now record their result on the span under `captureToolResults`, so a healthy tool span reports an output instead of looking like a tool that returned nothing.
  - AI events are stamped with when they happened rather than when the run flushed. `track()` accepts an `occurredAt`, so a trace tree keeps a real timeline instead of collapsing into one instant.
  - `$ai_stream` is set, which is what makes `$ai_time_to_first_token` meaningful.
  - Custom properties no longer use an `$ai_` prefix (`$ai_input_truncated` → `input_truncated`, `$ai_spans_dropped` → `spans_dropped`). That namespace is PostHog's schema and a name it does not define today it may define tomorrow.

- 6078255: Stop shipping unreachable browser and SSR modules in scheduled-sweep function clones, and deny-list puppeteer. `pruneBrowserRuntimeFromNonAgentClone` drops `@sparticuz/chromium` and `playwright-core` from a clone whose entry rewrites the pathname to a route that cannot reach an agent turn — it throws rather than guessing when the entry names an agent-capable path, because the browser is loaded through a non-literal dynamic import that no static walk can prove dead. Analytics' six cron sweep clones each shed 87.5MB. Separately, `puppeteer`, `puppeteer-core` and `chromium-bidi` join the serverless package denylist: Nitro traced them from officeparser's PDF-output branch, which nothing in this repo reaches.
- 6e647cb: Stop shipping the SSR page/asset module island inside the background and integration-recovery function clones. Those entries overwrite `url.pathname` unconditionally before delegating to `main.mjs`, so they can never route to the page or asset handlers they inherited — yet Netlify zips and uploads every function separately, so the island was paid for on every deploy. The pruner walks the clone's real import graph (including backtick dynamic imports) and refuses to prune at all when a relative dynamic import cannot be resolved statically. Measured on calendar: total upload 42.2MB → 35.8MB.
- 9f4efc1: Prevent the environment badge from changing the server-rendered tree before hydration completes.
- 9895d21: Keep Builder design-system hydration in progress until the provider confirms completion, including explicit status metadata from docs responses.
- cc4d122: Hide managed Google OAuth integrations and onboarding until the shared client credentials are available.
- d14cffb: Revert keep-warm concurrency. Measured on production and it changed nothing:
  before 8/10 requests cold, after 9/10 and 8/10, and 6/6 cold at 25s spacing.
  Netlify does not hold these containers long enough for warming to matter — a
  container is reused at a 2s gap and already cold again by 8s — so no cron
  cadence or concurrency can help. Restores one warm request per minute rather
  than paying 3x the scheduled invocations and health-probe round trips for no
  effect.
- cbc95d4: Avoid loading full workspace resource content during metadata list reads.
- 628b822: Remove the in-loop no-progress watchdogs, which were failing healthy runs far more often than they caught wedged ones.

  Two 90s bounds ran for the whole model stream — one on silence between engine frames (`MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS`), one on a tool input whose byte count stopped growing (`ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS`) — plus a zero-byte tool-input restart tripwire. Each inferred a dead stream from the absence of a particular event, and that inference cannot be made on the Anthropic transport: the SDK drops the provider's `ping` keepalives before any consumer sees them (`core/streaming.js`: `if (sse.event === 'ping') continue;`, with no opt-out), so a model composing a large tool argument is indistinguishable from a wedged socket.

  That is normal operation, not an edge case. Only a tool declared for eager input streaming emits anything at all while its arguments are generated, so a long file write or a long structured result is a content-silent window whose length is set by the size of the argument. In one production deployment, 2 of 27 one-shot analyst runs completed; the guards added for reliability were the thing taking it away.
  - `ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS` and its deadline are gone, including the `earliestStartedAt` fallback that anchored the bound to a start time it never advanced past, and the `Math.min` that let it override a demonstrably live stream.
  - `MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS` and its deadline are gone.
  - The zero-byte restart tripwire is gone (`ACTION_PREPARATION_ZERO_BYTE_RESTART_LIMIT`, `noteZeroByteToolInputStart`, `resetZeroByteToolInputRestart`).
  - The two run-lifecycle invariants asserting an ordering between those bounds and the run-manager backstop are gone with them.

  One in-loop bound survives: the pre-first-frame cap on the clamped hosted foreground runtime, where the ~57s platform wall arrives before the engine's own 120s abort could. The first real frame releases it, so long first tokens, long thinking, long tool inputs and long outputs are all past it by construction; off that runtime there is no in-loop deadline at all.

  Real failures keep the bounds that key off evidence rather than absence: the engine's `FIRST_STREAM_EVENT_TIMEOUT_MS` for a stream that opens and never speaks, the run-manager backstop outside the stream, the per-tool execution timeout, the chunk/run budget, and the stale reaper. The trade is explicit: an in-stream wedge after the first frame is now caught by the run budget rather than at 90s, because no clock in the loop could tell it apart from a model writing a large tool call.

  Separately, `runAgentLoop` now takes the caller's real chunk budget instead of re-deriving one. It asked `resolveRunSoftTimeoutMs` for the generic background ceiling (13 min) even when the caller was a background automation, whose budget is its own hard abort minus headroom (10 min − 20s). The per-tool ceiling came out above the run budget, so every per-tool timeout on that path was dead code and the chunk boundary won instead — the exact inversion `RUN_TOOL_TIMEOUT_HEADROOM_MS` exists to prevent, reintroduced by guessing at a number the caller already had.

  Also records liveness forensics when a stale reaper flips a run to `errored`. `stale_run` is the largest terminal outcome on the one-shot automation path and the row said nothing about why — `error_detail` is a fixed sentence for every reap, so a correct reap and a false one were indistinguishable afterwards. The reap now records which of the three stale windows applied, whether the row was redispatchable, time since heartbeat and since progress, whether the in-flight grace was in play, and — the discriminator — how far the heartbeat ran AHEAD of the last real progress. A worker that died takes its heartbeat with it and scores ~0 there; a worker still alive while the agent loop stopped producing scores in the thousands of seconds. Those are opposite bugs that look identical in `agent_runs` today. Diagnostics only: nothing reads it to make a decision, it cannot change whether a row is reaped, and it shares the single `diag_stage` write with the existing recovery outcome rather than overwriting it.

  Also gives the direct-provider engines the total-request deadline they never had, and the resumed rounds the budget they actually have. `createFirstEventAbortController` is now two-stage: the first real frame releases the 120s first-event bound and arms a 14-minute `STREAM_TOTAL_TIMEOUT_MS` on the whole call, mirroring what builder-engine already applies to its own gateway requests. That matters for the runtimes with no outer budget — local dev and self-hosted resolve the soft timeout to `0`, so the deleted watchdog was the only thing standing between them and a socket that wedges after the first frame. It is a total-request bound, not a no-progress bound, so it cannot fire on healthy content-silent generation. The AI SDK path now also reports a deadline abort as an error rather than letting it fall through as a clean `end_turn`, which is a truncated turn reported as a complete one. Alongside it, `runAgentLoopWithResume` hands each round its own `roundTimeoutMs` rather than the whole invocation's, and the main chat handler passes the chunk budget it already resolved into the loop instead of leaving it to re-derive a generic ceiling — the same inversion as the automation case, two call sites over.

  A cancelled request is also no longer classifiable as a timeout. `fireTimeout` recorded its message before checking whether the composed controller had already been aborted, and the parent-abort path left the deadline armed — so a timer firing while the provider settled after a user Stop or a run-budget abort set `didTimeout()`, which is exactly what the engines read to decide a failure was the transport's fault and retryable. The ordering was pre-existing, but harmless while the first frame cleared the timer outright; a deadline that now runs for the whole stream made the window the whole stream. A timeout is recorded only when this controller wins the abort race, parent cancellation clears the deadline, and a frame that lands after a Stop cannot re-arm one.

- 41aa6e2: Let a manual automation run target a resource path, including the generic `run-automation-now` action and manage-automations `run-now` tool, so automations nested under `jobs/` (such as per-factory jobs) can be run immediately instead of failing with "A valid automation name is required." Preserve application-owned frontmatter when automation status is written back after a run, and dispatch local runs back to the inbound request host when present.
- efbde51: Cut and ratchet serverless function payload size.
  - Replace the unused database fallback with a throwing stub in serverless function bundles.
    Every consumer is gated on `DATABASE_URL`, and a serverless
    filesystem cannot safely persist database files because each container gets
    its own copy. The stub drops the 1.9MB binding from every emitted function
    and turns that misconfiguration into a loud, specific error instead of
    silently empty data. Only the netlify, vercel and aws-lambda presets are affected; local
    development against a `file:` URL is unchanged.
  - Run an app's `scripts/prune-serverless-functions.ts`, when it exists, as part
    of `agent-native build` rather than leaving it to be chained afterwards. The
    build's function size report and budget previously measured a directory that
    app-owned pruning then changed, reporting sizes up to 19MB above what
    actually shipped.
  - Drop the orphaned dependency closure when the serverless browser runtime is
    pruned from a clone that can never run an agent turn. Deleting the two known
    directories left packages behind that existed only because
    `@sparticuz/chromium-min` or `playwright-core` needed them; the prune now
    walks the closure and removes what nothing still-present depends on.

- c595519: Fix `SettingsTabsPage` merging tabs into duplicate, non-adjacent settings nav sections (with duplicate React keys) whenever a different group's tabs sat between two tabs sharing the same group id.
- af1b3bb: Derive the chat model selection localStorage key through one exported helper, `chatModelSelectionStorageKey`. `useChatModels` takes the raw key while `MultiTabAssistantChat` takes only the namespace suffix, so a hero composer that passed the same string to both wrote to a different key than the chat beside it and never saw its model picks.
- af1b3bb: Show a retryable error in the share popover when the shares read fails, instead of leaving the panel in a permanent loading skeleton.
- 6e647cb: Cut serverless function payloads across every app. `@xterm/*` is now stubbed out of the SSR graph by default (it is only reachable through a `React.lazy` boundary the server can never take), and `formatExtensionHtml` loads `prettier/standalone` plus the four plugins the HTML printer actually reaches instead of prettier's main entry, which `import()`s all 13 parsers and inlines ~3.5MB of flow/typescript/yaml parsers. Measured: calendar 46.7MB → 21.1MB, docs 51MB → 26MB.
- baedb60: Trim dead weight from every serverless function: skip the six Bare-runtime-only packages the browser tree declares but Node can never load, delete playwright-core's trace viewer / HTML reporter / codegen recorder / CLI (`lib/vite`, `lib/tools`, `bin`, `cli.js`), and strip `.d.ts` files from bundled `node_modules` — no runtime resolver reads the `types` condition. Measured on slides: playwright-core 13MB → 7MB, total upload 268.7MB → 247.6MB.
- Updated dependencies [6c2e431]
- Updated dependencies [af1b3bb]
- Updated dependencies [c595519]
- Updated dependencies [9735e4d]
- Updated dependencies [15b86eb]
  - @agent-native/toolkit@0.16.11

## 0.169.1

### Patch Changes

- 4de4af3: Point missing-provider recovery errors to Settings > Agent > AI providers.
- 4de4af3: Keep Dispatch workspace-app URLs shareable by seeding embedded apps from deep links and reflecting child route changes in the Dispatch URL.
- 4de4af3: Stop shipping unused native database packages to deployments. The deploy bundler now includes only database code that the emitted bundle actually imports. Measured on the docs app: server function 55.9MB → 46.6MB.
- Release all public npm packages with a patch version bump.
- 4de4af3: Keep chat turns queued through transient server-run handoffs and delay missing-final warnings until the run state settles.
- 4de4af3: Show the Connect AI setup for desktop chat relay failures and keep other recovery actions compact.
- Updated dependencies
  - @agent-native/recap-cli@0.5.8
  - @agent-native/toolkit@0.16.10

## 0.169.0

### Minor Changes

- c90e034: Make background agent runs recoverable, observable, and tunable.

  A scheduled or queued automation runs the agent loop in-process, with no HTTP
  body to re-POST and no server-driven continuation behind it. The run manager's
  no-progress backstop nevertheless checkpointed for a continuation nobody was
  going to run: it aborted the run's top-level controller, which is the same
  signal the in-invocation recovery loop is gated on, so a healthy run that went
  quiet for 150s between a completed tool and the next token was recorded as a
  terminal `no_progress` failure.
  - A checkpoint on a run that opts into `recoverChunkBoundaries` now ends the
    CHUNK, not the turn. `runAgentLoopDirectWithSoftTimeout` accepts the
    `RunChunkControl` `startRun` hands its `runFn` and continues, using the
    continuation budget that was already there. A user Stop, a hard timeout, and
    the cross-isolate abort check still end the turn immediately.
  - The background automation runner is instrumented with `instrumentAgentLoop`,
    so scheduled runs produce `$ai_trace` / `$ai_span` events and local trace-store
    rows under their real owner instead of nothing. `instrumentAgentLoop` gained a
    `spanName` option and now forwards `metadata` to PostHog, so an automation is
    identifiable there.
  - Boundaries are recorded: a `run_boundary_reached` diagnostic naming the
    segment that went silent, an `agent_run_boundary` analytics event dimensioned
    by reason and by whether a continuation followed, and a `captureError` for a
    checkpoint that terminates a run.
  - `automation_runs` gained an `error_code` column, written from the code the
    failure taxonomy already computed. That code, and the run's duration, now ride
    the existing `automation.run.finished` event — which already fires from every
    path that records a terminal outcome (the runner, the scheduler's dispatch
    failures, remote execution), and is therefore the terminal hook an application
    needs.
  - The run-lifecycle bounds live in one place each, beside the ordering
    relationships that constrain them, and those relationships are asserted. Two
    are configuration — `agent.backgroundRunHardTimeoutMs` and
    `agent.backgroundNoProgressTimeoutMs` — because those are facts about the host
    and the deployment; the rest stay constants, because a number with two homes
    needs a test to keep them in step and that test is the tell that it should
    have had one home. The background no-progress default is clamped to the chunk
    it guards, so lowering the global soft timeout cannot leave it unreachable.
  - On a run that recovers boundaries in-invocation the run manager no longer arms
    its own soft-timeout timer: the agent-loop wrapper already races that same
    wall with a cumulative per-round budget, so a second timer fired exactly when
    the wrapper had nothing left to continue with. One wall, one clock.
  - Trace finalization can no longer alter the run it observes. Assembly ran
    unguarded inside a `finally`, where a throw replaces the block's result — so a
    malformed payload could report a completed run as failed. That check
    catches the pair that shipped violated: the automation runner took a 13-minute
    chunk budget under its own 10-minute hard abort, so its recoverable boundary
    was dead code. The runner now derives that budget from its own hard abort.

- c90e034: Give the continuation-chain guard and stale-run recovery one turn-run budget.

  The ceiling on run rows for a logical turn was written three times: the chain
  bound `MAX_BACKGROUND_RUN_CONTINUATIONS` (20), an inline
  `turnRunCount > MAX_BACKGROUND_RUN_CONTINUATIONS + 5` in `production-agent.ts`,
  and a hand-maintained literal `25` in `run-store.ts` whose own comment asked the
  next editor to keep it in sync, because importing back would have been circular.

  The cycle is gone now that the base value is configuration and `app-config`
  imports no agent code, so both sites read `resolveTurnRunLedgerBudget()` with
  the slack named `TURN_RUN_LEDGER_SLACK` and its reason recorded: the two bounds
  count different things — handoffs a chunk decided to make versus every run row
  the turn produced, including sweep redispatches and recoveries — which is why
  the ledger must sit strictly above the chain bound. A spec pins the
  relationship.

  Both call sites compared `turnRunCount > budget` while the current run's row was
  already inserted and counted, and the successor's row is inserted after the
  check — so at equality they permitted one row past the documented ceiling. They
  now call a `turnRunLedgerExhausted()` predicate, so the two cannot disagree
  about the boundary again.

  Also removes `DEFAULT_BACKGROUND_RUN_SOFT_TIMEOUT_MS`, an exported alias for
  `BACKGROUND_SOFT_TIMEOUT_CEILING_MS` with no source caller; use the ceiling (or
  `resolveBackgroundSoftTimeoutCeilingMs()`) directly.

  No behaviour change: every resolved value is what it was.

### Patch Changes

- c90e034: Enforce the client-above-server follow budgets against resolved configuration.

  The browser's per-turn follow budgets must stay above the server's own ceilings,
  because the client fires on a clock and cannot tell looping from working while
  the server can. They shipped inverted once — 10 min / 6 runs against a 13-minute
  legal chunk — and killed healthy turns the server was still streaming, which was
  the top non-auth cause of "the chat just stopped".

  That relationship was pinned in `agent-chat-adapter.spec.ts` against the
  server's module constants. Making those constants configurable moved the real
  values out from under the test without moving the test: a deployment could raise
  `maxTurnWallClockMs`, `maxBackgroundRunContinuations`, or
  `backgroundSoftTimeoutCeilingMs` past what the shipped client can follow, and
  every check still passed.

  The client budgets now live in `app-config/run-lifecycle-invariants.ts` (which
  has no runtime imports, so the browser bundle is unaffected) and
  `assertRunLifecycleInvariants` asserts all three relationships against the
  resolved configuration. The spec keeps pinning the defaults — one fails fast on
  a bad default, the other on a bad deploy.

  Comparing the configured numbers alone also hid a real inversion in the shipped
  values, so the check now uses the EFFECTIVE server limits: the turn ceiling is
  tested at chunk boundaries, so a turn passing it one chunk short still gets a
  whole further chunk (90min + 13min against a client following 95min), and the
  durable ledger allows the chain bound plus the recovery slack in run rows
  (20 + 5 = 25 against a client following 24). Both were inverted. The client
  follow budgets move to 110 minutes and 30 runs so the shipped defaults are
  consistent; killing a turn that is not progressing is still covered by the 210s
  idle timeout and the repeated-terminal-reason detector, neither of which is a
  clock on the whole turn.

- c90e034: Close two acceptance-criteria gaps from the background-run hardening.

  A hard-aborted run reached PostHog carrying "Agent run was aborted" —
  byte-identical to what a user pressing Stop produces, because the abort is what
  the loop observes and `$ai_error` derives its code from the terminal outcome.

  Fixed at that source rather than per-caller: the agent-loop wrapper now reports
  a server-owned abort reason as a `failed` outcome carrying that reason as its
  code, which is what its own no-timeout path has always done. The code therefore
  reaches `$ai_error` through the existing construction, for every entry point
  rather than just automations. The reason set is an allowlist, not "anything that
  isn't `user`", because the abort route accepts a client-supplied reason string
  and an inverted test would relabel a genuine Stop.

  `backgroundSoftTimeoutCeilingMs` is not merely a bound — it IS the clamp
  `resolveRunSoftTimeoutMs` reduces every background soft timeout to. Making it
  configurable therefore left the one number that keeps a chunk inside the host's
  background-function wall unbounded, so a deployment could raise it past that
  wall and turn every long background turn back into the silent platform kill the
  ceiling exists to prevent. The invariant check now asserts it against
  `BACKGROUND_FUNCTION_WALL_MS` minus the headroom a chunk needs to checkpoint;
  the shipped 13-minute value sits exactly on that margin.

- c90e034: Stop reporting every unlabelled agent run as `foreground`.

  `emitRunTerminalTrackingEvent` defaulted `dispatch_mode` to `"foreground"` when
  a caller passed none — and the interactive chat handler is the only caller that
  passes one. Five others (background automations, agent teams, webhook handlers,
  harness runs, the docs poller) passed nothing, so the default was wrong every
  single time it applied.

  Measured consequence: on one deployment, scheduled and manually-dispatched
  automation runs were failing with `no_progress` at 6 of 7 while interactive chat
  sat at 2 of 190 — and both were labelled `foreground`, so the failing path was
  indistinguishable from the healthy one in the only view where anyone would have
  looked.

  `dispatch_mode` is now absent when the caller did not supply one, so "not
  recorded" and "was foreground" stop being the same value; the background
  automation runner passes the `"background"` it already writes onto its own run
  row; and the durable background worker, which reaches the interactive handler's
  `startRun` call site, reports `"background"` instead of inheriting the
  foreground label from a flag that only describes self-chaining. Passing it cannot disturb the runner's self-claim: `insertRun` is
  `ON CONFLICT DO NOTHING`, so `startRun`'s insert is a no-op for a claimed row.

## 0.168.13

### Patch Changes

- f2f60b9: Move the environment badge to the bottom-left, show a truthful dev badge during configured local development, raise Dispatch controls above it, and give default notifications enough clearance to avoid overlap.

## 0.168.12

### Patch Changes

- 51b31ed: Format localized core documentation after the release sync.

## 0.168.11

### Patch Changes

- dc0978d: Fix action request context to use the forwarded workspace gateway origin instead of the internal dev proxy host.

## 0.168.10

### Patch Changes

- d9b6279: Fix desktop Google sign-in against a local dev server. `X-Agent-Native-Desktop-Verifier` is now in the shared CORS allow-header list used by every preflight short-circuit (the Tauri dev renderer origin `http://localhost:1420` is answered by the dev server, which never reached the auth CORS handler that already allowed the header), and a localhost origin receives `Access-Control-Allow-Credentials` when `NODE_ENV === "development"` so the desktop app's credentialed calls work locally. Production credential rules are unchanged.

## 0.168.9

### Patch Changes

- e5e6934: Automatically replace a missing saved chat thread with a fresh chat in multi-tab hosts.
- e5e6934: Cache 404 and 410 SSR shells with the same public CDN policy as 200 shells. They previously carried `no-cache`, so every dead link, stale bookmark, renamed slug and crawler miss re-invoked the render function — the same URL cost a full cold render on every request. Netlify runs one request per container, so those invocations drew from the account-wide concurrency pool other sites share. 5xx stays uncacheable, and 401/403 are deliberately excluded.
- e5e6934: Add a Google sign-in credential self-check at `/_agent-native/health/google`.

  The callback returns an identical error page for a wrong client secret and a
  stale authorization code, so a broken credential is invisible from outside
  while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
  Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
  a transport failure is never reported as valid — plus whether the deploy
  carries two credential pairs naming different Google clients.

- e5e6934: Keep desktop app chat immediately available while app tabs load, and allow hosts to start fresh chat threads without restoring history on mount.
- dd80d09: Keep the full workspace credential workflow reachable from the redesigned integrations catalog.
- 127606d: Sync localized overview documentation with the current English guides.
- e5e6934: Refresh integration and Dispatch app surfaces with connected-first layouts and two-column cards.
- e5e6934: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.8

### Patch Changes

- 81fa180: Show immediate tooltips for apps and navigation controls in the collapsed chat-first rail.

## 0.168.7

### Patch Changes

- a1d24db: Automatically replace a missing saved chat thread with a fresh chat in multi-tab hosts.
- a1d24db: Cache 404 and 410 SSR shells with the same public CDN policy as 200 shells. They previously carried `no-cache`, so every dead link, stale bookmark, renamed slug and crawler miss re-invoked the render function — the same URL cost a full cold render on every request. Netlify runs one request per container, so those invocations drew from the account-wide concurrency pool other sites share. 5xx stays uncacheable, and 401/403 are deliberately excluded.
- a1d24db: Add a Google sign-in credential self-check at `/_agent-native/health/google`.

  The callback returns an identical error page for a wrong client secret and a
  stale authorization code, so a broken credential is invisible from outside
  while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
  Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
  a transport failure is never reported as valid — plus whether the deploy
  carries two credential pairs naming different Google clients.

- a1d24db: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.6

### Patch Changes

- 186d913: Allow encrypted public-upload fallback blobs to delete their backing Builder or S3 assets, and fail closed when an explicitly selected private blob provider is unavailable.

## 0.168.5

### Patch Changes

- 60aaea8: Keep app surfaces mounted when a host temporarily disables the chat sidebar.

## 0.168.4

### Patch Changes

- 4e1ce88: Automatically replace a missing saved chat thread with a fresh chat in multi-tab hosts.
- 4e1ce88: Add a Google sign-in credential self-check at `/_agent-native/health/google`.

  The callback returns an identical error page for a wrong client secret and a
  stale authorization code, so a broken credential is invisible from outside
  while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
  Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
  a transport failure is never reported as valid — plus whether the deploy
  carries two credential pairs naming different Google clients.

- 4e1ce88: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.3

### Patch Changes

- 97e8cea: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.2

### Patch Changes

- 8617890: Generate the canonical public stale-while-revalidate headers for Netlify static build artifacts and guard prerendered apps against the platform default cache policy.

## 0.168.1

### Patch Changes

- 07e0de3: Show the personal or workspace scope choice before connecting an integration in an organization, including a clear owner/admin requirement for members.
- 68265a5: Forward hosted provider setup callbacks through `AgentSidebar` so Electron chat can show its native AI connection action after sign-in, and allow the native integrations surface to route OAuth through the authenticated app webview.

## 0.168.0

### Minor Changes

- 6203d5d: Add an About Agent-Native command surface for inspecting deployed framework package versions and diagnostics.

## 0.167.5

### Patch Changes

- d3210d7: Make documented `AGENT_NATIVE_CONFIG_*` environment aliases override typed and JSON public configuration defaults.

## 0.167.4

### Patch Changes

- 8b73951: Isolate workspace app chat history and keep short chat-tab titles clear of the close target.

## 0.167.3

### Patch Changes

- 1aafc1d: Keep authenticated Electron app sessions on their configured production lane instead of applying the browser-only employee beta redirect.
- 40baf42: Preserve browser attribution through Better Auth email signup user creation.
- 1aafc1d: Avoid treating the desktop broker identity as proof that an app's own session is authenticated.

## 0.167.2

### Patch Changes

- 95d9d70: Bound public-site monitor requests and clarify unified-diff framing in visual recap authoring prompts.
- 7f22204: Warn on the Agent Automations page when schedule-triggered automations can never fire — recurring jobs disabled at build time, no durable scheduler on the hosting target, or local development — via a new `get-scheduled-trigger-status` action. The build embeds its recurring-jobs decision into the server bundle so the warning reflects whether a scheduled trigger was actually emitted, and a failed status check is reported as unverified rather than healthy.
- Updated dependencies [95d9d70]
  - @agent-native/recap-cli@0.5.7

## 0.167.1

### Patch Changes

- ca9ee7e: Merge same-day changelog categories without duplicating headings.

## 0.167.0

### Minor Changes

- 3a7a8f0: support deterministic environment aliases and JSON fragments for public Agent-Native config

## 0.166.1

### Patch Changes

- 8fd035c: Keep authenticated Electron app sessions on their configured production lane instead of applying the browser-only employee beta redirect.
- Updated dependencies [10de7b9]
  - @agent-native/recap-cli@0.5.6
  - @agent-native/toolkit@0.16.9

## 0.166.0

### Minor Changes

- c50b009: Allow request action resolvers to preserve the default tool-loading surface.

## 0.165.5

### Patch Changes

- 8d56ed2: Let the Builder gateway engine run on an OAuth-only connection. The pre-run
  credential gate required a `BUILDER_PRIVATE_KEY`/`BUILDER_PUBLIC_KEY` pair, so
  a user connected through Builder OAuth alone had every turn rejected with "No
  LLM provider is connected" while the connect card reported them connected.

## 0.165.4

### Patch Changes

- 841f072: Expand changelog history windows to 100 releases while preserving folder-backed history.

## 0.165.3

### Patch Changes

- b6ca1a7: Warn when `GOOGLE_SIGN_IN_CLIENT_ID` and `GOOGLE_CLIENT_ID` name different Google clients. Sign-in silently preferred the sign-in pair, so repairing `GOOGLE_CLIENT_SECRET` on a deploy that also set `GOOGLE_SIGN_IN_CLIENT_SECRET` changed nothing while appearing correct.
- b6ca1a7: Harden MCP OAuth reconnects for mounted apps, legacy settings, and concurrent updates.
- b6ca1a7: Ensure prebuilt Netlify workspace deployments include the hosted feedback URL.

## 0.165.2

### Patch Changes

- b130f4e: Keep app changelogs compact while preserving folder-backed history in the in-app What's new surface.
- ac3acfa: Improve provider failure recovery and remove the retired Videos template from Dispatch app creation.

## 0.165.1

### Patch Changes

- 43ef3a8: Fix reconnecting existing OAuth-backed MCP servers in place.

## 0.165.0

### Minor Changes

- b39f22c: Stop regex lookaround from 400ing the whole model turn, and give three
  always-on core kits a `frameworkTools` switch.
  - `stripUnsupportedSchemaKeywords` now drops a `pattern` containing lookaround
    (`(?=`, `(?!`, `(?<=`, `(?<!`). Anthropic rejects it with "regex lookaround is
    not supported" and rejects the entire request, so one such tool takes every
    other tool in the payload down with it — visible as an error in chat, and as
    nothing at all in a background run. `z.string().email()` compiles to two
    negative lookaheads and appears in ~35 action schemas, so this is answered at
    the boundary every tool passes through, alongside the existing typeless-schema
    and unsupported-`format` rewrites. The action's own zod schema still validates
    the value, so nothing that was enforced is loosened.
  - `emailCatalog`, `workspaceUserGroups`, and `orgServiceTokens` are new
    `frameworkTools` groups covering twelve actions that previously had no switch.
    All three default to on, so the available surface is unchanged — but they are
    now tagged, which takes them out of every app's default first-request tool
    list and leaves them reachable through `tool-search`.
  - `mcp.catalog: "app"` alongside `mcp.connectorCatalog` now throws at plugin
    init. `catalog: "app"` short-circuits the connector tier, so the two together
    served the app's full registry while the allow-list sat in the config looking
    authoritative.

### Patch Changes

- 483f03d: Stop the run-level no-progress backstop from killing runs while the model is
  still generating. Two watchdogs guarded the same silence on different clocks:
  the agent loop's `lastModelStreamProgressAt` bumps on every engine frame, while
  the run manager's backstop only sees events the loop forwards. Extended thinking
  produces the first without the second, so the 150s bound sat inside the working
  distribution — runs whose worst gap crossed it were checkpointed as
  `auto_continue { reason: "no_progress" }` and recorded as errors while still
  streaming, some missing by a single second, and background automations discarded
  results the agent went on to finish minutes later.

  The agent loop now brackets each engine call with a `model_stream` start/end
  pair, and the run manager counts it exactly like `tool_start`/`tool_done`: an
  engine call in flight suspends the backstop, bounded by the loop's own 90s
  model-stream watchdog the same way a tool call is bounded by its own timeout.
  Keepalives still do not count as progress, so a wedged transport with no engine
  call in flight trips the backstop as before.

  Background automation failures now also report through `captureError`. Both
  callers — the recurring-jobs scheduler and the trigger dispatcher — recorded the
  failure onto the automation's own metadata and logged it, and neither reported
  it, so a cut-off automation was visible only in a resource field and stdout.

  A cut-off run now reports a terminal state instead of none. `runAgentLoop`
  returns early at an `auto_continue` checkpoint and never reaches its outcome
  classification, so a truncated run shipped `terminal_state` and `error_message`
  as null and the reason was recoverable only from `agent_run_events`. Unplanned
  boundaries (`no_progress`, `stream_ended`, `gateway_timeout`, …) now surface as a
  retryable failure carrying the reason as the terminal code, while the planned
  `run_timeout` chunk boundary — which a hosted foreground run hits roughly every
  40s by design — records its reason without counting as an error.

- Updated dependencies [60b7e74]
  - @agent-native/toolkit@0.16.8

## 0.164.26

### Patch Changes

- d5ceae9: Preserve the beta environment opt-out when custom authentication pages are served.

## 0.164.25

### Patch Changes

- 562194a: Stop sending `temperature` on model requests that carry Claude thinking. Effort
  defaults to High on every reasoning-capable Claude model, so internal callers
  that asked only for `temperature: 0` — the Observational Memory compactor, eval
  judges, sentiment inference — always got a 400 ("`temperature` may only be set
  to 1 when thinking is enabled or in adaptive mode"). The Anthropic, AI SDK, and
  Builder gateway engines now drop the sampling parameters when thinking is on or
  when the model family removed them, and Observational Memory compaction runs at
  low effort so thinking cannot consume its whole output budget.

## 0.164.24

### Patch Changes

- 14a3f87: Preserve the beta environment opt-out when custom authentication pages are served.
- 14a3f87: Keep BYOA sign-in and liveness routes available while unrelated serverless bootstrap work is waiting on the database.

## 0.164.23

### Patch Changes

- b811566: Preserve the beta environment opt-out when custom authentication pages are served.

## 0.164.22

### Patch Changes

- 7bb5be0: Reject host-native database binaries in Netlify server bundles before publication.
- 7bb5be0: Persist beta-to-production opt-outs from the cached sign-in shell for 24 hours.

## 0.164.21

### Patch Changes

- 68f299c: Clarify deployment targets and document Agent-Native app configuration.

## 0.164.20

### Patch Changes

- bfe4163: Report Telegram webhook registration failures instead of treating rejected `setWebhook` responses as successful setup.

## 0.164.19

### Patch Changes

- 5f4031b: Restore ownerless legacy app visibility while preserving explicit private defaults for new apps.

## 0.164.18

### Patch Changes

- b34de4c: Report Telegram webhook registration failures instead of treating rejected `setWebhook` responses as successful setup.

## 0.164.17

### Patch Changes

- d492462: Support TipTap mark rule helpers in generated SSR stubs.

## 0.164.16

### Patch Changes

- 7d72340: Keep desktop Google exchanges alive through longer passkey ceremonies while retaining one-time verifier binding.

## 0.164.15

### Patch Changes

- 3f1cf50: Send signed-out users directly to the shared sign-in journey after logout so private app data queries cannot flash before the session gate redirects.

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
