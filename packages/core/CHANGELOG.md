# @agent-native/core

## 0.15.7

### Patch Changes

- d4c9097: Polish Builder connect completion by avoiding loopback callback URLs and refreshing connected chat UI.

## 0.15.6

### Patch Changes

- 54e65a6: Keep Builder connect on the active preview deployment and route chat reconnect buttons through the signed popup flow.
- 54e65a6: Keep Builder CLI auth connect URLs fresh and preview-aware in embedded Builder editor contexts.

## 0.15.5

### Patch Changes

- 86dbcea: Refresh Builder connect links inside popup click flows and use Google OAuth popups for Builder iframes.

## 0.15.4

### Patch Changes

- Refresh Builder connect links inside popup click flows and use Google OAuth popups for Builder iframes.

## 0.15.3

### Patch Changes

- b2d1228: Use popup Google sign-in for Builder web iframes and bridge the returned session back into the embedded preview.

## 0.15.2

### Patch Changes

- 73dbe40: Allow signed Builder connect flows to complete through workspace gateway origins without requiring the iframe host's session cookie.

## 0.15.1

### Patch Changes

- 10dc17f: Improve Builder preview Google OAuth popup completion, diagnostics, and callback error propagation.
- 10dc17f: Keep the pre-hydration theme script's resolved data-theme in sync with the html class.

## 0.15.0

### Minor Changes

- f400c81: Two additions to core:
  - **`AppearancePicker` + `change-appearance` action.** New per-user appearance presets (`warm` / `ocean` / `forest` / `rose` / `slate` + the default) that override the base HSL theme tokens. The runtime reads `localStorage["appearance"]` in the inline theme-init script and sets `<html data-appearance="...">` before hydration, so there's no first-paint flash. Exports: `APPEARANCE_PRESETS`, `applyAppearance`, `getStoredAppearance`, `useAppearance`, `AppearanceSync`, `AppearancePicker`. The agent can change the active preset via the new `change-appearance` core sharing action — auto-registered through `mergeCoreSharingActions`, so every template inherits it.
  - **`guard-extension-no-public.mjs`.** New CI guard wired into `pnpm guards`. Statically refuses any change that drops `allowPublic: false` / `requireOrgMemberForUserShares: true` from the extension shareable registration, or that introduces a string literal / raw SQL flipping an extension row to `visibility = "public"` outside the framework-level `set-resource-visibility` action. `sharing` skill updated to document the two new registration flags and point at the guard.

- b5b6f22: New optional `emptyStateAddon` prop on `AssistantChat` — content rendered in the empty state above the suggestion buttons. Used by `MultiTabAssistantChat` to surface "previous chats for this design" when the current thread is empty but the scope has other threads. No behaviour change when the prop isn't passed.
- 2eb5064: `PromptComposer` + `TiptapComposer`: inline image attachments, attachment-only composer-mode sends, and active-voice cancellation on submit. Image files attached to the composer are now sent inline as `<uploaded-image name=… contentType=…>` data-URL blocks alongside the existing pasted-text / inline-text flattening. Composer modes (`/code`, `/research`, etc.) now also accept submissions with no text when attachments are present — the default prompt becomes "Use the attached context." and the attachments survive the wrap in the mode's prefix + `<context>` block. Every send / build intercept path also cancels any in-flight voice dictation so a late transcript can't land on top of the just-sent message.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` (plus `BuilderConnectFlow` / `BuilderConnectFlowOptions` types) from `@agent-native/core/client`. Both hooks already powered the in-framework SettingsPanel's Builder.io connect flow; surfacing them lets templates reuse the same status read + connect-flow state machine in their own settings UIs without duplicating the SSE / popup-handshake plumbing.
- f400c81: Polish + appearance presets:
  - Sign-in page: add a favicon `<link>` to the onboarding sign-in and reset-password HTML so tabs no longer show the default globe.
  - Sign-in page: suppress the on-screen Google OAuth status overlay ("OAuth exchange redeemed; returning to the app (flow …)" and friends) for end users. Diagnostics still log to the browser console; the overlay can be opted back in with `#oauth-debug` or `?oauth_debug=1` for debugging.
  - Feedback popover: placeholder now leads with concrete examples ("e.g. 'The Send button isn't obvious'…") so users have a clearer prompt than "Tell us what's on your mind…".
  - **New: Appearance presets.** Users can pick a color theme without editing source. Adds a `change-appearance` action (auto-mounted everywhere) that the agent can invoke as a tool, a `<AppearancePicker />` React component for Settings pages, a `useAppearance` / `useAppearanceSync` hook pair, and CSS preset overrides (`warm`, `ocean`, `forest`, `rose`, `slate`) layered on top of each template's base palette via `<html data-appearance="…">`. The theme init script now also applies the stored preset on first paint to avoid FOUC.
  - Agent system prompt now includes a short first-session personalization flow: greet, ask two yes/no questions (theme preset via `change-appearance` plus one template-specific preference), then mark `application_state.personalization = { done: true }` so it never re-asks.

- d1a90ac: Image uploads and drag-and-drop, framework-wide.
  - New `upload-image` agent action — converts a base64 data URL or remote URL into a hosted CDN URL via the active file-upload provider (Builder.io by default, or any provider registered with `registerFileUploadProvider` — S3, R2, GCS, etc.). Auto-registered for every template alongside the sharing actions; the agent now has an explicit tool to materialize chat-attached or generated images as stable URLs for slides, documents, and outbound messages.
  - File-upload registry now uses a `globalThis`-backed singleton. The previous module-level `Map` could be evaluated more than once in some Vite/Nitro bundle-split scenarios — the plugin that called `registerFileUploadProvider()` lived in one module instance and the request handler / server-side pre-upload lived in another, so the call site saw an empty map even though registration succeeded. Custom providers (S3/R2/GCS) and the dev-mode upload path now both see the same map regardless of how the bundler chunked them; Builder.io was unaffected because it has an env-var fallback in `uploadFile()`.
  - Server-side pre-upload of chat image attachments: when a user attaches an image to the agent composer, the framework now uploads it through `uploadFile()` before the model runs and injects a `<chat-image-attachment url="..." />` block at the bottom of the user message. The model still receives the image as multimodal vision content; it just also has the hosted URL to embed in HTML. If no provider is configured, the framework injects a `<chat-image-attachment-upload-error>` block instructing the agent to suggest connecting one.
  - Chat-wide drag-and-drop: the agent sidebar now accepts file drops anywhere on the chat surface (thread, header, composer), not just inside the contenteditable. A "Drop to attach" affordance highlights the chat while files are being dragged over it.
  - Slides drag-and-drop fixes: `/api/assets/upload` now routes uploads strictly through the framework `uploadFile()` provider chain. The previous local-disk path that wrote into `public/uploads/` is gone — it didn't persist on serverless deploys and polluted the source tree on dev runs. With no provider configured, the endpoint returns a clear 503 telling the caller to connect Builder.io (or any registered provider). `listAssets` / `deleteAsset` no longer scan local disk; listing is a no-op for now (until a SQL-backed asset index lands), and deletes go through the provider's own API. Drops anywhere on the slides editor — including the chrome and sidebars — are caught instead of letting the browser navigate to the file; drops outside a placeholder/`<img>` open a popover that hands the image off to the agent chat for the user to describe what to do with it.

- f400c81: Two related additions to the realtime + agent layer:
  - **Per-source change-version primitive.** New `useChangeVersion(source)` / `useChangeVersions(sources)` / `getChangeVersion` / `bumpChangeVersion` exported from `@agent-native/core/client`. Every `recordChange` event carries a `source` and `version`; `useDbSync` now bumps a per-source counter on each event and templates fold the counter into their React Query `queryKey`, so a change to `"dashboards"` only refetches dashboard queries instead of triggering a blanket cache invalidate across the app. Framework-level keys (`action`, `extension`, `application-state`, …) keep their universal invalidate; template data keys (`data`, `dashboards`, `analyses`, `dashboard-views`) no longer do — they react through the per-source counter. Analytics templates updated as the first consumer (CommandPalette / Sidebar / sql-dashboard / AnalysesList).
  - **Scoped chat tabs in `AgentPanel` / `MultiTabAssistantChat`.** New optional `scope?: ChatThreadScope | null` prop on `AgentPanel`. When set, the tab bar partitions per `(storageKey, scope)` so each deck / dashboard / record shows its own thread list, new chats inherit the scope server-side, and the panel renders a "Working on {label}" badge with a Detach button to escape back to the unscoped tab list. Pairs with the server-side `scope_type` / `scope_id` / `scope_label` columns + `setThreadScope` already in `chat-threads/store.ts`.

- ffd3d00: Add first-class workspace app audience metadata with route-level public/protected page access.
- d1a90ac: `ShareButton` now accepts an optional `shareUrlPlaceholder` prop. When the primary `shareUrl` is undefined the popover shows the placeholder inside a subtle dashed-border slot instead of hiding the link section silently. Use it to tell respondents _why_ there's no link yet (e.g. "Publish this form to get a public response link") so the popover doesn't look broken on draft / unpublished resources.
- 5f59f44: Browser tracking now sends a persistent `anonymousId` (visitor ID) and a `sessionId` with a 30-minute idle timeout on every event posted to the Agent Native Analytics `/track` endpoint. Both IDs are stored in `localStorage` and degrade gracefully to NULL when storage is unavailable (private browsing). Unique-visitor and session metrics in the analytics template now have real data to aggregate against; previously these columns were always NULL for anonymous traffic.
- c6defe7: Real-time sync, take 2: per-source change counters.

  The previous attempt — invalidating every active React Query on any non-own change event — caused a request storm on the analytics dashboard (461 pending requests, polls timing out at the 10s abort). This change replaces it with a targeted, default-on mechanism:
  - New `useChangeVersion(source)` and `useChangeVersions(sources)` hooks return an integer that advances every time the server emits an event with that source (`"dashboards"`, `"analyses"`, `"action"`, `"settings"`, `"app-state"`, etc.). `useDbSync` keeps a per-source counter and bumps it from every poll/SSE event it sees.
  - Templates fold the counter into the relevant React Query `queryKey`. When the source advances, the queryKey changes and React Query refetches that one query — no whole-cache invalidate, no fanned-out refetches across unrelated panels. `placeholderData: (prev) => prev` keeps the old data on screen during the refetch so there's no flicker.
  - `useDbSync` reverts to invalidating a small fixed list of framework-internal prefixes (`["action"]`, `["app-state"]`, `["__set_url__"]`, etc.) and no longer touches templates' own data queries. The legacy `queryKeys` option remains in the type signature for backward compatibility but is ignored.
  - Analytics' dashboard / analysis / sidebar / command-palette queries are wired up. Other templates can adopt the same pattern by importing `useChangeVersion` and including it in their query keys; recommended sources include `"dashboards"`, `"analyses"`, `"settings"`, and `"action"` (the agent runner emits `source: "action"` after every successful mutating tool call, so depending on it catches any agent-driven change to the underlying data).

- 5f59f44: New `usePinchZoom` hook exported from `@agent-native/core/client` for canvas-style editors. Wires trackpad pinch (synthesized as `wheel` events with `ctrlKey: true`) and 2-pointer touchscreen pinch onto a scrolling container, with cursor-anchored zoom-to-cursor support and configurable `min` / `max` percentages. The slides template adopts it on the deck-editor canvas; any template with a zoomable surface can drop it in by attaching the returned ref to the scroll container.

### Patch Changes

- d1a90ac: Agent chat: when the user sends a new message after scrolling up to read history, scroll back to the bottom so the new message and reply land in view. Previously the sticky-bottom override (which exists to stop streaming from yanking the viewport) also swallowed direct sends, leaving the user stuck in old history.
- ffd3d00: Emit agent sidebar open-state events so custom toolbar buttons can track when the chat panel opens or closes itself.
- d1a90ac: Local-dev convenience: skip the sign-up wall on a freshly-scaffolded app. When `NODE_ENV=development` and the `user` table has no rows for any email other than `dev@local`, the auth guard transparently signs up + signs in an auto-managed `dev@local` account on the first page GET and 302s back to the original URL with the session cookie set. A developer who just ran `pnpm dev` lands in the app immediately instead of being asked to fill in name + email + password to try the framework. Once a real user signs up via the regular form, the email-filter short-circuit fires and this helper returns null on every subsequent request, so the normal login flow takes over. Set `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` to opt out.
- 5f59f44: Docs only: spell out the auto-refresh contract in the default-template and starter `AGENTS.md` so newly-scaffolded apps know that agent writes must reflect in the UI without a manual refresh. Use `useActionQuery` (auto-covered) or fold `useChangeVersions([<source>, "action"])` into raw `useQuery` keys. Mirror the framework `adding-a-feature` and `real-time-sync` skills into `packages/core/src/templates/default/.agents/skills/` and `templates/starter/.agents/skills/` so scaffolded apps inherit the same guidance.
- d1a90ac: Builder credential resolution: implicit-org fallback + trace logging.
  - `agent-chat-plugin`: when `session.orgId` is null (Better Auth leaves it null until the user explicitly switches orgs), fall back to `getOrgContext()` to pick up implicit org membership. A fresh signup with a domain-matched org now sees its org-scoped Builder credentials instead of looking unconnected.
  - `resolveSecret`: log every Builder credential lookup (`[resolve-secret]` lines covering hit/miss + scope + email + orgId). "I connected Builder but chat says no LLM" reports can now be diagnosed from server logs without rerunning the request. Other keys are gated behind `DEBUG_CREDENTIAL_RESOLVE=1` to keep noise low.
  - `core-routes-plugin` builder-connect: log the resolved write scope so we can see which scope (user/org/workspace) a connect actually persisted to.

- d1a90ac: Add inline "Start new chat" button to no-detail Builder gateway error messages. When the gateway returns `{type:"stop",reason:"error",requestId:...}` with no diagnostic, the error UI now renders a one-click CTA next to the message instead of just telling the user to start a new chat manually. The button dispatches an `agent-chat:new-chat` window event that `MultiTabAssistantChat` listens for, matching the existing close-tab event pattern.
- a89082e: Builder reconnect now clears stale credentials before writing the new connection, so reconnecting with a different Builder space actually takes effect.

  `writeBuilderCredentials` previously upserted each new key but left stale rows in place. Two failure modes:
  - Reconnecting with a Builder space that doesn't carry every optional field (e.g. no `orgName`/`orgKind`/`userId`) left the previous connection's metadata behind at the target scope, so the gateway saw a mix of new and old credentials.
  - When a user's first connect wrote at user scope (member or no-org) and a later reconnect wrote at org scope (now owner/admin), the old user-scope row still won resolution — user scope beats org scope by design — so the chat kept using the old Builder space's credentials even though the UI showed the new connection.

  Fix: before writing, delete all five `BUILDER_*` keys at the target scope, and when writing at org scope also delete the writer's user-scope rows. The org-scope row is intentionally left alone when writing at user scope so a single user's personal override doesn't blow away the team's shared connection.

  Reported as "I signed in again with my Builder space not my own one and still telling me I need to upgrade" on 2026-05-11.

- d1a90ac: `builderFileUploadProvider`: retry transient 5xx once with backoff (600ms then 1.8s).

  Builder.io's upload service occasionally returns a bodyless 500 ("Internal Error") on the first attempt — usually GCS write hiccups that succeed on retry. Three template surfaces that hit this on every recording / upload (Clips finalize, attachment uploads, generated-image uploads) now get those transient failures absorbed silently. Deterministic 500s still surface to the caller after the third attempt with the original status + body.

- ad4f135: Keep the in-app agent panel active inside Builder web previews instead of treating them as local dev frames.
- ffd3d00: Recover the agent panel automatically when assistant-ui renders a stale list index.
- ffd3d00: Clarify scoped chat context copy in the assistant sidebar.
- 64792af: Clarify Builder Cloud Agent waitlist guidance so agents do not send users to nonexistent org settings.
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
    at \`npx @agent-native/core add-app\` first since they're already in
    that terminal. The desktop / Claude Code / Codex / Builder.io
    alternatives still follow for general source-editing work.

- ffd3d00: Add Cmd/Ctrl+Backslash as a global shortcut for toggling the agent sidebar.
- 04c3ed9: Coach users through stalled agent tasks with clearer troubleshooting and next-step guidance.
- b5b6f22: `TiptapComposer`: when a caller passes a custom `actionButton`, render only the model selector + plan-mode toggle on the left side (skipping the voice/file/send cluster that the default action-button slot owns). Without this, callers that already render their own send button got a duplicate-looking trailing block. No behavior change when `actionButton` isn't passed.
- 2eb5064: `AssistantChat`: hide the empty user-message bubble when the text content is nothing but an injected `<context>...</context>` block. Previously, sending an attachment-only composer-mode message (e.g. `/code` with a file but no prose) rendered an empty grey bubble in the chat after the context tags were stripped. The message now skips the bubble + expand/collapse UI entirely when the only attachment is context; attachment chips still render above.
- 2eb5064: `useDbSync` + server poll: per-key invalidation for application_state one-shot commands. The poll loop now emits one event per changed (key, owner) pair instead of a single `key: "*"` wildcard, and the client only invalidates `navigate-command` / `show-questions` / `__set_url__` queries when those specific keys actually change. Noisy app-state keys (template-specific UI state, per-tab flags) no longer wake the navigation / question readers on every poll cycle.
- 2eb5064: `useVoiceDictation`: cancelling while the transcription request is in flight now actually drops the response. Previously `cancel()` returned early for any state other than `recording` / `starting`, so once the network POST started, a cancel click was a no-op and the transcribed text would still be inserted into the composer after the user cancelled. The fetch handlers (both success and live-snapshot fallback) now check `cancelledRef` immediately after the await and bail without forwarding.
- 64792af: Keep Builder connect popups from replacing the Agent Native desktop webview.
- ddcc773: Raise shadcn floating-UI primitives (Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Tooltip, HoverCard, ContextMenu, Menubar, Select) from `z-50` to `z-[250]` so modal overlays cover the agent sidebar header (`z-[240]`). Fixes the case where the "Add Calendar" (and similar) modal opens but the agent chat panel underneath stays visible and interactive.
- f400c81: Add `create-pylon-ticket` action to Dispatch for escalating blockers, unmatched `#customer-*` routing, or follow-ups that need tracking — uses `PYLON_API_KEY` from the Vault. Instrument the agent chat with Sentry captures when the auth-error card stays visible past auto-recovery (`auth_error_card_stuck`) and when SSE reconnect times out (`reconnect_no_progress`) so we can chase the "occasional Reload UI required" symptom.
- b7e7d17: Route the Dispatch thread debugger through workspace root aliases.
- 04c3ed9: `workspaceAppRouteAccessFromPackageJson` now returns optional `publicPaths` / `protectedPaths` so consumers can distinguish "field absent" from "field explicitly empty." `workspace-deploy`, `workspace-dev`, and `agent-discovery` prefer the package.json value whenever it was set (even `[]`), so an app owner can clear an inherited manifest override by writing `"publicPaths": []` in its `package.json`.
- f400c81: Restrict extensions to private/org sharing only — extensions execute code in
  the viewer's authentication context, so they must never be `visibility: "public"`
  and user shares must target someone already in (or invited to) the org.
  - Added `allowPublic` and `requireOrgMemberForUserShares` flags to
    `registerShareableResource()`. Defaults match prior behavior; extensions
    opt into both.
  - `set-resource-visibility` rejects `"public"` for any resource registered
    with `allowPublic: false`. `accessFilter` and `resolveAccess` treat any
    stored `'public'` row as private for those resources (defense in depth).
  - `share-resource` verifies the principal email against `org_members` and
    pending `org_invitations` when `requireOrgMemberForUserShares: true`. The
    same flag also pins `principalType: "org"` shares to the resource's own
    org — cross-org org-principal shares would otherwise let an outside org's
    members run extension code in the viewer's auth context (same threat
    model as a public extension).
  - `updateExtension` and the extension `PUT` route refuse `visibility: "public"`
    directly. `list-resource-shares` returns a `policy` block so the share
    popover hides the "Public" option and shows server errors inline.
  - New `scripts/guard-extension-no-public.mjs` (wired into `pnpm guards` /
    `pnpm prep`) statically enforces that the extension registration keeps
    both flags set, and refuses `visibility: "public"` literals inside
    `packages/core/src/extensions/`.

- d1a90ac: Fixes for feedback from QA pass:
  - **Content** (`templates/content`): deleting the page you're currently viewing now navigates to the landing page **before** the delete round-trip resolves, so the editor doesn't sit on a now-deleted page while the request is in flight. The page-id route also redirects to `/` when the document fetch returns 404, so refreshing on a stale URL no longer dead-ends at "Document not found".
  - **Design** (`templates/design`): clicking the Edit tab no longer auto-collapses the agent chat. Previously, entering edit mode dispatched `agent-panel:close` so the EditPanel and canvas could share the screen, but the chat dropping out shifted the toolbar and removed the user's working context. Properties and chat now coexist as adjacent right-side panels.
  - **OrgSwitcher** (`packages/core`): clicking "Create organization" or "Invite member" now clears any leftover input from a previous session before entering that mode. Previously, the create form could re-open prefilled with the just-created org's name, making the switcher look like a create dialog for the new org.

- d1a90ac: Several feedback fixes:
  - **Dispatch back-button to `/dispatch/dispatch/overview`.** `dispatchNavLinkTarget` (the helper that decides whether NavLink should manually prepend the workspace mount prefix) read `window.__reactRouterContext.basename` to detect the router's basename. If that global wasn't set yet at render time, the helper double-prefixed the `to` prop, the router then prepended its own basename, and the resulting `/dispatch/dispatch/<route>` landed in browser history — clicking back from any dispatch page later took the user to that 404. The helper now mirrors `entry.client.tsx`'s basename calculation directly from `window.location.pathname`, removing the context-global race. `routerPath` (in both the package and the template copy) also iteratively strips the basename so any doubly-prefixed path that snuck into `application_state.navigate` doesn't get partially-stripped here and re-prefixed by the router back to the bad URL.
  - **"Use Builder" CTA stuck after connect (web).** The Builder upsell CTA in `AgentPanel` opens Builder in a `<a target="_blank">` tab, not a popup, so it never started the `useBuilderConnectFlow` polling loop — `useBuilderConnectUrl` was fetched once on mount and never refreshed, leaving the CTA in the "Use Builder" state after the user came back to the original tab. The callback success HTML now posts a `builder-connect-success` BroadcastChannel + window.opener message (mirroring the existing error-path broadcast), and `useBuilderConnectUrl` listens on BroadcastChannel + `window.message` + `focus` + `visibilitychange` + the existing `agent-engine:configured-changed` event, refetching `/builder/status` on any of them. Also dispatches `agent-engine:configured-changed` when status first reports configured so the rest of the chat tree updates without a full reload.
  - **Firebase `auth/popup-blocked` in desktop Builder connect.** Builder's `/cli-auth` page signs into Google via `signInWithPopup`, which calls `window.open()`. Inside the Electron OAuth `BrowserWindow` we create for the Builder flow, there was no `setWindowOpenHandler`, so Electron's default silently blocked the popup — Firebase reported `auth/popup-blocked`, the parent OAuth window never received the result, and the user saw a blank screen that then closed. The OAuth window now returns `action: "allow"` for https child popups and constructs the child as another `BrowserWindow` sharing the same `session` so Firebase's `window.opener.postMessage` handshake reaches back.
  - **`resolveScopedBuilderCredential` tracing.** The Builder credential lookup walked user → org → workspace silently; when "I connected Builder but chat says use Builder" reports come in, there was no way to tell which scope answered or whether none did. Each branch now logs the scope, email, orgId, and hit/miss outcome (matching the existing always-on tracing in `resolveSecret` for BUILDER\_\* keys).

- ffd3d00: `forkThread` now overlays the in-memory snapshot on top of the persisted row when the snapshot is fresher (more messages) than what's in SQL. Previously, once any version of the source row existed in the database, the snapshot was ignored — so forks could lose the latest unflushed user message, which is exactly the scenario chat-fork-from-unflushed is meant to fix. Guarded with `snapshot.messageCount > stored.messageCount` so a stale snapshot from another tab can't clobber a fresher persisted row.
- ffd3d00: `AgentPanel` no longer emits a synthetic `{ open: false }` sidebar-state event on mount when the parent frame owns the sidebar. The dispatch is now deferred until the frame sends its first `agentNative.sidebarMode` message, so listeners initialize with the real state instead of seeing a false → true flip a moment later.
- 64792af: Avoid double-submitting Builder chat prompts from embedded app composers by using a single iframe transport when a parent frame is available.
- 9c991e1: Keep Builder preview Google sign-in from returning to loopback preview URLs.
- ce9e355: Open primary Google sign-in from Agent Native Desktop through the desktop exchange flow so OAuth can complete in the system browser.
- ce9e355: Add LLM connection context to tracking events and track Builder connect clicks.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` from `@agent-native/core/client` so template settings pages can render a connect-builder button that polls for completion instead of a bare `<a target="_blank">` link.
- 1fd5856: Allow owners to manage legacy unscoped shared resources after joining an organization.
- d1a90ac: Org polish:
  - `InvitationBanner`: while a join-by-domain or accept-invitation request is in flight, render an in-place "Joining {orgName}…" status so the chat panel doesn't look unchanged until the view abruptly swaps.
  - `OrgSwitcher`: `settingsPath` is now optional. When unset, "Workspace settings" only opens the in-sidebar settings panel — suitable for templates without a dedicated team page. Templates that mount one (e.g. Dispatch's `/team`) pass it explicitly.
  - `useOrgMembers` / `useOrgInvitations`: scope the React Query cache by active `orgId` so switching/creating an org forces a fresh fetch instead of briefly showing the previous org's members.
  - `useCreateOrg`: invalidate all queries on success (creating an org switches into it server-side, so every org-scoped query is stale), matching `useSwitchOrg`.
  - Create/invite forms: loader uses flex centering so the spinner stays vertically centred inside the button; close the create-org dialog via the unified `handleOpenChange` so cleanup runs.

- ce9e355: Add app navigation links to the organization switcher, with Dispatch pinned as the workspace hub.
- ffd3d00: Standardize the organization switcher settings link around template team pages.
- ad4f135: Use polling file watchers for workspace dev in managed remote containers to avoid Linux inotify limits.
- 64792af: Recover auth sessions when stale duplicate cookies shadow a fresh sign-in.
- b7e7d17: Hide agent-created scratch resources from workspace file lists by default.
- 64792af: Recover the agent chat message list when assistant-ui briefly renders a stale message index.
- ad4f135: Seed shadcn-aware frontend design skills in generated apps and workspaces.
- 13284b1: ErrorBoundary: "Go home" now triggers a full page reload (was client-side
  `<Link>`), so a signed-out visitor who lands on an error page is taken
  through the server auth guard's sign-in flow instead of getting stuck on
  a logged-in route with failing API calls. Also softens the 404 message
  to a plain "We couldn't find this page." for end users — the previous
  copy mentioned Dispatch and "shipping" routes, which only made sense to
  developers working on workspace apps.
- ffd3d00: Make chat forking work when the source thread has not flushed to SQL yet.
- ffd3d00: Redirect mounted Dispatch workspace roots to the overview page across workspace deploy presets.
- 04c3ed9: Surface workspace app startup timeouts instead of looping forever on the gateway wake screen.
- ce9e355: Send a larger default output-token budget through the Builder gateway so long Plan Mode responses do not inherit a short gateway default.
- ce9e355: Scope agent chat screen and URL context to the originating browser tab.
- d1a90ac: Fix Builder "Upgrade at builder.io" link in chat dropping users on `/app/projects` instead of billing. The link previously deep-linked to `/app/organizations/<BUILDER_ORG_NAME>/billing`, but `BUILDER_ORG_NAME` is the org's display name (e.g. `Nicholas kipchumba Space`), not a URL-safe slug — Builder's router didn't recognize it and silently redirected to `/app/projects`. The CLI-auth callback doesn't expose an org slug or id today, so the link now always points to `https://builder.io/account/billing`, which resolves the active org from session.
- d1a90ac: Promote `upload-image` to a core sharing action: register it in `mergeCoreSharingActions` so every template inherits the agent-callable image-upload tool without each app having to re-declare it in `actions/`.
- ce9e355: Default Dispatch vault access to all workspace apps, add manual grant mode, sync vault keys into encrypted app secrets, and fix org-scoped vault listing.
- ce9e355: Save generated workspace app descriptions, make Dispatch app metadata editable, and include workspace app names/descriptions in A2A agent context.
- ce9e355: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- 64792af: Show workspace dev child-process failures on the startup page instead of hiding them behind a generic reload loop.
- d1a90ac: CLI: probe each app's port before spawning Vite so the workspace dev server doesn't die on a single port conflict. `pnpm dev` previously assigned each app a fixed port (`8100`, `8101`, …) and spawned Vite with `--strictPort` for the gateway routing; if anything on the host already owned that port, Vite failed hard before the gateway could route around it. The workspace now binds a probe TCP socket on each candidate port before commiting to it, increments past collisions, and logs the substitution. The same probe runs in the live filesystem-sync path so a newly-scaffolded app added with `agent-native add-app` doesn't trip on a busy port either. Includes a related CLI scaffolding spinner tweak — the per-app message now distinguishes "Downloading X template…" (slow GitHub fetch) from "Configuring X…" (fast local rewrite) so users don't watch a frozen "Scaffolding…" message during the network step. `runWorkspaceDev` is now async (returns `Promise<WorkspaceDevHandle>`); the two in-tree callers already chained `.then()`, so no external API change.
- ce9e355: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.
- ad4f135: Keep workspace OAuth and app URL resolution on configured public origins before falling back to local workspace gateways.
- b7e7d17: Allow the Workspace tab to load without desktop code access.

## 0.14.8

### Patch Changes

- db11073: Fix workspace scaffolds of `slides` and `videos` failing with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for `@agent-native/pinpoint`. Both templates depend on pinpoint but were not declaring it in `requiredPackages`, so it never got copied into `packages/pinpoint` and the `workspace:*` reference could not resolve.

## 0.14.7

### Patch Changes

- 63e641a: Add rich Sentry tags (model, gatewayOrigin, gatewayRequestId) for no-detail Builder gateway errors and fix the user-facing copy to stop promising auto-recovery and model switching, which don't actually help for this error code.
- 63e641a: Stop `Error: socket hang up` unhandled rejections from polluting Sentry on
  AWS Lambda (Sentry AGENT-NATIVE-BROWSER-4 — 24k events / 199 users in 48h).
  The MCP `StreamableHTTPClientTransport` opens long-lived sockets for SSE
  long-polls; AWS reaps those sockets ~60s after a Lambda invocation returns
  200, and the next thaw delivers a `Socket.socketOnEnd` whose Promise has
  nobody left to await it. Two changes:
  - `server/sentry.ts` `beforeSend` drops `socket hang up` events whose
    mechanism is `onunhandledrejection` and whose stack includes
    `Socket.socketOnEnd` / `node:_http_client`. Real socket-hang-up errors
    with a different mechanism or non-HTTP-client stack still report.
  - `mcp-client/manager.ts` attaches a no-op `transport.onerror` before
    `client.connect()` so SDK fire-and-forget paths (initial SSE stream
    open, scheduled reconnects) can't surface as unhandled rejections in
    the window before Client wires its own handler. `Client.connect()`
    chains its own onerror on top of ours, so post-connect errors still
    flow through the existing `client.onerror` recorder.

- 63e641a: Fix `MessageRepository(addOrUpdateMessage): Parent message not found` unhandled
  rejection in the agent prompt composer (Sentry AGENT-NATIVE-BROWSER-18). The
  assistant-ui local runtime can clear or relink its message map between the
  `append` that adds the user message and the `performRoundtrip` call that
  records the assistant placeholder (history-adapter load, branch reset, repeat
  imports). When that race fires the runtime threw an internal-bug error that
  masked the original error from chatModel.run() and surfaced as a Sentry
  unhandled rejection on the user's first send. The fix patches the underlying
  `MessageRepository.addOrUpdateMessage` to relink the message to the current
  head (or root) when the requested parent is missing, instead of throwing.

## 0.14.6

### Patch Changes

- 7992922: Hide the CLI tab in the agent sidebar when embedded inside the Builder.io frame. Code editing in that context happens via Builder, and the CLI panel only offered a Download Desktop CTA, so the tab added clutter without value. If the persisted panel mode was `cli`, it now auto-switches to `chat` once embedded.
- 7992922: fix(chat): three related chat-history fixes that landed together.
  - New `normalizeThreadRepository()` walks an imported repo, drops messages without an id, and rewrites missing or dangling `parentId` references to the previous-seen message id (or `null` for the head). assistant-ui's `threadRuntime.import()` rejects the whole repo with `Parent message not found` if even one entry has a stale parent, which used to wipe the entire thread on refresh after a partial save. Both `mergeThreadDataForClientSave` (server-side merge) and `AssistantChat`'s import path now run through it.
  - `chat-threads/store` derives `messageCount` from `thread_data` on read via `normalizeThreadRepository`, and drops summary rows where the derived count is `0`. The chat-history sidebar now reflects only real conversations even if a row sneaks in with `message_count = 0`.
  - `isInternalContinuationError` no longer classifies `builder_gateway_error` (or the loose `"gateway error"` message-substring match) as a continuation. PR #634 dropped this code from the client's auto-recover allow-list and capped the server retry budget; this finishes the picture so the visible thread surfaces a normal error card instead of hiding the failure behind the silent-continuation filter.
  - Thread-data writes now use an `updated_at` compare-and-swap retry loop and remerge message history against the latest DB row before each retry, so cross-process serverless writers no longer blindly clobber each other. Client restore/reconnect also refuses obviously stale server snapshots that would replace a richer local runtime.

- 7992922: Add `?authMode=popup` / `?authMode=redirect` query-param override to the Google sign-in flow, allowing per-session testing of either flow without flipping the global `GOOGLE_AUTH_MODE` env var or shipping a default-behavior change.

## 0.14.5

### Patch Changes

- fa3189e: fix(thread persist): every user message was getting duplicated in `chat_threads` because the runtime export (assistant-ui's `saveThreadData`) wrote `attachments: []` while the server-side `persistSubmittedUserMessage` → `buildUserMessage` path omitted the field entirely. The fingerprint used to dedupe in `messageIdentityKeys` couldn't see them as the same message — `[]` and `undefined` hashed differently. Now normalize the attachments slot through `normalizeAttachmentIdentity` (which collapses both shapes to `undefined`) so duplicates merge instead of stacking up as `client_user → assistant → server_user` triples.
- fa3189e: Mirror Google Slides' sharing behavior in the framework `ShareButton` and SSR runtime:
  - Wrap SSR loaders in `runWithRequestContext` so React Router loaders see the signed-in user via `getRequestUserEmail()` / `accessFilter()`. Fixes a bug where shared admins (and even owners) hit 404 on access-controlled SSR routes unless visibility was set to public.
  - `ShareButton` now supports an optional `secondaryShareUrl` (with `secondaryShareUrlLabel` / `secondaryShareUrlDescription`) so a resource can expose two copyable URLs — e.g. an editor link and a read-only / presentation link — in the same share dialog.
  - `shareUrlRequiresPublic` (and the related `shareUrlUnavailableDescription`) is now a no-op and deprecated. Access is enforced on the resource itself, not the URL shape, matching Google Slides — copying a link no longer requires flipping visibility to public.

## 0.14.4

### Patch Changes

- e9d5dac: Return Builder cloud OAuth completions to the active preview proxy host instead of raw loopback URLs.
- e9d5dac: fix(chat): stop the "agent regenerates the reply 4+ times in a loop" runaway when the Builder gateway emits a no-detail error

  End-to-end repro on slides production showed the agent emitting `{activity, tool_start, tool_done, tool_start, tool_done, clear, clear, clear, error}` with `errorCode: "builder_gateway_error"`, then the client sending another `POST /agent-chat` to auto-continue, which got the same gateway error, which auto-continued again — up to **4 server runs for one user message** until the gateway returned 503. Each run wiped visible content via `clear` events and re-streamed from scratch. That's the "agent does some work, deletes its reply, regenerates, gets stuck in a loop" symptom users were hitting.

  Two changes:
  - **client (`sse-event-processor.ts`):** `builder_gateway_error` is no longer in `isAutoRecoverableError`'s recoverable list. That code is the no-detail Builder gateway fallback (gateway emitted `{type:"stop",reason:"error"}` with no explanation — almost always upstream provider giving up: model quota hit, account misconfiguration, opaque downstream failure). The production-agent already retries it synchronously inside the run before the error escapes to the SSE stream, so by the time the client sees it the server has given up — auto-continuing on top of that just sends another POST that hits the same wall. Surfaces the error to the user as a "Something went wrong" card instead of looping up to 32 transient continuations. Also removed `"gateway error"` from the message-substring matcher to stay consistent with the code-based check.
  - **server (`production-agent.ts`):** Cap the in-run retry budget for `builder_gateway_error` at 1 (down from `MAX_RETRIES = 3`). Same rationale — retrying the same call against a misbehaving Builder route rarely recovers, and each retry emits a `clear` event that wipes the user's visible content. Three cycles of "regenerate, clear, regenerate" inside a single run is bad UX for a failure mode where retrying doesn't help. Other retryable codes (`http_5xx`, `builder_gateway_network_error`, rate limits, transport blips) keep the original 3-attempt budget. New `maxRetriesForError(err)` helper gates this so we can extend per-code overrides later without touching the loop.

## 0.14.3

### Patch Changes

- 740bca9: ux(extensions sidebar): trim the section header's right padding from `pr-24` to `pr-20`. The previous value reserved space for icons that were since removed; the new value lines up cleanly with the action buttons that are actually rendered.

## 0.14.2

### Patch Changes

- 704951d: Agent run-store: stop the bug that caused the user-facing `run_terminal_event_missing` error from happening in the first place. The reaper paths (`reapIfStale`, `reapAllStaleRuns`, `cleanupOldRuns`, `markRunAborted`) used to call `appendTerminalRunEvent(...).catch(() => {})`, silently dropping transient SQL errors and stranding reconnecting clients with bare `status='errored'` rows. They now go through `safeAppendTerminalRunEvent` — one retry after a 100ms backoff, then a structured `captureError` to Sentry on persistent failure. `cleanupOldRuns` also broadens its terminal-event-append SELECT to cover the 24h-age UPDATE in addition to the heartbeat-stale one (an old run with a somehow-fresh heartbeat would previously be flipped to `errored` without a terminal event).
- 704951d: Return Builder desktop Google sign-in to the local workspace gateway and bridge the OAuth session back with `_session`.
- 704951d: Stop chat history from "reverting" mid-conversation: `useChatThreads.fetchThreads` now reconciles per-thread instead of replacing wholesale, so a server fetch that arrives a few hundred ms behind a fresh local update no longer rolls the recent-chats list back to older timestamps. The active thread is also kept visible in the History popover (and highlighted as `Active`) even when its `messageCount` is still zero, so a brand-new chat doesn't appear to vanish from the list right after opening.
- 704951d: fix(chat): stop creating empty `chat_threads` rows on every page mount + recover from stale active threads

  Two related fixes that together prevent `chat_threads` from filling up with ghost rows and prevent users from getting stuck on an active id the server doesn't know about:
  - `useChatThreads` no longer optimistically `POST`s `/_agent-native/agent-chat/threads` when synthesizing a thread id for the composer. The previous flow inserted an empty `chat_threads` row (`message_count=0`, no linked `agent_runs`) on every page mount and every "+" click, even when the user never sent a message. The agent run's server-side `persistSubmittedUserMessage` already creates the row idempotently the moment the user sends, so the client just adds the thread to local state. Rows now land in `chat_threads` only when there's a real conversation behind them.
  - When the saved active thread id isn't on the server AND wasn't created locally this session, the hook now drops the user on the most-recent real thread instead of leaving them on a stale composer that the server has no record of. The `newlyCreatedRef` check disambiguates: only optimistic-this-session ids stay active; ids from a previous session whose row was cleaned up get swapped out.

  Per-thread merge in `fetchThreads` (already shipped) keeps in-flight optimistic threads visible until the server learns about them, so the chat list still shows the user's current thread without flicker.

- 704951d: Two small UI primitives:
  - Prompt composer: click an attached image to open a fullscreen preview (Esc / click-outside to close). The thumbnail's X button still removes.
  - Agent sidebar: new `window.dispatchEvent(new Event("agent-panel:close"))` event mirrors the existing `agent-panel:open` so apps can collapse the sidebar programmatically (used by the design template's Edit mode to free up canvas space).

- 704951d: Agent SSE reconnect: replace the cryptic `run_terminal_event_missing` error with the friendlier stale-run message, and persist it back to SQL so future reconnects replay the proper terminal event instead of regenerating it. This path triggers when an `agent_runs` row was flipped to `errored` but the terminal event write was lost (e.g. a reaper's `appendTerminalRunEvent(...).catch(() => {})` swallowed a transient DB error). The user-facing situation is identical to a stale-run reap, so the UI now shows "The agent stopped before it could finish" with `recoverable: true` (offering retry) instead of the debug-string error.

## 0.14.1

### Patch Changes

- 513aac1: fix(chat): recover from chats disappearing from sidebar history

  Two changes that together restore the pre-#621 behavior where the chat history list always reflects the server:
  - **client**: Stop hydrating chat messages from a per-thread `localStorage` cache, and stop synthesizing a fresh UUID active thread inside the `useState` initializer. The cache could mask stale or partially-saved threads, and the synthesized id raced with the agent run's server-side `persistSubmittedUserMessage` create — when the client's `POST /threads` then lost the race, its `.catch` was yanking the freshly-created thread out of local state. Active thread is now resolved against the server's threads list (most-recent fallback if the saved id isn't there); thread messages are loaded from the server. The `agent-chat-active-thread` localStorage key still persists which thread the user last had focused.
  - **server**: Make `POST /_agent-native/agent-chat/threads` idempotent. When the request body's `id` matches an existing thread owned by the same user, return that thread instead of failing on the SQL UNIQUE constraint. This also means a flaky network retry of `POST /threads` no longer 500s after the agent's `onRunPrepared` already inserted the row.

- 513aac1: refactor(agent): extract `runAgentLoopDirectWithSoftTimeout` (the soft-timeout + resumable-error continuation wrapper) out of `agent-chat-plugin.ts` into a dedicated `run-loop-with-resume.ts`, with unit and integration spec coverage for the soft-timeout path, gateway-timeout resume, network-interrupt resume, the `MAX_RUN_LOOP_CONTINUATIONS=6` cap, and upstream-abort handling.

  Also bumps `DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS` from 45s to the existing 55s cap so design generation and other long-output workloads get the full per-call budget Lambda's 75s function limit allows. 55s leaves ~20s headroom for response streaming + the soft-timeout continuation path.

## 0.14.0

### Minor Changes

- 04fe544: feat(agent): resume runs that get cut off by upstream gateway timeouts (Builder gateway, HTTP 502/503/504, serverless function timeouts) or transport-level interruptions (socket hang up, ECONNRESET, fetch failed, stream closed) instead of failing the run.

  The `auto_continue` event's `reason` union picks up two new values — `gateway_timeout` and `network_interrupted` — so clients can show a precise message. Internally the agent gets a one-line continuation note describing how it was interrupted, then resumes from the same conversation prefix (Anthropic prompt cache rescues the latency) and finishes the user's original request without redoing completed work.

- 04fe544: feat(auth): when `COOKIE_DOMAIN` is set (e.g. `.agent-native.com` for first-party deploys where each app is its own subdomain), the framework session cookie is shared across every subdomain. The cookie name becomes the unsuffixed `an_session` and a `Domain=<COOKIE_DOMAIN>` attribute is added on every set/clear, so signing into one app signs the user into every sibling app under the same parent domain.

  Better Auth's session cookie picks up the same domain via its `crossSubDomainCookies` advanced option, so its cookie and the legacy framework cookie stay in sync across subdomains.

  Falls back to the existing per-app and workspace-mode cookie naming when `COOKIE_DOMAIN` is unset, so non-first-party deploys keep their origin-scoped cookies.

- 04fe544: feat(extensions/fetch-tool): the `web-request` tool now sends realistic Chrome-on-macOS headers (User-Agent, Accept, Sec-Fetch-\*, Upgrade-Insecure-Requests, etc.) by default so sites with anti-bot middleware (Cloudflare, PerimeterX, Akamai) respond normally instead of returning challenge pages. Caller-supplied headers always win, so API calls with Authorization keep their values untouched.

  Also raise the response truncation cap from 8k to 32k chars so the agent can read a full article or scraped table in one shot.

- 04fe544: feat(onboarding): pick Google sign-in flow with `GOOGLE_AUTH_MODE` env var (`auto` | `popup` | `redirect`, default `auto`). Auto uses a popup in normal browsers, a full-page redirect inside Electron, and a popup inside the Builder.io browser iframe (Google rejects framing). The new `resolveGoogleAuthMode()` server helper is also exported from `@agent-native/core/server/google-auth-mode` for callers that need to pass an explicit mode.

### Patch Changes

- 04fe544: Auto-send the user's pending prompt the moment Builder.io connection
  completes. The Connect Builder card carries the user's original ask as
  its `prompt` prop; previously the OAuth popup closing left them staring
  at a "Send to Builder" button as if they had to retype it. The card now
  fires the send automatically once `connecting` flips false with a
  configured Builder, but only if the user actually clicked Connect this
  session — revisiting an already-connected card still requires an
  explicit click so old threads don't replay on re-open.
- 04fe544: fix(agent prompt): two routing tweaks for connect-builder.
  - Add an "Extensions vs. Code Changes — Pick the Right Path" section so the agent prefers `create-extension` for new self-contained surfaces (widgets, dashboards, lists, viewers) and only falls back to `connect-builder` when the request modifies the host app's existing chrome.
  - Make the agent briefly acknowledge the user's specific ask before handing off to Builder, and reword the post-card sentence around what the user just asked for instead of leading with a generic Builder pitch.

- 04fe544: - db/neon: Attach a logging error listener to the Neon serverless Pool. Without one, Node 24 surfaces routine WebSocket drops (idle timeout, Lambda suspend, network blip) as fatal `Unhandled error` / `Connection terminated unexpectedly` uncaught exceptions even though the next query would have transparently reconnected. The pool now logs and swallows these so they don't crash the function or fill Sentry.
  - server/sentry: Drop 4xx HTTPError / H3Error from `beforeSend`. h3's `createError({ statusCode: 4xx })` is the documented way to return 404 / 400 / 401 from a route — those bubble through Nitro's error hook and were getting captured as Sentry issues. Match by statusCode when present, fall back to message heuristics ("not found", "Cannot find any route matching", "No access to …", "Unauthenticated") so handler-thrown 4xx don't bury real bugs.
- 04fe544: fix: avoid spurious failures in two edge cases.
  - `agent_run_events` writes now use `ON CONFLICT (run_id, seq) DO NOTHING` so a `pendingTerminalEvent`-reserved seq getting reused, or `appendTerminalRunEvent` racing with the producer's final event, no longer leaves the run in an inconsistent terminal state.
  - `fetchPollJson` in `use-db-sync` now awaits `res.json()` inside the `try` before the timeout `finally` runs, so a body-stream abort can't escape as an unhandled rejection.

- 04fe544: - AssistantChat: clearer Builder-setup card copy ("Turn on the AI assistant" / "One click to connect Builder for free hosted access — no API keys needed").
  - Sentry: drop `AgentAutoContinueSignal` (control-flow sentinel) on the browser side and `ForbiddenError` / `UnauthorizedError` on the server side from captured events. They aren't real failures and were burying actionable bugs in the Sentry issue list.
- 04fe544: ux(agent prompt): after finishing a task with obvious recurring value (daily triage, weekly digests, monthly cleanup), the agent now offers to save it as a recurring job in one short closing line, then calls `manage-jobs(create)` if the user confirms. Skips the offer for one-shot lookups, single drafts/replies, and prompts that already specify a cadence.
- 04fe544: fix(dispatch): make the `/dispatch/<appId>` server-side bounce work in production deploys and after live workspace changes by reading the same env-→file-→filesystem manifest fallback chain that the rest of agent discovery uses, instead of only checking `AGENT_NATIVE_WORKSPACE_APPS_JSON`.

  Core now exports `loadWorkspaceAppsManifest()` and the `WorkspaceAppManifestEntry` type from `@agent-native/core/server/agent-discovery`, so other server entrypoints can resolve the workspace manifest without re-implementing the fallback.

- 04fe544: Strengthen the `create-extension` tool description so the agent generates more
  robust extensions: prefer `<script>` + `Alpine.data('name', () => ({...}))`
  for any non-trivial component instead of stuffing methods, branching, and
  template literals into an inline `x-data="..."` attribute (HTML parser
  pitfalls cause `ReferenceError` failures); require a real LLM key via
  `${keys.*}` for AI features or route the AI work to the agent chat instead
  of shipping a stubbed analysis step.
- 04fe544: Fix Extensions sidebar header so the info-circle icon no longer overlaps the title text on narrow widths. Title now truncates cleanly and the info button only appears on row hover.
- 04fe544: fix(auth): share the framework session cookie across all apps in workspace mode + add `Partitioned` to the cookie attributes so it survives Builder.io's iframe + Chrome's third-party-cookie deprecation.

  Two related issues were combining to break workspace SSO:
  1. The framework cookie name was suffixed with `APP_NAME` (`an_session_dispatch`, `an_session_todo`, etc.) to prevent template ping-ponging in `dev:all`. In workspace mode every app shares the same origin **and** the same DB, so per-app suffixes were the wrong default and killed cross-app sign-in. Workspace apps now share `an_session_workspace`.
  2. The framework cookie was set with `SameSite=None; Secure` but no `Partitioned` attribute, so the Builder OAuth popup → main-iframe handoff dropped the cookie under Chrome's third-party storage partitioning. Better Auth's own cookie already has `Partitioned: true`; this brings the framework's legacy cookie in line.

  After this change, signing into one workspace app (Dispatch in builder-workspace) means you're signed in across the workspace's other apps too, and the agent chat sidebar's auth check stops looping back to the login page on subsequent app loads.

## 0.13.1

### Patch Changes

- 051fcac: Swap `AgentPresenceChip`, `PresenceBar`, and `agent-identity` accent colors to the agent-native brand blues (#00B5FF / #48FFE4) so presence indicators match the new analytics chart palette.
- 051fcac: Route Builder desktop Google sign-in through the configured public OAuth origin so the centralized callback host mints and redeems the OAuth state.

## 0.13.0

### Minor Changes

- 98d56cd: Surface a user-visible "this chat looks stuck" affordance when an agent run goes silent. The server now tracks a durable `last_progress_at` timestamp on every emitted event (distinct from the process-liveness `heartbeat_at`); `/runs/active` returns it; and a new `useRunStuckDetection` hook + `RunStuckBanner` component poll it from the client. After 90s without progress — past the adapter's 75s no-progress reconnect — the banner appears with Retry / Cancel buttons. `MultiTabAssistantChat` wires this in by default, with Retry sending a continuation prompt via the existing chat handle. `trackEvent` calls fire on stuck-detected, retry, and cancel so we can finally see the long tail of stuck-chat incidents in analytics instead of relying on user reports.

### Patch Changes

- 98d56cd: Make the chat sidebar paint instantly on open instead of blocking behind network round-trips. `useChatThreads` now seeds an optimistic active thread synchronously on mount — either from localStorage or a freshly-generated UUID — and persists it server-side in the background. For existing chats, every save also writes the thread data to a localStorage cache, and `AssistantChat` hydrates from that cache synchronously so the message bubbles paint on first commit; the server fetch still runs in the background to refresh, and is skipped as a no-op when the server data is identical to the cache.
- 98d56cd: Composer + menu now reads "Create Extension" (was "Create Tool") and "Schedule Task" (was "Scheduled Task") to match the imperative tense of the other menu items.
- 98d56cd: Reword waitlisted Builder Cloud Agents UI from "unavailable" to "coming soon" in the connect card and code-required dialog.

## 0.12.40

### Patch Changes

- dd3090e: When the agent chat is open in a plain browser tab on localhost, source-code work via the dev handler kills the chat session — Vite HMR and full page reloads cancel the in-flight run. The chat adapter now sends `x-agent-native-surface: desktop | frame | browser`, and the server forces the prod handler (no shell / no fs) on the chat-in-browser-on-localdev surface and prepends a redirect block telling the agent to point users at Agent Native Desktop, Claude Code, Codex, or Builder.io for code changes instead of trying to edit source itself.

## 0.12.39

### Patch Changes

- e4f6cf3: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- e4f6cf3: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.

## 0.12.38

### Patch Changes

- cd451f8: Clarify Builder Cloud Agent waitlist copy and desktop fallback links.

## 0.12.37

### Patch Changes

- 10d8f30: Keep workspace Google OAuth redirects on the configured gateway callback instead of Builder preview origins.
- 10d8f30: Restore the chat-with-dots Tabler icon for the shared agent sidebar toggle.
- 10d8f30: Fix user-testing bugs around unavailable CLI controls, desktop Builder connect fallback, missing-LLM guidance, and duplicate chat activity step keys. Also adds quieter capability cues for code/Builder availability and integration setup prerequisites.
- 10d8f30: Keep chat connected to active server runs when the local runtime drops idle unexpectedly.
- 10d8f30: Add a Dispatch thread debugger with cross-source thread search and deep agent run inspection.

## 0.12.36

### Patch Changes

- bc8311a: Tighten the extensions empty-state copy ("Describe a small app and the agent will build it.").

## 0.12.35

### Patch Changes

- b209def: Make raw agent database tools fail closed for tables without a recognized tenant scope.
- b209def: Polish the extensions empty state hierarchy and composer alignment.

## 0.12.34

### Patch Changes

- d749754: Drop the command menu from `top-[5vh]` to `top-[15vh]` so the palette sits comfortably below the page header instead of pinned to the top.
- d749754: Top-align command palettes so result count changes do not shift their viewport position.

## 0.12.33

### Patch Changes

- 9e11b24: Drop the command menu from `top-[5vh]` to `top-[15vh]` so the palette sits comfortably below the page header instead of pinned to the top.
- 9e11b24: Top-align command palettes so result count changes do not shift their viewport position.

## 0.12.32

### Patch Changes

- 8a83abd: Use redirect sign-in inside Builder.io desktop and harden Builder Google popup opening.
- 8a83abd: Move the extensions sidebar explainer from a click popover to an interactive hovercard.

## 0.12.31

### Patch Changes

- 88f206f: Open workspace settings to the relevant settings section and update chat history wording.
- 88f206f: Extract the QuestionFlow primitive from the design / videos / slides templates into a shared `GuidedQuestionFlow` (plus `useGuidedQuestionFlow` hook and helpers `formatGuidedAnswerValue`, `formatGuidedAnswersForAgent`, `getOtherGuidedAnswerText`, `hasGuidedAnswer`, `isOtherGuidedAnswer`, `makeOtherGuidedAnswer`, `normalizeGuidedAnswers`). Templates that need question-driven generation can now consume the same component instead of forking ~400 lines of UI each.
- 88f206f: Improve agent chat tool-call detail display and disable lazy route-discovery manifest polling in template configs.
- 88f206f: Stamp `requestMode` on every assistant chunk's metadata so the chat surface can tell which mode each turn was actually generated under. The Plan-mode "Implement Plan" CTA now requires the latest assistant message to be a plan response, instead of triggering on any assistant message while the global toggle is plan. Also let the chat history popover include currently-open tabs (marked "Open" instead of a timestamp) so users see their full thread list.
- 88f206f: Prevent copying public-only share links before the resource is public.
- 88f206f: Await persistence of terminal run events before writing the final run status, and skip the status update if the terminal-event SQL write fails — so reconnects can no longer observe `status='errored'` without the corresponding error payload, and the heartbeat-stale reaper retries the run cleanly. Also forces the settings panel to re-apply `initialSection` when the same value is requested twice via a new `sectionRequestKey` prop, and updates the dev overlay shortcut hint to render `Cmd+Ctrl+A` on Mac and `Ctrl+Alt+A` elsewhere.
- 88f206f: Add an optional `id` prop on `SettingsSection` so callers can deep-link or scroll to a specific section. The `agent-panel:open-settings` CustomEvent now accepts an optional `detail.section` field that AgentPanel forwards to the settings panel as `initialSection`. Rename the chat-history toggle copy to "All chats".
- 88f206f: Persist terminal agent-run events before final run status updates so reconnects replay the real outcome.
- 88f206f: Stream `/_agent-native/events` SSE for in-process change events as the fast path for `useDbSync`, with the existing `/_agent-native/poll` endpoint as the cross-process / serverless fallback. When the SSE stream is connected, the polling interval relaxes to 15 s; if the server can't reach the client (or the consumer passes `sseUrl: false`), polling continues at the original cadence. Tool-call cards in `AssistantChat` now expose copy-to-clipboard buttons on the input and result panes.
- 88f206f: Open the agent settings panel when selecting Workspace settings from the organization switcher.

## 0.12.30

### Patch Changes

- 419988f: Surface a visible "model returned an empty response" message when an engine ends a turn with reasoning-only content and zero output text (e.g. OpenAI gpt-5+ Responses runs where reasoning consumes the entire output-token budget). Previously the SSE stream finished cleanly with no text, producing a silent empty assistant bubble.
- 419988f: Add an optional `prepareRequest` hook on `ProductionAgentOptions` and `AgentChatPluginOptions` so templates can normalize the inbound chat request — materialize uploaded attachments into per-template file handles, rewrite the message, or append non-visible instructions — between owner resolution and system/context assembly. Re-export `AgentChatAttachment` from the core entry points so templates can type the hook's payload.
- 419988f: Add a server-side agent chat request preparation hook for templates to materialize uploaded attachments before a run starts.

## 0.12.29

### Patch Changes

- 4c90b33: Use Claude Sonnet as the default Builder gateway chat model.

## 0.12.28

### Patch Changes

- fd1cc43: Add Google OAuth handoff debug breadcrumbs for Builder-hosted sign-in flows.
- fd1cc43: Pause `useDbSync`, `useScreenRefreshKey`, `usePausingInterval`, and `useCollaborativeDoc` polling while the tab is hidden so background tabs do not keep waking the network. Restores polling on focus and visibility change. The new `pauseWhenHidden` option defaults to `true`; pass `false` to keep the legacy always-on behaviour. Also expand `useDbSync`'s default invalidation set to include `app-state`, `navigate-command`, `show-questions`, and `__set_url__`, so framework-managed application-state keys stay in sync without templates having to opt in by passing `queryKeys`. The `/_agent-native/poll` endpoint now subscribes to in-process `app-state` and `settings` emitters and records changes directly, skipping a DB scan when the event happened on the same Node instance, and forwards an `owner` field on every event so clients can match it to the active session.
- fd1cc43: Allow per-message plan/act override via `runConfig.custom.requestMode` so the chat composer can flip a single user turn into Implement Plan without changing the global Plan/Act toggle.

## 0.12.27

### Patch Changes

- 08d4113: Broaden composer upload filters so Markdown, JSON, CSV, DOCX, and PPTX reference files are selectable in native file pickers.
- 08d4113: Buffer streamed assistant text until the final-response guard approves it, so rejected answers never flash before the corrective retry. Removes the `clear` event the UI used to swallow.
- 08d4113: Improve assistant chat embed previews and sub-agent task card labels.
- 08d4113: Clear stale chat activity when corrective agent retries discard partial output.
- 08d4113: Add Preview header bar to IframeEmbed showing the embed's title above the iframe.
- c195ddd: Include installed libsql native packages in Node serverless bundles so hosted apps do not fail loading local SQLite/libsql fallbacks.
- 08d4113: Use better-sqlite3 for local SQLite file URLs and `@libsql/client/web` for remote libsql/Turso URLs so serverless bundles no longer depend on libsql's platform-specific native packages. The deploy bundler still copies any installed `@libsql/<platform>` natives into Netlify/Vercel/Lambda outputs as a safety net.
- 08d4113: Bundle agent chat feedback controls with the main client entry so missing lazy chunks cannot crash the agent panel.
- 08d4113: Show visible assistant error text for chat authentication failures instead of blank messages.

## 0.12.26

### Patch Changes

- 09d9748: Bundle agent chat feedback controls with the main client entry so missing lazy chunks cannot crash the agent panel.

## 0.12.25

### Patch Changes

- 1155964: Close Google OAuth success popups after Builder workspace sign-in completes.
- 1155964: Keep hosted chat credential isolation intact and show visible missing-credential errors.
- 1155964: Read legacy workspace-scoped Builder credentials so users who connected before org scoping no longer see "missing key" errors.

## 0.12.24

### Patch Changes

- d198100: Polish setup, navigation, editor, and feedback affordances from user feedback.
- d198100: Preserve chat attachments and completed history during interrupted-run recovery.
- d198100: Fix stale collaboration presence cleanup, stale run handling, and agent panel recovery.

## 0.12.23

### Patch Changes

- e752afd: Expire stale progress runs so abandoned tray indicators do not stay active forever.
- e752afd: Require request-scoped Builder or LLM credentials for signed-in users on hosted shared-database apps.
- e752afd: Use neutral composer styling when Plan mode is active.
- e752afd: Contain failed remote MCP handshakes and show concise connection errors.
- e752afd: Quiet the optional node-pty missing notice unless terminal debug logging is enabled.
- e752afd: Keep the Workspace docs tooltip from overlapping the panel header.
- e752afd: Improve Sentry signal for Builder gateway network failures and browser analytics noise.
- e752afd: Use the request-context owner when resolving explicit agent engine credentials.
- e752afd: Preserve uploaded attachments on queued chat messages and stringify screen context objects.

## 0.12.22

### Patch Changes

- 1ba9738: Allow composer dictation to request same-origin microphone access and improve blocked-microphone guidance.
- 1ba9738: Use the AI SDK's default OpenAI Responses path for first-party OpenAI agent models.
- 1ba9738: Show a Builder reconnect action when agent chat hits Builder or model-provider auth errors.

## 0.12.21

### Patch Changes

- 0d95d53: Restore production Plan mode in the agent sidebar and clarify read-only planning before production writes.
- 0d95d53: Fix prompt composer model selection in embedded prompt dialogs.
- 0d95d53: Add generic client/server error capture helpers and report agent chat run failures through configured capture providers.

## 0.12.20

### Patch Changes

- 715eda8: Fix sidebar popover clipping, terminal startup visibility, automation test routing, and tiny usage rounding.
- 715eda8: Add Vercel workspace deploy packaging and make the shared-token login gate provider-neutral.
- 715eda8: Reduce noisy CLI Sentry reports for handled workspace watcher limits and skip first-party agent symlinks during GitHub tarball extraction on Windows.
- 715eda8: Collect browser and server Sentry errors from shared DSN deploy configuration.
- 715eda8: Add `vercel` as a third workspace-deploy preset alongside `cloudflare_pages` and `netlify`. When `preset=vercel`, the build emits into `.vercel/output` so the standard Vercel build pipeline picks it up unmodified.

## 0.12.19

### Patch Changes

- 3b88628: Disable Plan mode in local browser dev surfaces and point users to Agent Native Desktop for planning.
- 3b88628: Use cross-site session cookie attributes for Google OAuth sessions so embedded app chat remains authenticated.
- 3b88628: Default the framework to the Builder gateway's `gpt-5-5` model alias, centralize built-in engine model defaults/catalogs in `model-config.ts`, and stop hard-coding `DEFAULT_MODEL` for A2A / MCP / integrations runs — the resolved engine's default is used instead. Also adds a "Use Builder" cloud CTA alongside the Desktop CTA in the AgentPanel and CodeRequiredDialog code-access-unavailable surfaces, including a `useBuilderConnectUrl()` hook that wires up the secondary link from `/_agent-native/builder/status`.
- 3b88628: Fix lazy workspace dev root routing, live app discovery, and generated app dependency startup.
- 3b88628: Keep oversized pasted-text chat attachments from overflowing agent context and render them consistently as pasted-text chips.

## 0.12.18

### Patch Changes

- c17f651: Reorder agent-engine resolution so a Builder-connected user always wins over a stale settings row. Add `isStoredEngineUsableForRequest` so per-user `app_secrets` (Builder or BYOK) are recognized when deciding whether a stored engine is usable, and update `/agent-engine/status` and the engine picker to honor the same priority chain at request time.
- c17f651: Polish OAuth callback close-tab success and error page spacing.

## 0.12.17

### Patch Changes

- ad7006d: Block frame-routed code submissions when local source access is unavailable and point users to Agent Native Desktop for code, CLI, and Workspace access.
- ad7006d: Keep workspace app creation prompts editable after submit and clarify that named products are design references, not implied API-key requirements.
- ad7006d: Fix Plan mode selector mouse interaction and remove keyboard-shortcut wording from user-facing mode guidance.
- ad7006d: Suppress benign Vite connection-reset error overlays and keep narrow composer controls contained.

## 0.12.16

### Patch Changes

- 27c3dbc: Submit a pending email invite when closing the share popover with Done.
- 27c3dbc: Clarify provider-specific tool routing so named external sources win over generic warehouse tools.
- 27c3dbc: Improve chat run completion durability and clarify mounted workspace app routing.
- 27c3dbc: Preserve public forwarded host/protocol headers when proxying workspace apps so Google OAuth redirect URIs use the stable gateway origin instead of internal app dev ports.

## 0.12.15

### Patch Changes

- b07f933: Export the Builder agent engine for template media pipelines.
- b07f933: Clarify workspace app creation instructions to reuse hosted first-party apps as A2A neighbors instead of cloning or nesting templates.
- b07f933: Make extension removal handle shared extensions and refresh installed widgets cleanly.

## 0.12.14

### Patch Changes

- 5115f28: Add Dispatch knowledge packs to workspace resources and let new-app flows grant them alongside vault keys.
- 5115f28: Add an optional run-local command CTA to auth marketing pages.
- 5115f28: Retry workspace app dev servers after early launch failures during local app creation.

## 0.12.13

### Patch Changes

- b1595cc: Allow Builder Connect to override deploy-level Builder credentials with request-scoped credentials.
- b1595cc: Improve Builder transcription error detail and remove OpenAI-specific fallback guidance.

## 0.12.12

### Patch Changes

- 4caaa4f: Keep workspace app creation on same-origin gateway routes and stop child dev servers from advertising private ports.
- 4caaa4f: Give the extensions empty state more breathing room.

## 0.12.11

### Patch Changes

- e076977: Hide the share dialog notification checkbox until an email invite is entered.
- e076977: Match the share popover and trigger surfaces to app sidebar backgrounds.
- e076977: Surface tool-input progress in agent chat and recover from stale reconnect streams.
- e076977: Make generated workspace apps preserve their mounted base path and keep Dispatch app links on the active workspace gateway origin.
- e076977: Support stable root OAuth callbacks for path-mounted workspace apps and clarify new-app prompts.

## 0.12.10

### Patch Changes

- f0776fc: Decode extension route path segments so extensionData removal works for item IDs with spaces.
- f0776fc: Keep short pasted text inline in the agent composer and only convert page-sized pastes to attachments.
- f0776fc: Keep agent chat auth prompts scoped to the originating chat and surface streamed provider auth errors as run errors.
- f0776fc: Preserve structured tool history across agent chat recovery turns and suppress duplicate read-only calls during continuations.

## 0.12.9

### Patch Changes

- 7a849c3: Give the shared extensions sidebar header room for its full label and replace the docs icon tooltip with an interactive popover.
- 7a849c3: Include the Images app as a default connected A2A agent and guide agents to use it for generated imagery.
- 7a849c3: Images-template library refactor + agent-discovery polish.
- 7a849c3: Remember extension sidebar usage and add collapsible sort controls.

## 0.12.8

### Patch Changes

- fdf8cfc: Align the agent sidebar toggle button with standard top-bar icon controls.

## 0.12.7

### Patch Changes

- 7d0ebfc: Add Builder-managed image generation onboarding support and endpoint helpers.
- 7d0ebfc: Move Mail lower in template pickers, remove non-featured templates from default selections, and add a hosted Mail Google sign-in notice.
- 7d0ebfc: Preserve standard `backdrop-filter` declarations in production CSS builds.
- 7d0ebfc: Allow share dialogs to customize visibility and link copy for template-specific access wording.

## 0.12.6

### Patch Changes

- 471bf1e: Treat invalid chat session tokens as auth failures and make empty command-menu AI prompts open chat.
- 471bf1e: Show Builder.io LLM usage as agent credit spend when Builder is the active provider.
- 471bf1e: Harden agent chat auth and gateway recovery paths.
- 471bf1e: Keep programmatic new-tab chat sends on the requested thread id so UI callers can track run state.
- 471bf1e: Allow the feedback popover's first submit click to load the form schema before sending.
- 471bf1e: Persist the agent chat model selection across page refreshes.
- 471bf1e: Allow notification bells to show clearer empty-state copy.
- 471bf1e: Add optional share notification controls and direct resource links for sharing emails.

## 0.12.5

### Patch Changes

- 2e99cca: Fix workspace scaffolding for the Design template and clarify local Dispatch setup.
- 2e99cca: Shorten the composer model selector reasoning effort label.
- 2e99cca: Send Builder gateway owner headers from the Builder agent engine and keep Builder auth failures out of the app-login flow.
- 2e99cca: Register the `images` template with `hidden:true` in the CLI catalog. The template directory exists in-flight but is intentionally not surfaced in public template lists yet.

## 0.12.4

### Patch Changes

- e2bce24: Keep the prompt composer TipTap schema minimal to avoid ProseMirror recursion in deployed pages.
- e2bce24: Keep existing extension edits on the update-extension path instead of routing them to Builder code changes.
- e2bce24: Recover dev pages when Vite serves outdated optimized dependency 504 responses.

## 0.12.3

### Patch Changes

- d83d5ec: Recognize Images artifacts in cross-app A2A responses.
- d83d5ec: Improve the shared access-token login page with clearer guidance and visible failure states.

## 0.12.2

### Patch Changes

- b878dd8: `agentNative.chatRunning` event now reflects both true and false transitions of `isRunning`, allowing UI consumers to track agent work state in real time.
- b878dd8: Broadcast agent chat running state when normal runs start or stop, and switch the agent panel back to chat when submitting a visible prompt.

## 0.12.1

### Patch Changes

- 47b8486: Avoid duplicate TipTap link extensions when editors provide custom link behavior.

## 0.12.0

### Minor Changes

- 14f7b63: Add agent-callable extension list, hide, unhide, and delete actions so chat can manage visible extensions without raw SQL.

### Patch Changes

- 14f7b63: Tighten generic chat document uploads and make restored chat threads settle at the bottom after refresh.
- 14f7b63: Collapse the extension sidebar list to three items by default.
- 14f7b63: Clarify personal versus organization MCP server scope guidance in the connection UI.
- 14f7b63: Create extensions with private visibility even when the creator belongs to an organization.

## 0.11.4

### Patch Changes

- 24781d0: Clarify Dispatch new-app instructions so Builder branches scaffold separate workspace apps instead of editing starter.
- 24781d0: Add a template hook for retrying guarded final agent answers before they are shown.
- 24781d0: Match the agent sidebar loading header height to the loaded panel header.

## 0.11.3

### Patch Changes

- 81d5b68: Use the Tabler message-dots icon for the agent sidebar toggle.
- 81d5b68: Keep agent DB tools scoped to owner rows when org context is active and rows have no org id.
- 81d5b68: Suppress automatic stale route-chunk reloads inside the Agent Native desktop app.
- 81d5b68: Harden the public-viewer anonymous-owner resolver: validate Referer origin, require the exact Builder callback path, and discard expired status connect URLs in the embedded settings panel.

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
